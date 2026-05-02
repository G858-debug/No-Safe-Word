import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

/**
 * POST /api/stories/characters/[storyCharId]/reset-portrait
 *
 * Clears the approved portrait on the base `characters` row so the user can
 * regenerate. Because portraits are canonical per identity, this affects
 * every story that features this character.
 *
 * No body parameters. Pass 3 ties face + body together, so reset clears
 * `approved_fullbody_image_id` alongside the face fields. The dormant
 * `approved_fullbody_seed` / `approved_fullbody_prompt` columns are left
 * null since Pass 3 doesn't write them.
 */
export async function POST(
  _request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  try {
    const params = await props.params;
    const { storyCharId } = params;

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

    const { error: updateErr } = await supabase
      .from("characters")
      .update({
        approved_image_id: null,
        approved_seed: null,
        approved_prompt: null,
        portrait_prompt_locked: null,
        approved_fullbody_image_id: null,
      })
      .eq("id", storyChar.character_id);

    if (updateErr) {
      return NextResponse.json(
        { error: `Update failed: ${updateErr.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[ResetPortrait] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
