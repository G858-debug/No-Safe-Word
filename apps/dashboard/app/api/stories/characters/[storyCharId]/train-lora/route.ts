import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { runPipeline, getPipelineProgress } from "@no-safe-word/image-gen/server/character-lora";
import type { CharacterInput, CharacterStructured } from "@no-safe-word/image-gen";

// POST /api/stories/characters/[storyCharId]/train-lora
// Triggers the LoRA training pipeline after BOTH portrait and full-body are approved.
// Runs in the background (fire-and-forget).
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    // 1. Fetch the story character with its character data
    const { data: storyChar, error: scError } = await supabase
      .from("story_characters")
      .select(`
        id, character_id, approved, approved_image_id, approved_seed, approved_prompt,
        approved_fullbody, approved_fullbody_image_id, approved_fullbody_seed,
        active_lora_id,
        characters ( id, name, description )
      `)
      .eq("id", storyCharId)
      .single();

    if (scError || !storyChar) {
      return NextResponse.json(
        { error: "Story character not found" },
        { status: 404 }
      );
    }

    // 2. Verify BOTH portrait and full-body are approved
    if (!storyChar.approved || !storyChar.approved_fullbody) {
      return NextResponse.json(
        { error: "Both portrait and full-body must be approved before LoRA training" },
        { status: 400 }
      );
    }

    // 3. Check for feature flag
    if (process.env.ENABLE_LORA_TRAINING !== "true") {
      return NextResponse.json(
        { error: "LoRA training is not enabled (set ENABLE_LORA_TRAINING=true)" },
        { status: 403 }
      );
    }

    // 4. Check if a LoRA is already training or deployed for this character
    const existingProgress = await getPipelineProgress(
      storyChar.character_id,
      { supabase },
    );

    if (existingProgress) {
      if (existingProgress.status === 'deployed') {
        return NextResponse.json(
          { error: "LoRA already deployed for this character", loraId: existingProgress.loraId },
          { status: 409 }
        );
      }
      if (!['failed', 'archived'].includes(existingProgress.status)) {
        return NextResponse.json(
          {
            error: "LoRA training already in progress",
            loraId: existingProgress.loraId,
            status: existingProgress.status,
          },
          { status: 409 }
        );
      }
    }

    // 5. Get the approved image URLs
    const character = storyChar.characters as { id: string; name: string; description: Record<string, unknown> };
    const desc = character.description as Record<string, string>;

    // Fetch stored URLs for both approved images
    const [portraitImage, fullBodyImage] = await Promise.all([
      supabase.from("images").select("stored_url, sfw_url").eq("id", storyChar.approved_image_id!).single(),
      supabase.from("images").select("stored_url, sfw_url").eq("id", storyChar.approved_fullbody_image_id!).single(),
    ]);

    const portraitUrl = portraitImage.data?.stored_url || portraitImage.data?.sfw_url;
    const fullBodyUrl = fullBodyImage.data?.stored_url || fullBodyImage.data?.sfw_url;

    if (!portraitUrl || !fullBodyUrl) {
      return NextResponse.json(
        { error: "Could not find stored URLs for approved images" },
        { status: 500 }
      );
    }

    // 6. Create the character_loras record
    // Explicitly pass all NOT NULL columns — production DB may lack DEFAULT values
    const { data: loraRecord, error: insertError } = await (supabase as any)
      .from("character_loras")
      .insert({
        character_id: character.id,
        filename: "",
        storage_path: "",
        trigger_word: "tok",
        base_model: "sdxl",
        training_provider: "replicate",
        training_params: {},
        dataset_size: 0,
        training_attempts: 0,
        status: "pending",
      })
      .select("id")
      .single() as { data: { id: string } | null; error: any };

    if (insertError || !loraRecord) {
      return NextResponse.json(
        { error: `Failed to create LoRA record: ${insertError?.message}` },
        { status: 500 }
      );
    }

    // 7. Build the CharacterInput for the pipeline
    const structuredData: CharacterStructured = {
      gender: desc.gender || "female",
      ethnicity: desc.ethnicity || "",
      bodyType: desc.bodyType || "",
      skinTone: desc.skinTone || "",
      hairColor: desc.hairColor || "",
      hairStyle: desc.hairStyle || "",
      eyeColor: desc.eyeColor || "",
      age: desc.age || "",
      distinguishingFeatures: desc.distinguishingFeatures,
    };

    const characterInput: CharacterInput = {
      characterId: character.id,
      characterName: character.name,
      gender: desc.gender || "female",
      approvedImageUrl: portraitUrl,
      approvedPrompt: storyChar.approved_prompt || "",
      fullBodyImageUrl: fullBodyUrl,
      fullBodySeed: storyChar.approved_fullbody_seed || 42,
      portraitSeed: storyChar.approved_seed || 42,
      structuredData,
      pipelineType: "story_character",
    };

    // 8. Fire-and-forget — start the pipeline in the background
    console.log(`[LoRA API] Triggering LoRA pipeline for ${character.name} (loraId: ${loraRecord.id})`);

    runPipeline(characterInput, loraRecord.id, { supabase }).catch((err) => {
      console.error(`[LoRA API] Pipeline background error:`, err);
    });

    // 9. Update story_characters to link the LoRA
    await supabase
      .from("story_characters")
      .update({ active_lora_id: loraRecord.id })
      .eq("id", storyCharId);

    return NextResponse.json({
      success: true,
      loraId: loraRecord.id,
      message: `LoRA training started for ${character.name}. Poll /lora-progress for status.`,
    });
  } catch (err) {
    console.error("[LoRA API] Train-lora failed:", err);
    return NextResponse.json(
      {
        error: "Failed to start LoRA training",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
