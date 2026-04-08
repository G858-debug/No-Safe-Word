import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { resumeTrainingPipeline, completeTrainingPipeline } from "@no-safe-word/image-gen/server/lora-trainer";
import type { CharacterInput, CharacterStructured } from "@no-safe-word/image-gen";
import { PIPELINE_CONFIG } from "@no-safe-word/image-gen";

const MIN_PASSED_IMAGES = PIPELINE_CONFIG.minPassedImages;

// POST /api/stories/characters/[storyCharId]/resume-training
// Resume the LoRA pipeline after human dataset approval.
// Validates >= minPassedImages human-approved images exist before proceeding.
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    // 1. Fetch story character with character data
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

    // 2. Find the LoRA — accept awaiting_dataset_approval or failed (retry with existing dataset)
    const { data: lora, error: loraError } = await supabase
      .from("character_loras")
      .select("id, status, storage_url, filename")
      .eq("character_id", storyChar.character_id)
      .in("status", ["awaiting_dataset_approval", "failed", "training", "validating", "captioning",
                      "awaiting_pass2_approval", "training_pass2", "validating_pass2", "captioning_pass2"])
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (loraError || !lora) {
      return NextResponse.json(
        { error: "No LoRA ready to resume for this character" },
        { status: 400 }
      );
    }

    // 2b. Smart retry: if training already completed (file uploaded), skip to validation
    if (lora.status === "failed" && lora.storage_url && lora.filename) {
      console.log(`[LoRA API] LoRA ${lora.id} already trained (${lora.filename}). Skipping to validation.`);

      completeTrainingPipeline(lora.id, { supabase }).catch((err) => {
        console.error(`[LoRA API] Validation-only retry error:`, err);
      });

      return NextResponse.json({
        success: true,
        loraId: lora.id,
        message: `Re-running validation for already-trained LoRA (${lora.filename}).`,
      });
    }

    // 3. Count human-approved images
    const { count: approvedCount } = await supabase
      .from("lora_dataset_images")
      .select("*", { count: "exact", head: true })
      .eq("lora_id", lora.id)
      .eq("human_approved", true);

    if ((approvedCount || 0) < MIN_PASSED_IMAGES) {
      return NextResponse.json(
        {
          error: `Only ${approvedCount || 0} images approved (minimum ${MIN_PASSED_IMAGES} required)`,
        },
        { status: 400 }
      );
    }

    // 4. Build CharacterInput (same logic as train-lora route)
    const character = storyChar.characters as { id: string; name: string; description: Record<string, unknown> };
    const desc = character.description as Record<string, string>;

    const [portraitImage, fullBodyImage] = await Promise.all([
      supabase.from("images").select("stored_url, sfw_url").eq("id", storyChar.approved_image_id!).single(),
      supabase.from("images").select("stored_url, sfw_url").eq("id", storyChar.approved_fullbody_image_id!).single(),
    ]);

    const portraitUrl = portraitImage.data?.sfw_url || portraitImage.data?.stored_url;
    const fullBodyUrl = fullBodyImage.data?.sfw_url || fullBodyImage.data?.stored_url;

    if (!portraitUrl || !fullBodyUrl) {
      return NextResponse.json(
        { error: "Could not find stored URLs for approved images" },
        { status: 500 }
      );
    }

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

    // 5. Fire-and-forget — resume the pipeline in the background
    console.log(`[LoRA API] Resuming pipeline for ${character.name} (loraId: ${lora.id}, ${approvedCount} approved images)`);

    resumeTrainingPipeline(characterInput, lora.id, { supabase }).catch((err) => {
      console.error(`[LoRA API] Resume pipeline background error:`, err);
    });

    return NextResponse.json({
      success: true,
      loraId: lora.id,
      approvedImages: approvedCount,
      message: `Training resumed for ${character.name} with ${approvedCount} approved images.`,
    });
  } catch (err) {
    console.error("[Resume Training API] Failed:", err);
    return NextResponse.json(
      {
        error: "Failed to resume training",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
