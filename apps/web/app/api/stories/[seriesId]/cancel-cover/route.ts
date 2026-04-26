import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

export const runtime = "nodejs";

/**
 * POST /api/stories/[seriesId]/cancel-cover
 *
 * Cancels all pending/processing cover_variant jobs for a series:
 *   1. Fetches pending/processing generation_jobs rows
 *   2. Calls RunPod cancel for each (best-effort, non-throwing)
 *   3. Marks each job as failed with "Cancelled by user"
 *   4. Resets story_series.cover_status → 'pending' and clears cover_variants
 *
 * The user can then trigger a fresh cover generation.
 */
export async function POST(
  _request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
): Promise<NextResponse> {
  const { seriesId } = await props.params;

  // Fetch all pending/processing cover jobs for this series
  const { data: jobs, error: jobsError } = await supabase
    .from("generation_jobs")
    .select("job_id, status")
    .eq("series_id", seriesId)
    .eq("job_type", "cover_variant")
    .in("status", ["pending", "processing"]);

  if (jobsError) {
    return NextResponse.json(
      { error: `Failed to fetch jobs: ${jobsError.message}` },
      { status: 500 }
    );
  }

  const jobIds = (jobs ?? []).map((j) => j.job_id as string);

  // Cancel each job on RunPod (best-effort, non-throwing)
  const endpointId =
    process.env.RUNPOD_FLUX2_ENDPOINT_ID ?? process.env.RUNPOD_ENDPOINT_ID;
  const apiKey = process.env.RUNPOD_API_KEY;

  if (endpointId && apiKey && jobIds.length > 0) {
    await Promise.allSettled(
      jobIds.map(async (jobId) => {
        // Strip the "runpod-" prefix to get the RunPod-native job ID
        const runpodJobId = jobId.startsWith("runpod-")
          ? jobId.replace("runpod-", "")
          : jobId;
        try {
          const res = await fetch(
            `https://api.runpod.ai/v2/${endpointId}/cancel/${runpodJobId}`,
            { method: "POST", headers: { Authorization: `Bearer ${apiKey}` } }
          );
          if (!res.ok) {
            console.warn(
              `[cancel-cover] RunPod cancel ${runpodJobId} → ${res.status}`
            );
          }
        } catch (err) {
          console.warn(`[cancel-cover] RunPod cancel failed (non-fatal): ${err}`);
        }
      })
    );
  }

  // Mark all jobs as failed in the DB
  if (jobIds.length > 0) {
    await supabase
      .from("generation_jobs")
      .update({
        status: "failed",
        error: "Cancelled by user",
        completed_at: new Date().toISOString(),
      })
      .eq("series_id", seriesId)
      .eq("job_type", "cover_variant")
      .in("status", ["pending", "processing"]);
  }

  // Reset series cover state so the user can start fresh
  await supabase
    .from("story_series")
    .update({
      cover_status: "pending",
      cover_variants: [null, null, null, null],
      cover_error: null,
    })
    .eq("id", seriesId);

  console.log(
    `[cancel-cover] Cancelled ${jobIds.length} jobs for series ${seriesId}`
  );

  return NextResponse.json({
    cancelled: jobIds.length,
    coverStatus: "pending",
  });
}
