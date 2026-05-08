import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import {
  AUTHOR_NOTES_KEYS,
  type AuthorNotes,
  type Json,
} from "@no-safe-word/shared";

// PATCH /api/stories/[seriesId]/update-author-notes
//
// Manual-edit endpoint for the four Stage 13 author-note format fields
// plus the accompanying-image prompt. The body specifies one field at a
// time:
//
//   { field: 'website_long' | 'email_version' | 'linkedin_post' |
//            'social_caption' | 'author_note_image_prompt',
//     value: string }
//
// For format fields, we update the JSONB at story_series.author_notes
// in place (read-modify-write). For author_note_image_prompt we update
// the dedicated text column.
//
// Approval lock: when story_series.author_note_approved_at is set, the
// route rejects with 409 + a "revoke first" hint. Stronger lock than
// Phase 3a's character profile fields because author notes feed Buffer
// scheduling and email sends — a sneaky edit after approval can desync
// from what got scheduled.

const FORMAT_FIELDS = new Set<keyof AuthorNotes>(AUTHOR_NOTES_KEYS);

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const { seriesId } = await props.params;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      field?: string;
      value?: unknown;
    };

    const field = typeof body.field === "string" ? body.field : null;
    if (!field) {
      return NextResponse.json(
        { error: "Body must include a `field` string" },
        { status: 400 }
      );
    }

    const isFormatField = FORMAT_FIELDS.has(field as keyof AuthorNotes);
    const isImagePrompt = field === "author_note_image_prompt";
    if (!isFormatField && !isImagePrompt) {
      return NextResponse.json(
        {
          error: `Unknown field '${field}'. Allowed: ${[
            ...AUTHOR_NOTES_KEYS,
            "author_note_image_prompt",
          ].join(", ")}`,
        },
        { status: 400 }
      );
    }

    const value = body.value;
    if (value !== null && typeof value !== "string") {
      return NextResponse.json(
        { error: "`value` must be a string or null" },
        { status: 400 }
      );
    }
    // For format fields, treat null/empty as "clear", but the approve
    // route will reject empty values. Empty image prompt is fine — it
    // simply blocks generation.
    const normalisedValue: string | null =
      value === null || (typeof value === "string" && value.trim().length === 0)
        ? null
        : (value as string);

    const { data: series, error: fetchErr } = await supabase
      .from("story_series")
      .select("id, author_notes, author_note_approved_at")
      .eq("id", seriesId)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!series) {
      return NextResponse.json({ error: "Series not found" }, { status: 404 });
    }

    if (series.author_note_approved_at !== null) {
      return NextResponse.json(
        {
          error:
            "Author's notes are approved and locked for editing. Revoke approval first.",
          code: "approved_locked",
        },
        { status: 409 }
      );
    }

    if (isImagePrompt) {
      const { error: updErr } = await supabase
        .from("story_series")
        .update({ author_note_image_prompt: normalisedValue })
        .eq("id", seriesId);
      if (updErr) throw new Error(updErr.message);
      return NextResponse.json({ updated: ["author_note_image_prompt"] });
    }

    // Format field — read/modify/write the JSONB. The validator rejects
    // unknown keys at import; this preserves the existing object shape.
    const existing = (series.author_notes ?? {}) as Record<string, unknown>;
    const next = { ...existing, [field]: normalisedValue ?? "" };
    const { error: updErr } = await supabase
      .from("story_series")
      .update({ author_notes: next as Json })
      .eq("id", seriesId);
    if (updErr) throw new Error(updErr.message);

    return NextResponse.json({ updated: [field] });
  } catch (err) {
    console.error("[update-author-notes] failed:", err);
    return NextResponse.json(
      {
        error: "Update failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
