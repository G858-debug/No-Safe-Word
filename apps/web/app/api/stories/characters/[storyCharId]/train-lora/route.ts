import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { runTrainingPipeline, getRecommendedTrainingConfig } from "@no-safe-word/image-gen/server/lora-trainer";
import type { CharacterInput, CharacterStructured } from "@no-safe-word/image-gen";

// POST /api/stories/characters/[storyCharId]/train-lora
// Triggers the LoRA training pipeline after BOTH portrait and full-body are approved.
// Runs in the background (fire-and-forget).
export async function POST(
  _request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {

    // 1. Fetch the story character with its character data
    // Note: active_lora_id not in generated types yet, so use 'as any'
    const { data: storyChar, error: scError } = await (supabase as any)
      .from("story_characters")
      .select(`
        id, character_id, approved, approved_image_id, approved_seed, approved_prompt,
        approved_fullbody, approved_fullbody_image_id, approved_fullbody_seed,
        active_lora_id,
        characters ( id, name, description )
      `)
      .eq("id", storyCharId)
      .single() as { data: any; error: any };

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

    // 4. Delete ALL existing LoRAs for this character (clean slate).
    // The user explicitly clicked "Train" — they want to start over.
    // Clear the active_lora_id first (no cascade on this FK).
    await (supabase as any)
      .from('story_characters')
      .update({ active_lora_id: null })
      .eq('id', storyCharId);

    const { data: existingLoras } = await (supabase as any)
      .from("character_loras")
      .select("id, status, storage_url, filename")
      .eq("character_id", storyChar.character_id) as { data: Array<{ id: string; status: string; storage_url: string | null; filename: string | null }> | null };

    if (existingLoras && existingLoras.length > 0) {
      // Collect storage paths for cleanup
      const storagePaths: string[] = [];
      for (const lora of existingLoras) {
        if (lora.storage_url) {
          const parts = lora.storage_url.split('/lora-training-datasets/');
          if (parts.length === 2) storagePaths.push(parts[1]);
        }
      }

      // Collect dataset image storage paths
      const loraIds = existingLoras.map(l => l.id);
      const { data: datasetImages } = await (supabase as any)
        .from("lora_dataset_images")
        .select("storage_path")
        .in("lora_id", loraIds) as { data: Array<{ storage_path: string | null }> | null };

      if (datasetImages) {
        for (const img of datasetImages) {
          if (img.storage_path) storagePaths.push(img.storage_path);
        }
      }

      // Delete LoRA records (cascades to lora_dataset_images)
      const { error: deleteError } = await (supabase as any)
        .from("character_loras")
        .delete()
        .eq("character_id", storyChar.character_id);

      if (deleteError) {
        console.error(`[LoRA Train] Failed to delete old LoRAs:`, deleteError.message);
      } else {
        console.log(`[LoRA Train] Deleted ${existingLoras.length} old LoRA(s) for ${storyChar.characters.name}`);
      }

      // Clean up storage files (non-blocking)
      if (storagePaths.length > 0) {
        const BATCH = 100;
        for (let i = 0; i < storagePaths.length; i += BATCH) {
          const batch = storagePaths.slice(i, i + BATCH);
          supabase.storage.from("lora-training-datasets").remove(batch).catch(() => {});
        }
        console.log(`[LoRA Train] Queued deletion of ${storagePaths.length} storage file(s)`);
      }
    }

    // 5. Check series image engine
    const { data: seriesRow } = await (supabase as any)
      .from("story_characters")
      .select("series_id")
      .eq("id", storyCharId)
      .single() as { data: { series_id: string } | null };

    let imageEngine: string | null = null;
    if (seriesRow?.series_id) {
      const { data: series } = await (supabase as any)
        .from("story_series")
        .select("image_engine")
        .eq("id", seriesRow.series_id)
        .single() as { data: { image_engine: string } | null };
      imageEngine = series?.image_engine || null;
    }

    // 6. Get the approved image URLs
    const character = storyChar.characters as { id: string; name: string; description: Record<string, unknown> };
    const desc = character.description as Record<string, string>;

    // Fetch stored URLs for both approved images
    const [portraitImage, fullBodyImage] = await Promise.all([
      supabase.from("images").select("stored_url, sfw_url").eq("id", storyChar.approved_image_id!).single(),
      supabase.from("images").select("stored_url, sfw_url").eq("id", storyChar.approved_fullbody_image_id!).single(),
    ]);

    // Prefer sfw_url (original PNG, always exists) over stored_url (JPEG copy, sometimes missing)
    const portraitUrl = portraitImage.data?.sfw_url || portraitImage.data?.stored_url;
    const fullBodyUrl = fullBodyImage.data?.sfw_url || fullBodyImage.data?.stored_url;

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
        trigger_word: getRecommendedTrainingConfig(character.name).triggerWord,
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
      imageEngine: "juggernaut_ragnarok",
    };

    // 8. Fire-and-forget — start the pipeline in the background
    console.log(`[LoRA API] Triggering LoRA pipeline for ${character.name} (loraId: ${loraRecord.id})`);
    void runTrainingPipeline(characterInput, loraRecord.id, { supabase }).catch((err) => {
      console.error(`[LoRA API] Pipeline background error:`, err);
    });

    // 9. Update story_characters to link the LoRA
    await supabase
      .from("story_characters")
      .update({ active_lora_id: loraRecord.id } as any)
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
