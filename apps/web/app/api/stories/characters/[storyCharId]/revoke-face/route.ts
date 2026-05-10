import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { runFaceRevokeCascade } from "@/lib/server/portrait-cascade";

/**
 * POST /api/stories/characters/[storyCharId]/revoke-face
 *
 * Clears face approval. If a body image exists (approved or
 * Generated-unapproved), also clears the approved body slot and stamps
 * `body_invalidated_at = now()` so the UI can render a stale banner.
 *
 * Cascade decision lives entirely in `runFaceRevokeCascade`. Idempotent.
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

    const result = await runFaceRevokeCascade(supabase, storyChar.character_id);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? "Revoke failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, cascaded: result.cascaded });
  } catch (err) {
    console.error("[revoke-face] error:", err);
    return NextResponse.json(
      {
        error: "Revoke failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
