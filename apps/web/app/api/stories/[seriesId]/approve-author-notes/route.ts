import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { AUTHOR_NOTES_KEYS, type AuthorNotes } from "@no-safe-word/shared";

// POST /api/stories/[seriesId]/approve-author-notes
//
// Stamps story_series.author_note_approved_at = now() after enforcing the
// same gate the UI does:
//   - All four format fields are non-null, non-empty strings
//   - author_note_image_url is set
//
// Mirrors the Phase 3a approve-card route: client-side gate is informative,
// server-side gate is the contract. A 409 includes the missing fields so
// the UI can surface a precise message if the row drifted between gate
// computation and click.

export async function POST(
  _request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const { seriesId } = await props.params;

  try {
    const { data: series, error: fetchErr } = await supabase
      .from("story_series")
      .select(
        "id, author_notes, author_note_image_url, author_note_approved_at"
      )
      .eq("id", seriesId)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!series) {
      return NextResponse.json({ error: "Series not found" }, { status: 404 });
    }

    if (series.author_note_approved_at !== null) {
      return NextResponse.json(
        { error: "Author's notes are already approved." },
        { status: 409 }
      );
    }

    const notes = (series.author_notes ?? null) as AuthorNotes | null;
    const missing: string[] = [];
    if (!notes) {
      missing.push("author_notes");
    } else {
      for (const key of AUTHOR_NOTES_KEYS) {
        const value = notes[key];
        if (typeof value !== "string" || value.trim().length === 0) {
          missing.push(`author_notes.${key}`);
        }
      }
    }
    if (!series.author_note_image_url) {
      missing.push("author_note_image_url");
    }

    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: "Cannot approve — missing required fields",
          missing,
        },
        { status: 400 }
      );
    }

    const approvedAt = new Date().toISOString();
    const { error: updErr } = await supabase
      .from("story_series")
      .update({ author_note_approved_at: approvedAt })
      .eq("id", seriesId);
    if (updErr) throw new Error(updErr.message);

    return NextResponse.json({ author_note_approved_at: approvedAt });
  } catch (err) {
    console.error("[approve-author-notes] failed:", err);
    return NextResponse.json(
      {
        error: "Approval failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
