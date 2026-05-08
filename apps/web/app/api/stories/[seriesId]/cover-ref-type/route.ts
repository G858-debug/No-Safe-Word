import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

export const runtime = "nodejs";

// PATCH /api/stories/[seriesId]/cover-ref-type
//
// Set the per-character reference-type selection used by the next cover
// generation. `face` uses `characters.approved_image_id` as the reference
// image; `body` uses `characters.approved_fullbody_image_id`.
//
// Body: { primary_ref_type?: "face" | "body";
//         secondary_ref_type?: "face" | "body" | null }
//
// Both fields are optional; only the supplied ones are written. Locked
// during generating/compositing/approved/complete because flipping the
// reference at those moments would invalidate the variants.
export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
): Promise<NextResponse> {
  const { seriesId } = await props.params;

  let body: {
    primary_ref_type?: "face" | "body";
    secondary_ref_type?: "face" | "body" | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const hasPrimary = body.primary_ref_type !== undefined;
  const hasSecondary = body.secondary_ref_type !== undefined;

  if (!hasPrimary && !hasSecondary) {
    return NextResponse.json(
      {
        error:
          "At least one of primary_ref_type or secondary_ref_type must be supplied.",
      },
      { status: 400 }
    );
  }

  if (hasPrimary && body.primary_ref_type !== "face" && body.primary_ref_type !== "body") {
    return NextResponse.json(
      { error: "primary_ref_type must be 'face' or 'body'" },
      { status: 400 }
    );
  }
  if (
    hasSecondary &&
    body.secondary_ref_type !== null &&
    body.secondary_ref_type !== "face" &&
    body.secondary_ref_type !== "body"
  ) {
    return NextResponse.json(
      { error: "secondary_ref_type must be 'face', 'body', or null" },
      { status: 400 }
    );
  }

  const { data: series, error: seriesErr } = await supabase
    .from("story_series")
    .select("id, cover_status")
    .eq("id", seriesId)
    .single();

  if (seriesErr || !series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  const lockedStatuses = new Set([
    "generating",
    "compositing",
    "approved",
    "complete",
  ]);
  if (lockedStatuses.has(series.cover_status)) {
    return NextResponse.json(
      {
        error: `Cannot change cover reference type while cover_status='${series.cover_status}'. Reset the cover first.`,
      },
      { status: 409 }
    );
  }

  const updates: Record<string, unknown> = {};
  if (hasPrimary) updates.cover_primary_ref_type = body.primary_ref_type;
  if (hasSecondary) updates.cover_secondary_ref_type = body.secondary_ref_type;

  const { error: updErr } = await supabase
    .from("story_series")
    .update(updates)
    .eq("id", seriesId);

  if (updErr) {
    return NextResponse.json(
      { error: `Failed to update cover ref types: ${updErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, ...updates });
}
