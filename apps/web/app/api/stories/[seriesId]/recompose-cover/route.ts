import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { runCoverCompositing } from "@/lib/server/run-cover-compositing";
import { logEvent } from "@/lib/server/events";
import { revalidateSeriesById } from "@/lib/server/revalidate-series";

// sharp, satori, and resvg all require native bindings and fs access —
// Node.js runtime only, never edge.
export const runtime = "nodejs";
// Compositing is bursty and can take 15–30s for the full 4-size pass.
// Add a margin for the stale-state revert + finalize.
export const maxDuration = 120;

// ============================================================
// POST /api/stories/[seriesId]/recompose-cover
// ============================================================
// Synchronous, auth-gated retry endpoint. Triggered by the dashboard
// polling loop ~30s after approval (see CoverApproval.tsx) and by the
// "Retry" button in the fallback/error UI.
//
// Differs from /composite-cover only in:
//   1. Recovers stale 'compositing' state (>2min old) by reverting to
//      'approved' before delegating, so a hung previous run doesn't
//      block forever.
//   2. Logs cover.recomposite_started before the work and
//      cover.recomposite_completed after success — these bracket the
//      composite_* events that the library logs internally.
// ============================================================

const STALE_COMPOSITING_THRESHOLD_MS = 2 * 60 * 1000;

export async function POST(
  _request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const { seriesId } = await props.params;

  const { data: series, error: seriesErr } = await supabase
    .from("story_series")
    .select("cover_status, cover_base_url, updated_at")
    .eq("id", seriesId)
    .single();

  if (seriesErr || !series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  if (!series.cover_base_url) {
    return NextResponse.json(
      { error: "Cover base image URL is missing. Approve a cover variant first." },
      { status: 400 }
    );
  }

  if (series.cover_status !== "approved" && series.cover_status !== "compositing") {
    return NextResponse.json(
      {
        error: `Cannot recompose from status '${series.cover_status}'. Must be 'approved' or 'compositing'.`,
      },
      { status: 400 }
    );
  }

  // Stale-compositing recovery: if a previous run is still in 'compositing'
  // but updated_at is >2 min old, treat it as hung and revert before retry.
  // If <2 min, treat it as actively in progress — return 409.
  if (series.cover_status === "compositing") {
    const ageMs = Date.now() - new Date(series.updated_at).getTime();
    if (ageMs <= STALE_COMPOSITING_THRESHOLD_MS) {
      return NextResponse.json(
        { error: "Compositing already in progress; try again in a minute." },
        { status: 409 }
      );
    }
    const { error: revertErr } = await supabase
      .from("story_series")
      .update({
        cover_status: "approved",
        cover_error: "Stale compositing state — reverted by recompose-cover after 2 min",
      })
      .eq("id", seriesId);
    if (revertErr) {
      return NextResponse.json(
        { error: `Failed to revert stale compositing state: ${revertErr.message}` },
        { status: 500 }
      );
    }
  }

  await logEvent({
    eventType: "cover.recomposite_started",
    metadata: { series_id: seriesId },
  });

  const result = await runCoverCompositing(seriesId);

  if (result.ok) {
    await logEvent({
      eventType: "cover.recomposite_completed",
      metadata: { series_id: seriesId },
    });
    await revalidateSeriesById(seriesId);
    return NextResponse.json({
      coverStatus: "complete",
      coverSizes: result.coverSizes,
    });
  }

  return NextResponse.json({ error: result.error }, { status: result.status });
}
