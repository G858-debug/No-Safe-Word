import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { MIN_CATEGORY_COUNTS } from "@no-safe-word/image-gen";

// GET /api/stories/characters/[storyCharId]/dataset-gaps
// Returns the current category gap status for a character's active LoRA dataset.
// Used by the dashboard to surface gaps for datasets generated before the gap-check was added to the pipeline.
export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const { storyCharId } = await props.params;

  // 1. Fetch story character
  const { data: storyChar, error: scError } = await (supabase as any)
    .from("story_characters")
    .select("id, character_id")
    .eq("id", storyCharId)
    .single() as { data: any; error: any };

  if (scError || !storyChar) {
    return NextResponse.json({ error: "Story character not found" }, { status: 404 });
  }

  // 2. Find the active LoRA awaiting approval
  const { data: lora, error: loraError } = await supabase
    .from("character_loras")
    .select("id, status")
    .eq("character_id", storyChar.character_id)
    .in("status", ["awaiting_dataset_approval", "awaiting_pass2_approval"])
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (loraError || !lora) {
    return NextResponse.json({ hasGaps: false, deficits: [], message: null });
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
  const deficits: Array<{ category: string; have: number; need: number }> = [];
  for (const [cat, minCount] of Object.entries(MIN_CATEGORY_COUNTS)) {
    const have = categoryCounts[cat] || 0;
    if (have < minCount) {
      deficits.push({ category: cat, have, need: minCount });
    }
  }

  if (deficits.length === 0) {
    return NextResponse.json({ hasGaps: false, deficits: [], message: null });
  }

  const gapDescription = deficits
    .map((d) => `${d.category}: need ${d.need}, have ${d.have}`)
    .join("; ");

  return NextResponse.json({
    hasGaps: true,
    deficits,
    message: `Category gaps: ${gapDescription}. Use "Generate More" to fill gaps or continue anyway.`,
  });
}
