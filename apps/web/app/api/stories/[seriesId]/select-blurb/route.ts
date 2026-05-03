import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { runCoverCompositing } from "@/lib/server/run-cover-compositing";
import { revalidateSeriesById } from "@/lib/server/revalidate-series";

// Node runtime — the supabase client and runCoverCompositing both need
// Node APIs (sharp/satori/resvg native bindings, fs reads).
export const runtime = "nodejs";
// When kind='short' and the cover is already complete we re-composite
// inline, which can take 15–30s.
export const maxDuration = 120;

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
  // landscape composites → re-composite synchronously. We block the
  // response for ~15–30s rather than fire-and-forget because the
  // previous fire-and-forget was failing silently (middleware rejected
  // the unauth'd internal call with 401 — see Phase B2 plan). Calling
  // the library directly avoids the HTTP hop entirely, no auth needed.
  //
  // Only triggers when cover_status='complete'. For other states the
  // approve-cover → recompose-cover flow will pick up the new selection
  // when it runs. Long blurb selection never affects any composite.
  let compositeResult: { ok: true } | { ok: false; error: string } | null = null;
  if (body.kind === "short" && (series as { cover_status?: string }).cover_status === "complete") {
    const result = await runCoverCompositing(seriesId);
    compositeResult = result.ok
      ? { ok: true }
      : { ok: false, error: result.error };
  }

  await revalidateSeriesById(seriesId);

  return NextResponse.json({
    [selectedCol]: idx,
    recomposite: compositeResult,
  });
}
