import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// POST /api/stories/characters/[storyCharId]/approve-dataset
// Set human_approved on one or more dataset images.
// Body: { imageIds: string[], approved: boolean }
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    const body = await request.json();
    const { imageIds, approved } = body;

    if (!Array.isArray(imageIds) || imageIds.length === 0) {
      return NextResponse.json(
        { error: "imageIds must be a non-empty array" },
        { status: 400 }
      );
    }

    if (typeof approved !== "boolean") {
      return NextResponse.json(
        { error: "approved must be a boolean" },
        { status: 400 }
      );
    }

    // Verify the story character exists and get its active LoRA
    const { data: storyChar, error: scError } = await (supabase as any)
      .from("story_characters")
      .select("character_id, active_lora_id")
      .eq("id", storyCharId)
      .single();

    if (scError || !storyChar) {
      return NextResponse.json(
        { error: "Story character not found" },
        { status: 404 }
      );
    }

    // Find the most recent LoRA for this character
    let loraQuery = supabase
      .from("character_loras")
      .select("id, status")
      .eq("character_id", storyChar.character_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (storyChar.active_lora_id) {
      loraQuery = supabase
        .from("character_loras")
        .select("id, status")
        .eq("id", storyChar.active_lora_id)
        .single();
    }

    const { data: lora, error: loraError } = await loraQuery;

    if (loraError || !lora) {
      return NextResponse.json(
        { error: "No LoRA found for this character" },
        { status: 404 }
      );
    }

    // Update human_approved for the specified images (only if they belong to this LoRA)
    const { error: updateError, count } = await supabase
      .from("lora_dataset_images")
      .update({ human_approved: approved } as any)
      .eq("lora_id", lora.id)
      .in("id", imageIds);

    if (updateError) {
      return NextResponse.json(
        { error: `Failed to update: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      updated: count || imageIds.length,
    });
  } catch (err) {
    console.error("[Approve Dataset API] Failed:", err);
    return NextResponse.json(
      { error: "Failed to update dataset approval" },
      { status: 500 }
    );
  }
}
