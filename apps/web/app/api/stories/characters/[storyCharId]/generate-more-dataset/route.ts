import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { generateTopUpImages } from "@no-safe-word/image-gen";
import type { CharacterInput, CharacterStructured } from "@no-safe-word/image-gen";

const MIN_CATEGORY_COUNTS: Record<string, number> = {
  "face-closeup": 5,
  "full-body": 4,
  "head-shoulders": 3,
  "waist-up": 2,
};

// POST /api/stories/characters/[storyCharId]/generate-more-dataset
// Generates additional images for deficit categories without restarting the entire pipeline.
export async function POST(
  _request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const { storyCharId } = await props.params;

  try {
    // 1. Fetch story character
    const { data: storyChar, error: scError } = await (supabase as any)
      .from("story_characters")
      .select(`
        id, character_id, approved_seed,
        characters ( id, name, description )
      `)
      .eq("id", storyCharId)
      .single() as { data: any; error: any };

    if (scError || !storyChar) {
      return NextResponse.json({ error: "Story character not found" }, { status: 404 });
    }

    // 2. Find the active LoRA in awaiting_dataset_approval or awaiting_pass2_approval
    const { data: lora, error: loraError } = await supabase
      .from("character_loras")
      .select("id, status, character_id")
      .eq("character_id", storyChar.character_id)
      .in("status", ["awaiting_dataset_approval", "awaiting_pass2_approval"])
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (loraError || !lora) {
      return NextResponse.json(
        { error: "No LoRA awaiting dataset approval for this character" },
        { status: 400 }
      );
    }

    // 3. Count passed images per category
    const { data: passedImages } = await supabase
      .from("lora_dataset_images")
      .select("category")
      .eq("lora_id", lora.id)
      .eq("eval_status", "passed");

    const categoryCounts: Record<string, number> = {};
    for (const img of passedImages || []) {
      categoryCounts[img.category] = (categoryCounts[img.category] || 0) + 1;
    }

    // 4. Calculate deficits
    const deficits: Array<{ category: string; needed: number }> = [];
    for (const [cat, minCount] of Object.entries(MIN_CATEGORY_COUNTS)) {
      const have = categoryCounts[cat] || 0;
      if (have < minCount) {
        deficits.push({ category: cat, needed: minCount - have });
      }
    }

    if (deficits.length === 0) {
      return NextResponse.json({ message: "No category deficits — all minimums met", deficits: [] });
    }

    // 5. Build CharacterInput
    const character = storyChar.characters as { id: string; name: string; description: Record<string, string> };
    const desc = character.description as Record<string, string>;

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
      approvedImageUrl: "",
      approvedPrompt: "",
      fullBodyImageUrl: "",
      fullBodySeed: 42,
      portraitSeed: storyChar.approved_seed || 42,
      structuredData,
      pipelineType: "story_character",
    };

    // 6. Generate top-up images
    const result = await generateTopUpImages(characterInput, lora.id, deficits, { supabase });

    // 7. Clear the category gap error if generation succeeded
    if (result.generated > 0) {
      await (supabase as any)
        .from("character_loras")
        .update({ error: null, updated_at: new Date().toISOString() })
        .eq("id", lora.id);
    }

    return NextResponse.json({
      generated: result.generated,
      failed: result.failed,
      deficits,
      message: `Generated ${result.generated} top-up images for ${deficits.map(d => d.category).join(", ")}`,
    });
  } catch (err) {
    console.error("[Generate More Dataset] Failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate more images" },
      { status: 500 }
    );
  }
}
