import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { submitRunPodJob } from "@no-safe-word/image-gen";
import { buildCharacterGenerationPayload } from "@/lib/server/character-image";

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

    const desc = character.description as Record<string, string>;
    const isMale = desc.gender === 'male';

    console.log(`[StoryPublisher] Generating ${stage} (${isMale ? 'male' : 'female'}) for: ${character.name}`);

    // Build character generation payload
    const payload = buildCharacterGenerationPayload({
      character: {
        id: character.id,
        name: character.name,
        description: desc,
      },
      imageType,
      stage,
      seed: customSeed,
      customPrompt,
    });

    const endpointId = process.env.RUNPOD_ENDPOINT_ID;
    console.log(`[StoryPublisher] ${stage} generation: ${payload.positivePrompt.substring(0, 100)}...`);

    const { jobId } = await submitRunPodJob(payload.workflow, undefined, undefined, endpointId);

    const { data: imageRow, error: imgError } = await supabase
      .from("images")
      .insert({
        character_id: character.id,
        prompt: payload.positivePrompt,
        negative_prompt: payload.negativePrompt,
        settings: {
          width: payload.width,
          height: payload.height,
          engine: "juggernaut-ragnarok",
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

    console.log(`[StoryPublisher] ${stage} job submitted: runpod-${jobId}, imageId: ${imageRow.id}`);

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
