import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

export const runtime = "nodejs";

// POST /api/stories/[seriesId]/update-blurb
// Overwrites a single blurb variant slot with user-edited text.
// Does NOT change the selected index — if the selected variant is
// edited, the selection stays pointing at the updated text.

const VARIANT_COUNT = 3;

type UpdateBlurbBody = {
  kind: "short" | "long";
  index: number;
  text: string;
};

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const { seriesId } = await props.params;

  let body: UpdateBlurbBody;
  try {
    body = (await request.json()) as UpdateBlurbBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.kind !== "short" && body.kind !== "long") {
    return NextResponse.json({ error: "kind must be 'short' or 'long'" }, { status: 400 });
  }
  if (!Number.isInteger(body.index) || body.index < 0 || body.index >= VARIANT_COUNT) {
    return NextResponse.json(
      { error: `index must be an integer 0–${VARIANT_COUNT - 1}` },
      { status: 400 }
    );
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text must be non-empty" }, { status: 400 });
  }

  const variantsCol =
    body.kind === "short" ? "blurb_short_variants" : "blurb_long_variants";

  const { data: series, error: seriesErr } = await supabase
    .from("story_series")
    .select(`id, ${variantsCol}`)
    .eq("id", seriesId)
    .single();

  if (seriesErr || !series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  const variants = (series as Record<string, unknown>)[variantsCol] as
    | string[]
    | null;
  if (!Array.isArray(variants) || variants.length !== VARIANT_COUNT) {
    return NextResponse.json(
      { error: `No ${body.kind} blurb variants to update` },
      { status: 400 }
    );
  }

  const updated = [...variants];
  updated[body.index] = text;

  const { error: updErr } = await supabase
    .from("story_series")
    .update({ [variantsCol]: updated })
    .eq("id", seriesId);

  if (updErr) {
    return NextResponse.json(
      { error: `Failed to save blurb: ${updErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ [variantsCol]: updated });
}
