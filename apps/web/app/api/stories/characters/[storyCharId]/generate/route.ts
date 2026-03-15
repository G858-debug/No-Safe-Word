import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { submitRunPodJob, runNanoBanana } from "@no-safe-word/image-gen";
import { buildCharacterGenerationPayload } from "@/lib/server/generate-character-image";

type ImageType = "portrait" | "fullBody";
type GenerationStage = "face" | "body";

// POST /api/stories/characters/[storyCharId]/generate — Generate a character portrait or full body
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    // Parse optional seed, type, stage, and customPrompt from request body
    let customSeed: number | undefined;
    let imageType: ImageType = "portrait";
    let stage: GenerationStage = "face";
    let customPrompt: string | undefined;
    try {
      const body = await request.json();
      if (typeof body.seed === "number" && body.seed > 0) {
        customSeed = body.seed;
      }
      if (body.type === "fullBody") {
        imageType = "fullBody";
      }
      if (body.stage === "body") {
        stage = "body";
      }
      if (typeof body.customPrompt === 'string' && body.customPrompt.trim().length > 20) {
        customPrompt = body.customPrompt.trim();
      }
    } catch {
      // No body or invalid JSON — use defaults
    }

    // 1. Fetch the story_character row (include face_url for body stage)
    const { data: storyChar, error: scError } = await supabase
      .from("story_characters")
      .select("id, character_id, face_url")
      .eq("id", storyCharId)
      .single();

    if (scError || !storyChar) {
      console.error(`[StoryPublisher] Story character not found: ${storyCharId}`, scError);
      return NextResponse.json(
        { error: "Story character not found" },
        { status: 404 }
      );
    }

    // 2. Fetch the character's structured description
    const { data: character, error: charError } = await supabase
      .from("characters")
      .select("id, name, description")
      .eq("id", storyChar.character_id)
      .single();

    if (charError || !character) {
      console.error(`[StoryPublisher] Character not found: ${storyChar.character_id}`, charError);
      return NextResponse.json(
        { error: "Character not found" },
        { status: 404 }
      );
    }

    const desc = character.description as Record<string, string>;
    const isMale = desc.gender === 'male';

    console.log(`[StoryPublisher] Generating ${stage} (${isMale ? 'male' : 'female'}) for: ${character.name}`);

    // 3. Build generation payload (prompt, LoRAs, workflow/API params)
    const payload = await buildCharacterGenerationPayload({
      character: {
        id: character.id,
        name: character.name,
        description: desc,
      },
      imageType,
      stage,
      seed: customSeed,
      customPrompt,
      approvedFaceUrl: stage === 'body' ? (storyChar.face_url ?? undefined) : undefined,
    });

    console.log(`[StoryPublisher] Engine: ${payload.engine}, Prompt: ${payload.positivePrompt.substring(0, 100)}...`);
    console.log(`[StoryPublisher] Seed: ${payload.seed}`);

    // 4a. Pre-flight: for body stage with a face reference, verify the image exists in storage
    if (stage === 'body' && payload.engine === 'replicate' && payload.referenceImageUrl) {
      const headRes = await fetch(payload.referenceImageUrl, { method: 'HEAD' });
      if (!headRes.ok) {
        return NextResponse.json(
          { error: "Face reference image not found — please regenerate and re-approve the face portrait first, then retry the body." },
          { status: 422 },
        );
      }
    }

    // 4. Branch by engine
    if (payload.engine === 'replicate') {
      // ---- Replicate path (Nano Banana 2 — synchronous) ----
      console.log(`[StoryPublisher] Calling Nano Banana 2 via Replicate...`);

      const imageBuffer = await runNanoBanana(
        payload.positivePrompt,
        payload.referenceImageUrl,
        payload.seed,
      );

      // Create image record first to get the ID for storage path
      const { data: imageRow, error: imgError } = await supabase
        .from("images")
        .insert({
          character_id: character.id,
          prompt: payload.positivePrompt,
          settings: {
            engine: "nano-banana",
            imageType,
            stage,
            seed: payload.seed,
          },
          mode: "sfw",
        })
        .select("id")
        .single();

      if (imgError || !imageRow) {
        throw new Error(`Failed to create image record: ${imgError?.message}`);
      }

      // Upload to Supabase Storage
      const storagePath = `characters/${imageRow.id}.png`;
      const { error: uploadError } = await supabase.storage
        .from("story-images")
        .upload(storagePath, imageBuffer, {
          contentType: "image/png",
          upsert: true,
        });

      if (uploadError) {
        throw new Error(`Storage upload failed: ${uploadError.message}`);
      }

      const { data: urlData } = supabase.storage.from("story-images").getPublicUrl(storagePath);
      const publicUrl = urlData.publicUrl;

      // Update image record with stored URL
      await supabase
        .from("images")
        .update({ stored_url: publicUrl })
        .eq("id", imageRow.id);

      // Create completed generation job record
      await supabase.from("generation_jobs").insert({
        job_id: `replicate-instant-${imageRow.id}`,
        image_id: imageRow.id,
        status: "completed",
        cost: 0,
      });

      console.log(`[StoryPublisher] Nano Banana 2 complete: ${imageRow.id}, stored at: ${publicUrl}`);

      return NextResponse.json({
        jobId: `replicate-instant-${imageRow.id}`,
        imageId: imageRow.id,
        storedUrl: publicUrl,
        seed: payload.seed,
        instant: true,
      });
    } else {
      // ---- RunPod path (Flux Krea or SDXL via ComfyUI) ----
      const engineLabel = stage === 'face' && !isMale ? 'Flux Krea' : 'SDXL RealVisXL';
      console.log(`[StoryPublisher] Submitting to RunPod (${engineLabel})...`);

      // Include any images from the payload (for future extensibility)
      let runpodImages: Array<{ name: string; image: string }> | undefined;
      if (payload.images) {
        runpodImages = [...payload.images];
      }

      const { jobId } = await submitRunPodJob(
        payload.workflow,
        runpodImages,
      );

      // Create image record
      const { data: imageRow, error: imgError } = await supabase
        .from("images")
        .insert({
          character_id: character.id,
          prompt: payload.positivePrompt,
          settings: {
            width: payload.width,
            height: payload.height,
            engine: stage === 'face' && !isMale ? 'flux-krea' : 'sdxl-realvis',
            imageType,
            stage,
            seed: payload.seed,
          },
          mode: "sfw",
        })
        .select("id")
        .single();

      if (imgError || !imageRow) {
        throw new Error(`Failed to create image record: ${imgError?.message}`);
      }

      // Create generation job record for status polling
      await supabase.from("generation_jobs").insert({
        job_id: `runpod-${jobId}`,
        image_id: imageRow.id,
        status: "pending",
        cost: 0,
      });

      console.log(`[StoryPublisher] ${stage} job submitted: runpod-${jobId}, imageId: ${imageRow.id}`);

      return NextResponse.json({
        jobId: `runpod-${jobId}`,
        imageId: imageRow.id,
      });
    }
  } catch (err) {
    console.error("Character portrait generation failed:", err);
    return NextResponse.json(
      {
        error: "Generation failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
