import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { runPonyPipeline } from "@no-safe-word/image-gen/server/pony-lora-trainer";
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

    // 4. Check if a LoRA is already training or deployed for this character
    // TODO: Phase 3 — replace with Pony pipeline progress check
    const existingLoraQuery = await (supabase as any)
      .from("character_loras")
      .select("id, status")
      .eq("character_id", storyChar.character_id)
      .not("status", "in", '("failed","archived")')
      .order("created_at", { ascending: false })
      .limit(1)
      .single() as { data: { id: string; status: string } | null; error: any };

    const existingProgress = existingLoraQuery.data
      ? { loraId: existingLoraQuery.data.id, status: existingLoraQuery.data.status }
      : null;

    if (existingProgress) {
      // Archive the existing LoRA so a fresh training can start.
      // The user explicitly clicked "Train" or "Regenerate Dataset" — they want to start over.
      console.log(`[LoRA Train] Archiving existing LoRA ${existingProgress.loraId} (status: ${existingProgress.status})`);
      await (supabase as any)
        .from('character_loras')
        .update({ status: 'archived', updated_at: new Date().toISOString() })
        .eq('id', existingProgress.loraId);

      // Clear the active_lora_id so it doesn't reference the archived one
      await (supabase as any)
        .from('story_characters')
        .update({ active_lora_id: null })
        .eq('id', storyCharId);
    }

    // 5. Check series image engine for Pony dispatch
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
        trigger_word: "tok",
        base_model: imageEngine === "pony_cyberreal" ? "pony_cyberreal" : "sdxl",
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
      imageEngine: imageEngine === "pony_cyberreal" ? "pony_cyberreal" : undefined,
    };

    // 8. Fire-and-forget — start the pipeline in the background
    console.log(`[LoRA API] Triggering Pony LoRA pipeline for ${character.name} (loraId: ${loraRecord.id})`);
    void runPonyPipeline(characterInput, loraRecord.id, { supabase }).catch((err) => {
      console.error(`[LoRA API] Pony pipeline background error:`, err);
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
