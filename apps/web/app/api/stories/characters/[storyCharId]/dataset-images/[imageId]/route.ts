import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// PATCH /api/stories/characters/[storyCharId]/dataset-images/[imageId]
// Updates caption on a dataset image.
export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string; imageId: string }> }
) {
  const params = await props.params;
  const { storyCharId, imageId } = params;

  try {
    const body = await request.json();
    const { caption } = body;

    if (typeof caption !== "string") {
      return NextResponse.json({ error: "caption must be a string" }, { status: 400 });
    }

    // Resolve storyCharId → character_id → LoRA
    const { data: storyChar, error: scError } = await (supabase as any)
      .from("story_characters")
      .select("character_id, active_lora_id")
      .eq("id", storyCharId)
      .single();

    if (scError || !storyChar) {
      return NextResponse.json({ error: "Story character not found" }, { status: 404 });
    }

    // Find the most recent LoRA
    let loraQuery = supabase
      .from("character_loras")
      .select("id")
      .eq("character_id", storyChar.character_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (storyChar.active_lora_id) {
      loraQuery = supabase
        .from("character_loras")
        .select("id")
        .eq("id", storyChar.active_lora_id)
        .single();
    }

    const { data: lora, error: loraError } = await loraQuery;
    if (loraError || !lora) {
      return NextResponse.json({ error: "No LoRA found" }, { status: 404 });
    }

    // Update caption — scoped to this LoRA for security
    const { error: updateError } = await supabase
      .from("lora_dataset_images")
      .update({ caption } as any)
      .eq("id", imageId)
      .eq("lora_id", lora.id);

    if (updateError) {
      return NextResponse.json(
        { error: `Failed to update caption: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Dataset Image PATCH] Failed:", err);
    return NextResponse.json({ error: "Failed to update image" }, { status: 500 });
  }
}
