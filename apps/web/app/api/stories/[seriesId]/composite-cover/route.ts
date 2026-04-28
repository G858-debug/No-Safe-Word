import { NextRequest, NextResponse } from "next/server";
import { runCoverCompositing } from "@/lib/server/run-cover-compositing";

// sharp, satori, and resvg all require native bindings and fs access —
// Node.js runtime only, never edge.
export const runtime = "nodejs";
// Compositing is bursty and can take 15–30s for the full 4-size pass;
// don't let Vercel/Railway inactivity auto-timeouts cut us off.
export const maxDuration = 120;

// ============================================================
// POST /api/stories/[seriesId]/composite-cover
// ============================================================
// Thin HTTP wrapper around runCoverCompositing(). The state machine,
// 4-size pipeline, upload, and event logging all live in the library
// at lib/server/run-cover-compositing.ts so /recompose-cover can share
// the same implementation.
// ============================================================

export async function POST(
  _request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const { seriesId } = await props.params;
  const result = await runCoverCompositing(seriesId);
  if (result.ok) {
    return NextResponse.json({ coverStatus: "complete", coverSizes: result.coverSizes });
  }
  return NextResponse.json({ error: result.error }, { status: result.status });
}
