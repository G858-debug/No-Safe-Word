import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// GET /api/stories/characters/[storyCharId]/dataset-images
// Returns the evaluated dataset images for the character's current LoRA.
export async function GET(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    const { data: storyChar, error: scError } = await supabase
      .from("story_characters")
      .select("character_id")
      .eq("id", storyCharId)
      .single();

    if (scError || !storyChar) {
      return NextResponse.json({ error: "Story character not found" }, { status: 404 });
    }

    // Get the most recent LoRA for this character
    const { data: lora, error: loraError } = await supabase
      .from("character_loras")
      .select("id, status")
      .eq("character_id", storyChar.character_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (loraError || !lora) {
      return NextResponse.json({ error: "No LoRA found for character" }, { status: 404 });
    }

    // Fetch all dataset images with their evaluation results
    const { data: images, error: imgError } = await supabase
      .from("lora_dataset_images")
      .select("id, image_url, category, variation_type, source, eval_status, eval_score, eval_details, caption, created_at")
      .eq("lora_id", lora.id)
      .order("eval_score", { ascending: false, nullsFirst: false });

    if (imgError) {
      return NextResponse.json({ error: "Failed to fetch dataset images" }, { status: 500 });
    }

    return NextResponse.json({
      loraId: lora.id,
      loraStatus: lora.status,
      images: images || [],
    });
  } catch (err) {
    console.error("[Dataset Images API] Failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch dataset images", details: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
