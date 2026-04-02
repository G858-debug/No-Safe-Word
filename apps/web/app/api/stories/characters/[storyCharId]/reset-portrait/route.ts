import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

/**
 * POST /api/stories/characters/[storyCharId]/reset-portrait
 *
 * Reset a character back to portrait stage so the user can regenerate
 * their appearance. Archives any active LoRA and clears approval fields.
 *
 * Body: { resetFace?: boolean }
 *   - resetFace: true  → clear both portrait AND full-body (full reset)
 *   - resetFace: false → clear only full-body, keep portrait (default)
 */
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  try {
    const params = await props.params;
    const { storyCharId } = params;
    const body = await request.json().catch(() => ({}));
    const { resetFace = true } = body as { resetFace?: boolean };

    // Verify story character exists
    const { data: storyChar, error: scErr } = await (supabase as any)
      .from("story_characters")
      .select("id, character_id, active_lora_id")
      .eq("id", storyCharId)
      .single();

    if (scErr || !storyChar) {
      return NextResponse.json({ error: "Story character not found" }, { status: 404 });
    }

    // Archive any non-archived LoRA records for this character
    if (storyChar.character_id) {
      await (supabase as any)
        .from("character_loras")
        .update({ status: "archived", updated_at: new Date().toISOString() })
        .eq("character_id", storyChar.character_id)
        .not("status", "eq", "archived");
    }

    // Build the update — always clear full-body + LoRA link
    const updateFields: Record<string, unknown> = {
      approved_fullbody: false,
      approved_fullbody_image_id: null,
      approved_fullbody_seed: null,
      approved_fullbody_prompt: null,
      active_lora_id: null,
    };

    // If resetting face too, clear portrait fields
    if (resetFace) {
      updateFields.approved = false;
      updateFields.approved_image_id = null;
      updateFields.approved_seed = null;
      updateFields.approved_prompt = null;
      updateFields.face_url = null;
    }

    const { error: updateErr } = await (supabase as any)
      .from("story_characters")
      .update(updateFields)
      .eq("id", storyCharId);

    if (updateErr) {
      return NextResponse.json({ error: `Update failed: ${updateErr.message}` }, { status: 500 });
    }

    console.log(`[ResetPortrait] Reset ${storyCharId} to portrait stage (resetFace: ${resetFace})`);
    return NextResponse.json({ ok: true, resetFace });
  } catch (err) {
    console.error("[ResetPortrait] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
