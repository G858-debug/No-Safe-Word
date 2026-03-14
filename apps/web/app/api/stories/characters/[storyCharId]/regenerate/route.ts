import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { submitRunPodJob, runNanoBanana } from "@no-safe-word/image-gen";
import { buildCharacterGenerationPayload } from "@/lib/server/generate-character-image";

type ImageType = "portrait" | "fullBody";
type GenerationStage = "face" | "body";

// POST /api/stories/characters/[storyCharId]/regenerate — Regenerate with optional custom prompt and seed
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    const body = await request.json();
    const { prompt: customPrompt, seed: customSeed } = body as { prompt?: string; seed?: number };
    const imageType: ImageType = body.type === "fullBody" ? "fullBody" : "portrait";
    const stage: GenerationStage = body.stage === "body" ? "body" : "face";

    // 1. Fetch the story_character row (include face_url for body stage)
    const { data: storyChar, error: scError } = await supabase
      .from("story_characters")
      .select("id, character_id, face_url")
      .eq("id", storyCharId)
      .single();

    if (scError || !storyChar) {
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
      return NextResponse.json(
        { error: "Character not found" },
        { status: 404 }
      );
    }

    const desc = character.description as Record<string, string>;
    const isMale = desc.gender === 'male';

    console.log(`[StoryPublisher] Regenerating ${stage} (${isMale ? 'male' : 'female'}) for: ${character.name}`);

    // 3. Clean up old images from storage
    try {
      const { data: oldImages } = await supabase
        .from("images")
        .select("id, stored_url")
        .eq("character_id", character.id)
        .not("stored_url", "is", null);

      if (oldImages && oldImages.length > 0) {
        const pathsToDelete: string[] = [];

        for (const img of oldImages) {
          if (img.stored_url) {
            // When regenerating body, preserve the approved face image so it can
            // be used as the reference for Nano Banana Pro / ReActor.
            if (stage === 'body' && storyChar.face_url && img.stored_url === storyChar.face_url) {
              continue;
            }
            const urlParts = img.stored_url.split("/story-images/");
            if (urlParts.length === 2) {
              pathsToDelete.push(urlParts[1]);
            }
          }
        }

        if (pathsToDelete.length > 0) {
          await supabase.storage.from("story-images").remove(pathsToDelete);
          console.log(`Deleted ${pathsToDelete.length} old character images from storage`);
        }
      }
    } catch (err) {
      console.warn("Failed to clean up old character images:", err);
    }

    // 4. Build generation payload
    const payload = await buildCharacterGenerationPayload({
      character: {
        id: character.id,
        name: character.name,
        description: desc,
      },
      imageType,
      stage,
      seed: (typeof customSeed === "number" && customSeed > 0) ? customSeed : undefined,
      customPrompt: (typeof customPrompt === 'string' && customPrompt.trim().length > 0)
        ? customPrompt.trim()
        : undefined,
      approvedFaceUrl: stage === 'body' ? (storyChar.face_url ?? undefined) : undefined,
    });

    console.log(`[StoryPublisher] Engine: ${payload.engine}, Seed: ${payload.seed}`);

    // 5a. Pre-flight: for body stage with a face reference, verify the image exists in storage
    if (stage === 'body' && payload.engine === 'replicate' && payload.referenceImageUrl) {
      const headRes = await fetch(payload.referenceImageUrl, { method: 'HEAD' });
      if (!headRes.ok) {
        return NextResponse.json(
          { error: "Face reference image not found — please regenerate and re-approve the face portrait first, then retry the body." },
          { status: 422 },
        );
      }
    }

    // 5. Branch by engine
    if (payload.engine === 'replicate') {
      // ---- Replicate path (Nano Banana Pro — synchronous) ----
      const imageBuffer = await runNanoBanana(
        payload.positivePrompt,
        payload.referenceImageUrl,
      );

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

      await supabase
        .from("images")
        .update({ stored_url: publicUrl })
        .eq("id", imageRow.id);

      await supabase.from("generation_jobs").insert({
        job_id: `replicate-instant-${imageRow.id}`,
        image_id: imageRow.id,
        status: "completed",
        cost: 0,
      });

      console.log(`[StoryPublisher] Nano Banana Pro regeneration complete: ${imageRow.id}`);

      return NextResponse.json({
        jobId: `replicate-instant-${imageRow.id}`,
        imageId: imageRow.id,
        storedUrl: publicUrl,
        instant: true,
      });
    } else {
      // ---- RunPod path (SDXL via ComfyUI) ----
      // ReActor face-swap is disabled — include only images from the payload
      let runpodImages: Array<{ name: string; image: string }> | undefined;

      if (payload.images) {
        runpodImages = [...(runpodImages || []), ...payload.images];
      }

      const { jobId } = await submitRunPodJob(
        payload.workflow,
        runpodImages,
      );

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

      await supabase.from("generation_jobs").insert({
        job_id: `runpod-${jobId}`,
        image_id: imageRow.id,
        status: "pending",
        cost: 0,
      });

      console.log(`[StoryPublisher] ${stage} regeneration job submitted: runpod-${jobId}, imageId: ${imageRow.id}`);

      return NextResponse.json({
        jobId: `runpod-${jobId}`,
        imageId: imageRow.id,
      });
    }
  } catch (err) {
    console.error("Character portrait regeneration failed:", err);
    return NextResponse.json(
      {
        error: "Regeneration failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
