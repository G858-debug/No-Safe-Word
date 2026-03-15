import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { runPipeline } from "@no-safe-word/image-gen/server/character-lora";
import type { CharacterInput, CharacterStructured } from "@no-safe-word/image-gen";

// POST /api/stories/characters/[storyCharId]/approve-dataset
// Approves the evaluated dataset and resumes the LoRA pipeline (captioning → training).
// Optionally accepts { rejectedImageIds: string[] } to exclude specific images.
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    const body = await request.json().catch(() => ({}));
    const rejectedImageIds: string[] = body.rejectedImageIds || [];

    // 1. Fetch story character with full character data
    const { data: storyChar, error: scError } = await (supabase as any)
      .from("story_characters")
      .select(`
        id, character_id, approved_image_id, approved_seed, approved_prompt,
        approved_fullbody_image_id, approved_fullbody_seed, active_lora_id,
        characters ( id, name, description )
      `)
      .eq("id", storyCharId)
      .single() as { data: any; error: any };

    if (scError || !storyChar) {
      return NextResponse.json({ error: "Story character not found" }, { status: 404 });
    }

    // 2. Find the LoRA awaiting approval
    const { data: lora, error: loraError } = await (supabase as any)
      .from("character_loras")
      .select("id, status, completed_stage")
      .eq("character_id", storyChar.character_id)
      .eq("status", "awaiting_dataset_approval")
      .order("created_at", { ascending: false })
      .limit(1)
      .single() as { data: any; error: any };

    if (loraError || !lora) {
      return NextResponse.json(
        { error: "No LoRA found awaiting dataset approval" },
        { status: 404 }
      );
    }

    // 3. Mark any user-rejected images as failed so they are excluded from training
    if (rejectedImageIds.length > 0) {
      await supabase
        .from("lora_dataset_images")
        .update({ eval_status: "failed" })
        .in("id", rejectedImageIds)
        .eq("lora_id", lora.id);

      console.log(`[Approve Dataset] Rejected ${rejectedImageIds.length} images for LoRA ${lora.id}`);
    }

    // 4. Build CharacterInput to resume the pipeline
    const character = storyChar.characters as { id: string; name: string; description: Record<string, unknown> };
    const desc = character.description as Record<string, string>;

    const [portraitImage, fullBodyImage] = await Promise.all([
      supabase.from("images").select("stored_url, sfw_url").eq("id", storyChar.approved_image_id!).single(),
      supabase.from("images").select("stored_url, sfw_url").eq("id", storyChar.approved_fullbody_image_id!).single(),
    ]);

    const portraitUrl = portraitImage.data?.sfw_url || portraitImage.data?.stored_url;
    const fullBodyUrl = fullBodyImage.data?.sfw_url || fullBodyImage.data?.stored_url;

    if (!portraitUrl || !fullBodyUrl) {
      return NextResponse.json({ error: "Could not find stored URLs for approved images" }, { status: 500 });
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

    // 5. Resume the pipeline — it will see completed_stage='evaluation' and skip to captioning
    console.log(`[Approve Dataset] Resuming pipeline for ${character.name} (loraId: ${lora.id})`);
    runPipeline(characterInput, lora.id, { supabase }).catch((err) => {
      console.error(`[Approve Dataset] Pipeline background error:`, err);
    });

    return NextResponse.json({
      success: true,
      loraId: lora.id,
      message: `Dataset approved for ${character.name}. Pipeline resuming from captioning.`,
    });
  } catch (err) {
    console.error("[Approve Dataset] Failed:", err);
    return NextResponse.json(
      { error: "Failed to approve dataset", details: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
