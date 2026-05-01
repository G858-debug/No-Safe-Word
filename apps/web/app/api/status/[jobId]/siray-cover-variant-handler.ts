import { NextResponse } from "next/server";
import { getSirayClient } from "@no-safe-word/image-gen";
import { supabase } from "@no-safe-word/story-engine";
import { uploadRemoteImageToStorage } from "@/lib/server/upload-generated-image";
import {
  COVER_BUCKET,
  markJobFailed,
  maybeTransitionCoverStatus,
  writeVariantUrl,
} from "./cover-variant-handler";

/**
 * Single browser-poll for a Siray-backed cover_variant generation_job.
 *
 * Job-id convention: `siray-{taskId}`. Mirrors `siray-job-handler.ts` for
 * portraits/scenes, but writes the resulting URL into
 * `story_series.cover_variants[N]` (instead of `images.stored_url`) and
 * advances the series-level cover_status state machine when the last
 * variant settles.
 *
 * Idempotent: if the job is already completed/failed, returns the cached
 * outcome without hitting Siray again.
 */
export async function handleSirayCoverVariantStatus(args: {
  jobId: string;
  jobRow: {
    image_id: string | null;
    variant_index: number | null;
    series_id: string | null;
  };
  seriesSlug: string;
}): Promise<NextResponse> {
  const { jobId, jobRow, seriesSlug } = args;

  if (
    jobRow.variant_index === null ||
    jobRow.series_id === null ||
    jobRow.image_id === null
  ) {
    console.error(
      `[status:cover:siray] job ${jobId} missing image_id/variant_index/series_id`
    );
    return NextResponse.json(
      { error: "Malformed cover_variant job row" },
      { status: 500 }
    );
  }

  const { variant_index: variantIndex, series_id: seriesId, image_id: imageId } =
    jobRow;

  const taskId = jobId.startsWith("siray-")
    ? jobId.slice("siray-".length)
    : jobId;

  // Short-circuit on already-terminal jobs (multiple browser polls race).
  const { data: currentJob } = await supabase
    .from("generation_jobs")
    .select("status, error")
    .eq("job_id", jobId)
    .single();

  if (currentJob?.status === "completed") {
    return NextResponse.json({ jobId, completed: true, cached: true });
  }
  if (currentJob?.status === "failed") {
    return NextResponse.json({
      jobId,
      completed: false,
      error: currentJob.error ?? "Siray cover variant failed",
    });
  }

  let status;
  try {
    status = await getSirayClient().getJobStatus(taskId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error polling Siray";
    console.error(`[status:cover:siray][${jobId}] poll failed:`, msg);
    return NextResponse.json({ jobId, completed: false, error: msg });
  }

  if (status.state === "pending") {
    return NextResponse.json({
      jobId,
      completed: false,
      status: status.rawStatus,
      progress: status.progress ?? null,
    });
  }

  if (status.state === "failed") {
    const reason = status.failReason ?? "Siray cover variant failed";
    await markJobFailed(jobId, reason);
    await maybeTransitionCoverStatus(seriesId);
    return NextResponse.json({ jobId, completed: false, error: reason });
  }

  // status.state === "completed" — download from Siray's CDN and re-upload
  // to the story-covers bucket so the URL is permanent.
  const storagePath = `${seriesSlug}/variants/variant-${variantIndex}.jpeg`;

  let variantUrl: string;
  try {
    variantUrl = await uploadRemoteImageToStorage(
      status.imageUrl!,
      storagePath,
      COVER_BUCKET,
      { cacheControl: "public, max-age=60" }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Storage upload failed";
    console.error(`[status:cover:siray][${jobId}] upload failed:`, msg);
    await markJobFailed(jobId, msg);
    await maybeTransitionCoverStatus(seriesId);
    return NextResponse.json({ jobId, completed: false, error: msg });
  }

  // Persist the URL on the images row (provenance) and on the series-level
  // cover_variants slot (what the UI reads).
  //
  // Cover variant storage paths are stable (`variant-{N}.jpeg`), so each
  // regeneration overwrites the previous file at the same URL. To bust
  // any browser/CDN cache that might still hold the old bytes, we append
  // `?v={completionTimestamp}` to the URL written into cover_variants.
  // Each completion writes a unique URL string into the DB, so the UI's
  // <img> tag sees a brand-new URL it has never fetched.
  const cacheBustedUrl = `${variantUrl}?v=${Date.now()}`;

  await supabase
    .from("images")
    .update({ stored_url: cacheBustedUrl, sfw_url: cacheBustedUrl })
    .eq("id", imageId);

  await writeVariantUrl(seriesId, variantIndex, cacheBustedUrl);

  await supabase
    .from("generation_jobs")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("job_id", jobId);

  await maybeTransitionCoverStatus(seriesId);

  return NextResponse.json({
    jobId,
    completed: true,
    imageUrl: variantUrl,
    variantIndex,
  });
}
