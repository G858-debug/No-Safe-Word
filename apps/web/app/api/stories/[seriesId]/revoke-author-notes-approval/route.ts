import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// POST /api/stories/[seriesId]/revoke-author-notes-approval
//
// Clears story_series.author_note_approved_at. Re-opens the four format
// fields and the accompanying-image regenerate button for editing.
//
// Idempotent — already-null is not an error.

export async function POST(
  _request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const { seriesId } = await props.params;

  try {
    const { data: existing } = await supabase
      .from("story_series")
      .select("id")
      .eq("id", seriesId)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: "Series not found" }, { status: 404 });
    }

    const { error: updErr } = await supabase
      .from("story_series")
      .update({ author_note_approved_at: null })
      .eq("id", seriesId);
    if (updErr) throw new Error(updErr.message);

    return NextResponse.json({ author_note_approved_at: null });
  } catch (err) {
    console.error("[revoke-author-notes-approval] failed:", err);
    return NextResponse.json(
      {
        error: "Revocation failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
