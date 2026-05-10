import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

/**
 * POST /api/stories/characters/[storyCharId]/revoke-body
 *
 * User-initiated body revocation. Clears `approved_fullbody_image_id`
 * only. Does NOT touch `body_invalidated_at` (this is a deliberate user
 * action on a still-valid body, not a cascade) and does NOT touch any
 * face column.
 */
export async function POST(
  _request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const { storyCharId } = await props.params;

  try {
    const { data: storyChar, error: scError } = await supabase
      .from("story_characters")
      .select("id, character_id")
      .eq("id", storyCharId)
      .single();

    if (scError || !storyChar) {
      return NextResponse.json(
        { error: "Story character not found" },
        { status: 404 }
      );
    }

    const { error: updErr } = await supabase
      .from("characters")
      .update({ approved_fullbody_image_id: null })
      .eq("id", storyChar.character_id);

    if (updErr) {
      return NextResponse.json(
        { error: `Revoke failed: ${updErr.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[revoke-body] error:", err);
    return NextResponse.json(
      {
        error: "Revoke failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
