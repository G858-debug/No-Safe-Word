import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

export const runtime = "nodejs";

/**
 * GET /api/stories/[seriesId]/pending-cover-jobs
 *
 * Returns job_ids of cover_variant generation_jobs still in status='pending'
 * for this series. Used by the publisher page on load to trigger reconciliation:
 * the client calls /api/status/[jobId] for each returned ID to drive state
 * transitions when the user returns after navigating away mid-generation.
 */
export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
): Promise<NextResponse> {
  const { seriesId } = await props.params;

  const { data: jobs, error } = await supabase
    .from("generation_jobs")
    .select("job_id")
    .eq("series_id", seriesId)
    .eq("job_type", "cover_variant")
    .eq("status", "pending");

  if (error) {
    return NextResponse.json({ jobIds: [] });
  }

  return NextResponse.json({
    jobIds: (jobs ?? []).map((j) => j.job_id as string),
  });
}
