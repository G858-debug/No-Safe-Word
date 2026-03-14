import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { submitRunPodJob } from "@no-safe-word/image-gen";
import { buildCharacterGenerationPayload } from "@/lib/server/generate-character-image";

type ImageType = "portrait" | "fullBody";

// POST /api/stories/characters/[storyCharId]/generate — Generate a character portrait or full body
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    // Parse optional seed, type, and customPrompt from request body
    let customSeed: number | undefined;
    let imageType: ImageType = "portrait";
    let customPrompt: string | undefined;
    try {
      const body = await request.json();
      if (typeof body.seed === "number" && body.seed > 0) {
        customSeed = body.seed;
      }
      if (body.type === "fullBody") {
        imageType = "fullBody";
      }
      if (typeof body.customPrompt === 'string' && body.customPrompt.trim().length > 20) {
        customPrompt = body.customPrompt.trim();
      }
    } catch {
      // No body or invalid JSON — use defaults
    }

    console.log(`[StoryPublisher] Generating ${imageType} (RealVisXL SDXL) for storyCharId: ${storyCharId}`);

    // 1. Fetch the story_character row
    const { data: storyChar, error: scError } = await supabase
      .from("story_characters")
      .select("id, character_id")
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

    console.log(`[StoryPublisher] Generating for character: ${character.name} (${character.id})`);

    // 3. Build generation payload (prompt, LoRAs, workflow)
    const payload = await buildCharacterGenerationPayload({
      character: {
        id: character.id,
        name: character.name,
        description: character.description as Record<string, string>,
      },
      imageType,
      seed: customSeed,
      customPrompt,
    });

    console.log(`[StoryPublisher] Prompt source: ${customPrompt ? 'custom override' : 'auto-built from description'}`);
    console.log(`[StoryPublisher] SDXL positive prompt: ${payload.positivePrompt.substring(0, 100)}...`);
    console.log(`[StoryPublisher] LoRAs: ${payload.loras.length > 0 ? payload.loras.map(l => l.filename).join(", ") : "NONE"}`);
    console.log(`[StoryPublisher] Seed: ${payload.seed}`);

    // 4. Submit async job to RunPod
    const { jobId } = await submitRunPodJob(payload.workflow);

    // 5. Create image record (stored_url will be set when status polling completes)
    const { data: imageRow, error: imgError } = await supabase
      .from("images")
      .insert({
        character_id: character.id,
        prompt: payload.positivePrompt,
        settings: {
          width: payload.width,
          height: payload.height,
          engine: "sdxl-realvis",
          imageType,
          seed: payload.seed,
        },
        mode: "sfw",
      })
      .select("id")
      .single();

    if (imgError || !imageRow) {
      throw new Error(`Failed to create image record: ${imgError?.message}`);
    }

    // 6. Create generation job record for status polling
    await supabase.from("generation_jobs").insert({
      job_id: `runpod-${jobId}`,
      image_id: imageRow.id,
      status: "pending",
      cost: 0,
    });

    console.log(`[StoryPublisher] ${imageType === "fullBody" ? "Full body" : "Portrait"} job submitted: runpod-${jobId}, imageId: ${imageRow.id}`);

    return NextResponse.json({
      jobId: `runpod-${jobId}`,
      imageId: imageRow.id,
    });
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
