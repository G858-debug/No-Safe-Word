import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// GET /api/stories/characters/[storyCharId]/lora-progress
// Poll the LoRA training pipeline progress for a character.
export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    // Fetch the story character to get the character_id and active_lora_id
    const { data: storyChar, error: scError } = await (supabase as any)
      .from("story_characters")
      .select("character_id, active_lora_id")
      .eq("id", storyCharId)
      .single() as { data: { character_id: string; active_lora_id: string | null } | null; error: any };

    if (scError || !storyChar) {
      return NextResponse.json(
        { error: "Story character not found" },
        { status: 404 }
      );
    }

    // Find the most relevant LoRA record
    const { data: lora } = await (supabase as any)
      .from("character_loras")
      .select("id, status, error, validation_score, training_attempts, training_id, trigger_word, storage_url, filename, created_at, updated_at, deployed_at")
      .eq("character_id", storyChar.character_id)
      .not("status", "eq", "archived")
      .order("created_at", { ascending: false })
      .limit(1)
      .single() as { data: any };

    if (!lora) {
      return NextResponse.json({ status: "no_lora", progress: null });
    }

    return NextResponse.json({
      loraId: lora.id,
      status: lora.status,
      progress: {
        stage: lora.status,
        error: lora.error,
        validationScore: lora.validation_score,
        trainingAttempts: lora.training_attempts,
        podId: lora.training_id,
        triggerWord: lora.trigger_word,
        loraUrl: lora.storage_url,
        filename: lora.filename,
        deployed: lora.status === "deployed",
        deployedAt: lora.deployed_at,
      },
    });
  } catch (err) {
    console.error("[LoRA API] Progress check failed:", err);
    return NextResponse.json(
      { error: "Failed to check progress", details: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
