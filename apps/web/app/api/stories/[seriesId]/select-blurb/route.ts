import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { fireAndForgetInternalPost } from "@/lib/server/fire-and-forget";

// Node runtime — the fire-and-forget helper and supabase client both
// need Node APIs (fetch inherits Buffer handling, etc).
export const runtime = "nodejs";

// ============================================================
// POST /api/stories/[seriesId]/select-blurb
// ============================================================
// Records the user's blurb variant selection and, for short blurbs
// only, triggers a re-composite of the landscape cover sizes (og +
// email) so the selected short blurb renders on those composites.
//
// Long blurb selection does NOT trigger re-composite — the long
// blurb only appears on the website story detail page, never on a
// composite.
// ============================================================

type SelectBlurbBody = {
  kind: "short" | "long";
  selectedIndex: 0 | 1 | 2;
};

const VARIANT_COUNT = 3;

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const { seriesId } = await props.params;

  let body: SelectBlurbBody;
  try {
    body = (await request.json()) as SelectBlurbBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.kind !== "short" && body.kind !== "long") {
    return NextResponse.json(
      { error: "kind must be 'short' or 'long'" },
      { status: 400 }
    );
  }

  const idx = body.selectedIndex;
  if (!Number.isInteger(idx) || idx < 0 || idx >= VARIANT_COUNT) {
    return NextResponse.json(
      { error: `selectedIndex must be an integer 0–${VARIANT_COUNT - 1}` },
      { status: 400 }
    );
  }

  const variantsCol = body.kind === "short" ? "blurb_short_variants" : "blurb_long_variants";
  const selectedCol = body.kind === "short" ? "blurb_short_selected" : "blurb_long_selected";

  const { data: series, error: seriesErr } = await supabase
    .from("story_series")
    .select(`id, cover_status, ${variantsCol}`)
    .eq("id", seriesId)
    .single();

  if (seriesErr || !series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  const variants = (series as Record<string, unknown>)[variantsCol] as
    | string[]
    | null
    | undefined;
  if (!Array.isArray(variants) || variants.length !== VARIANT_COUNT) {
    return NextResponse.json(
      {
        error: `Series has no ${body.kind} blurb variants to select from. Re-import the story with marketing.${variantsCol} populated.`,
      },
      { status: 400 }
    );
  }
  if (typeof variants[idx] !== "string" || variants[idx].length === 0) {
    return NextResponse.json(
      { error: `Variant ${idx} is empty.` },
      { status: 400 }
    );
  }

  const { error: updErr } = await supabase
    .from("story_series")
    .update({ [selectedCol]: idx })
    .eq("id", seriesId);

  if (updErr) {
    return NextResponse.json(
      { error: `Failed to record selection: ${updErr.message}` },
      { status: 500 }
    );
  }

  // Short blurb selection changes the visible text on the og + email
  // landscape composites → trigger a re-composite. Only if cover
  // compositing has already completed at least once (cover_status ===
  // 'complete'). If it's still pending/generating/compositing, skip —
  // the natural approve-cover → composite-cover path will pick up the
  // selection when it runs. Long blurb selection never affects any
  // composite, so no trigger for it.
  if (body.kind === "short" && (series as { cover_status?: string }).cover_status === "complete") {
    fireAndForgetInternalPost(
      request,
      `/api/stories/${seriesId}/composite-cover`,
      undefined,
      { label: `select-blurb(short) → composite-cover (series=${seriesId})` }
    );
  }

  return NextResponse.json({
    [selectedCol]: idx,
  });
}
