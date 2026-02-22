import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { getPipelineProgress } from "@no-safe-word/image-gen/server/character-lora";

// GET /api/stories/characters/[storyCharId]/lora-progress
// Poll the LoRA training pipeline progress for a character.
export async function GET(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    // Fetch the story character to get the character_id
    const { data: storyChar, error: scError } = await supabase
      .from("story_characters")
      .select("character_id")
      .eq("id", storyCharId)
      .single();

    if (scError || !storyChar) {
      return NextResponse.json(
        { error: "Story character not found" },
        { status: 404 }
      );
    }

    const progress = await getPipelineProgress(storyChar.character_id, { supabase });

    if (!progress) {
      return NextResponse.json({ status: "no_lora", progress: null });
    }

    return NextResponse.json(progress);
  } catch (err) {
    console.error("[LoRA API] Progress check failed:", err);
    return NextResponse.json(
      { error: "Failed to check progress", details: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
