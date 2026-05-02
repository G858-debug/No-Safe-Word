import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

export const runtime = "nodejs";

// ============================================================
// PATCH /api/stories/[seriesId]/cover-prompt
// ============================================================
// Persist `story_series.cover_prompt` without triggering generation.
// The Cover page's textarea uses this for an explicit "Save" button so
// users can iterate on prompt text without burning GPU on every edit.
//
// generate-cover also persists cover_prompt as a side effect when a
// prompt is supplied — this endpoint is the no-generation alternative.
//
// Body: { prompt: string }
// ============================================================
export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
): Promise<NextResponse> {
  const { seriesId } = await props.params;

  let body: { prompt?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.prompt !== "string") {
    return NextResponse.json(
      { error: "prompt must be a string" },
      { status: 400 }
    );
  }
  const trimmed = body.prompt.trim();
  if (trimmed.length === 0) {
    return NextResponse.json(
      { error: "prompt cannot be empty — clear it by regenerating instead" },
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

  // Allow saving in any state except compositing — the typography pass is
  // mid-execution and the prompt isn't relevant to it. Saving while
  // generating/approved is fine; the new prompt only takes effect on the
  // next generation.
  if (series.cover_status === "compositing") {
    return NextResponse.json(
      { error: "Cannot save prompt while compositing. Wait for it to finish." },
      { status: 409 }
    );
  }

  const { error: updErr } = await supabase
    .from("story_series")
    .update({ cover_prompt: trimmed })
    .eq("id", seriesId);

  if (updErr) {
    return NextResponse.json(
      { error: `Failed to save cover prompt: ${updErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, cover_prompt: trimmed });
}
