import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

/**
 * POST /api/stories/characters/[storyCharId]/reset-portrait
 *
 * Clear approved portrait / full-body state on the base `characters` row so
 * the user can regenerate. Because portraits are canonical per identity, this
 * affects every story that features this character.
 *
 * Body: { resetFace?: boolean }
 *   - resetFace: true  → clear BOTH portrait AND full-body (default)
 *   - resetFace: false → clear only full-body, keep portrait
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

    const { data: storyChar, error: scErr } = await supabase
      .from("story_characters")
      .select("id, character_id")
      .eq("id", storyCharId)
      .single();

    if (scErr || !storyChar) {
      return NextResponse.json(
        { error: "Story character not found" },
        { status: 404 }
      );
    }

    const updateFields: Record<string, unknown> = {
      approved_fullbody_image_id: null,
      approved_fullbody_seed: null,
      approved_fullbody_prompt: null,
    };

    if (resetFace) {
      updateFields.approved_image_id = null;
      updateFields.approved_seed = null;
      updateFields.approved_prompt = null;
      updateFields.portrait_prompt_locked = null;
    }

    const { error: updateErr } = await supabase
      .from("characters")
      .update(updateFields)
      .eq("id", storyChar.character_id);

    if (updateErr) {
      return NextResponse.json(
        { error: `Update failed: ${updateErr.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, resetFace });
  } catch (err) {
    console.error("[ResetPortrait] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
