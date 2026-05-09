import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import {
  submitNanoBananaImage,
  buildCharacterPortraitPrompt,
  type PortraitCharacterDescription,
} from "@no-safe-word/image-gen";

// Nano Banana 2 face portrait at 2k / 1:1 = 2048×2048. Faces always go
// through Nano Banana 2 on Siray, regardless of the parent story's
// image_model. Body / scenes / cover continue to dispatch on
// story_series.image_model — see /generate-body, /generate-cover,
// /generate-image.
const FACE_SIZE = "2k" as const;
const FACE_ASPECT = "1:1" as const;
const FACE_WIDTH = 2048;
const FACE_HEIGHT = 2048;

// POST /api/stories/characters/[storyCharId]/generate — Generate a character face portrait.
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    let customPrompt: string | undefined;
    try {
      const body = await request.json();
      if (typeof body.customPrompt === 'string' && body.customPrompt.trim().length > 20) {
        customPrompt = body.customPrompt.trim();
      }
    } catch {
      // No body or invalid JSON — use defaults
    }

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
    const promptText =
      customPrompt ??
      buildCharacterPortraitPrompt(desc as PortraitCharacterDescription, "face");

    console.log(
      `[StoryPublisher] Generating face portrait (${isMale ? 'male' : 'female'}) for: ${character.name} [model=nano_banana_2]`
    );

    // Submit to Nano Banana 2 (t2i — face IS the reference being created).
    const submitted = await submitNanoBananaImage({
      prompt: promptText,
      size: FACE_SIZE,
      aspectRatio: FACE_ASPECT,
      referenceImageUrls: [],
    });

    // Insert the images row up-front. stored_url is filled in later by
    // the status handler when the Siray job completes.
    const { data: imageRow, error: imgErr } = await supabase
      .from("images")
      .insert({
        character_id: character.id,
        prompt: promptText,
        settings: {
          model: "nano_banana_2",
          provider: "siray",
          siray_model: submitted.model,
          siray_task_id: submitted.taskId,
          aspect_ratio: submitted.aspectRatio,
          size: submitted.size,
          reference_image_count: submitted.referenceImageCount,
          imageType: "face",
        },
        mode: "sfw",
        requested_width: FACE_WIDTH,
        requested_height: FACE_HEIGHT,
        actual_width: FACE_WIDTH,
        actual_height: FACE_HEIGHT,
        dimension_fallback_reason: null,
      })
      .select("id")
      .single();

    if (imgErr || !imageRow) {
      throw new Error(`Failed to create image record: ${imgErr?.message}`);
    }

    const jobId = `siray-${submitted.taskId}`;
    const { error: jobErr } = await supabase.from("generation_jobs").insert({
      job_id: jobId,
      image_id: imageRow.id,
      status: "pending",
      cost: 0,
      job_type: "character_portrait",
    });

    if (jobErr) {
      throw new Error(`Failed to register Siray job: ${jobErr.message}`);
    }

    return NextResponse.json({
      jobId,
      imageId: imageRow.id,
      model: "nano_banana_2",
      promptUsed: promptText,
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
