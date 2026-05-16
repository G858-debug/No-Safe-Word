import { NextResponse } from "next/server";
import { getRunPodJobStatus, base64ToBuffer } from "@no-safe-word/image-gen";
import { supabase } from "@no-safe-word/story-engine";
import { logEvent } from "@/lib/server/events";

// ============================================================
// Cover-variant completion handler
// ============================================================
// Parallel path to the scene-image completion flow in ./route.ts for
// generation_jobs rows where job_type='cover_variant'. Differences:
//
//   - Uploads to story-covers/{slug}/variants/variant-{N}.png
//     (scene images upload to story-images/stories/{imageId}.png)
//   - Writes the public URL into story_series.cover_variants[N]
//     (scene images write into images.stored_url + story_image_prompts)
//   - On the last terminal job (all 4 variants settled), transitions
//     story_series.cover_status from 'generating' to either
//     'variants_ready' (≥1 succeeded) or 'failed' (all failed)
//
// Shape invariant from migration 042: every cover_variant job carries
// both series_id and variant_index, so we can assert those present.
// ============================================================

export const COVER_BUCKET = "story-covers";
const BUCKET = COVER_BUCKET;
const VARIANT_COUNT = 4;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MIN_EXPECTED_BYTES = 100 * 1024;

interface CoverJobRow {
  image_id: string | null;
  variant_index: number | null;
  series_id: string | null;
  job_created_at?: string | null;
}

export async function handleCoverVariantCompletion(args: {
  jobId: string;
  jobRow: CoverJobRow;
  settings: Record<string, unknown>;
}): Promise<NextResponse> {
  const { jobId, jobRow, settings } = args;

  if (jobRow.variant_index === null || jobRow.series_id === null || jobRow.image_id === null) {
    console.error(
      `[status:cover] job ${jobId} has job_type='cover_variant' but missing image_id/variant_index/series_id`
    );
    return NextResponse.json(
      { error: "Malformed cover_variant job row" },
      { status: 500 }
    );
  }

  const { variant_index: variantIndex, series_id: seriesId, image_id: imageId } = jobRow;

  const runpodJobId = jobId.startsWith("runpod-") ? jobId.replace("runpod-", "") : jobId;
  const modelSetting = typeof settings.model === "string" ? (settings.model as string) : undefined;
  const endpointOverride =
    modelSetting === "flux2_dev" ? process.env.RUNPOD_FLUX2_ENDPOINT_ID : undefined;

  // Skip if already in a terminal state (avoids redundant writes on repeated polls).
  const { data: currentJob } = await supabase
    .from("generation_jobs")
    .select("status")
    .eq("job_id", jobId)
    .single();
  if (currentJob?.status === "completed" || currentJob?.status === "failed") {
    return NextResponse.json({
      jobId,
      completed: currentJob.status === "completed",
      cached: true,
    });
  }

  const status = await getRunPodJobStatus(runpodJobId, endpointOverride);

  if (status.status === "COMPLETED" && status.output?.images?.[0]) {
    const imageData = status.output.images[0].data;
    const base64Data = imageData.includes(",") ? imageData.split(",")[1] : imageData;

    const buffer = base64ToBuffer(base64Data);
    if (buffer.length < 1024 || !buffer.subarray(0, 8).equals(PNG_MAGIC)) {
      console.error(
        `[status:cover][${jobId}] corrupted PNG for variant ${variantIndex}: ` +
          `buflen=${buffer.length}, head=${buffer.subarray(0, 8).toString("hex")}`
      );
      await markJobFailed(jobId, "RunPod returned corrupted image data (invalid PNG)");
      await maybeTransitionCoverStatus(seriesId);
      return NextResponse.json({
        jobId,
        completed: false,
        error: "RunPod returned corrupted image data (invalid PNG)",
      });
    }

    if (buffer.length < MIN_EXPECTED_BYTES) {
      console.warn(
        `[status:cover][${jobId}] small PNG for variant ${variantIndex}: ` +
          `${(buffer.length / 1024).toFixed(0)}KB. Proceeding.`
      );
    }

    const { data: series } = await supabase
      .from("story_series")
      .select("slug")
      .eq("id", seriesId)
      .single();

    if (!series?.slug) {
      console.error(`[status:cover][${jobId}] series ${seriesId} missing slug`);
      await markJobFailed(jobId, "Series slug missing");
      await maybeTransitionCoverStatus(seriesId);
      return NextResponse.json(
        { jobId, completed: false, error: "Series slug missing" },
        { status: 500 }
      );
    }

    const storagePath = `${series.slug}/variants/variant-${variantIndex}.png`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: "image/png",
        upsert: true,
        cacheControl: "public, max-age=60",
      });

    if (uploadError) {
      console.error(`[status:cover][${jobId}] upload failed: ${uploadError.message}`);
      await markJobFailed(jobId, `Storage upload failed: ${uploadError.message}`);
      await maybeTransitionCoverStatus(seriesId);
      return NextResponse.json({
        jobId,
        completed: false,
        error: `Storage upload failed: ${uploadError.message}`,
      });
    }

    const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    const variantUrl = publicUrlData.publicUrl;
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

    await logEvent({
      eventType: "cover.variant_generated",
      metadata: {
        series_id: seriesId,
        variant_index: variantIndex,
        model: "flux2_dev",
        job_id: jobId,
      },
    });

    await maybeTransitionCoverStatus(seriesId);

    return NextResponse.json({
      jobId,
      completed: true,
      imageUrl: variantUrl,
      variantIndex,
      scheduled: true,
    });
  }

  if (
    status.status === "FAILED" ||
    status.status === "CANCELLED" ||
    status.status === "TIMED_OUT"
  ) {
    const errorMsg =
      status.status === "CANCELLED"
        ? "RunPod job was cancelled"
        : status.status === "TIMED_OUT"
        ? "RunPod job timed out (execution limit exceeded)"
        : status.error || JSON.stringify(status.output || "");
    console.warn(`[status:cover][${jobId}] variant ${variantIndex} ${status.status}: ${errorMsg}`);
    await markJobFailed(jobId, errorMsg);
    await maybeTransitionCoverStatus(seriesId);
    return NextResponse.json({ jobId, completed: false, error: errorMsg });
  }

  // IN_PROGRESS → update DB status so the pill reflects it without re-polling RunPod.
  if (status.status === "IN_PROGRESS") {
    await supabase
      .from("generation_jobs")
      .update({ status: "processing" })
      .eq("job_id", jobId)
      .eq("status", "pending");
  }

  // Still IN_QUEUE or IN_PROGRESS — keep polling.
  return NextResponse.json({
    jobId,
    completed: false,
    status: status.status,
    delayTime: status.delayTime ?? null,
  });
}

export async function markJobFailed(jobId: string, error: string): Promise<void> {
  const { data: jobRow } = await supabase
    .from("generation_jobs")
    .select("series_id, variant_index")
    .eq("job_id", jobId)
    .maybeSingle();

  await supabase
    .from("generation_jobs")
    .update({ status: "failed", completed_at: new Date().toISOString(), error })
    .eq("job_id", jobId);

  if (jobRow?.series_id != null) {
    await logEvent({
      eventType: "cover.variant_failed",
      metadata: {
        series_id: jobRow.series_id,
        variant_index: jobRow.variant_index,
        model: "flux2_dev",
        job_id: jobId,
        error,
      },
    });
  }
}

export async function writeVariantUrl(
  seriesId: string,
  variantIndex: number,
  url: string
): Promise<void> {
  const { data } = await supabase
    .from("story_series")
    .select("cover_variants")
    .eq("id", seriesId)
    .single();

  const current = (data?.cover_variants as (string | null)[] | null) ?? Array(VARIANT_COUNT).fill(null);
  const next: (string | null)[] = [...current];
  while (next.length < VARIANT_COUNT) next.push(null);
  next[variantIndex] = url;

  await supabase
    .from("story_series")
    .update({ cover_variants: next })
    .eq("id", seriesId);
}

export async function maybeTransitionCoverStatus(seriesId: string): Promise<void> {
  const { data: jobs } = await supabase
    .from("generation_jobs")
    .select("status, variant_index, error")
    .eq("series_id", seriesId)
    .eq("job_type", "cover_variant");

  if (!jobs || jobs.length === 0) return;

  const { data: series } = await supabase
    .from("story_series")
    .select("cover_status, cover_variants")
    .eq("id", seriesId)
    .single();

  if (!series || series.cover_status !== "generating") return;

  const variants = (series.cover_variants as (string | null)[] | null) ?? [];
  const normalized: (string | null)[] = Array.from(
    { length: VARIANT_COUNT },
    (_, i) => variants[i] ?? null
  );

  const activeByIndex = new Set<number>();
  for (const j of jobs) {
    if (
      (j.status === "pending" || j.status === "processing") &&
      typeof j.variant_index === "number"
    ) {
      activeByIndex.add(j.variant_index);
    }
  }

  const failedByIndex = new Map<number, string>();
  for (const j of jobs) {
    if (
      j.status === "failed" &&
      typeof j.variant_index === "number" &&
      !activeByIndex.has(j.variant_index)
    ) {
      failedByIndex.set(j.variant_index, (j.error as string | null) ?? "unknown error");
    }
  }

  let succeeded = 0;
  let failed = 0;
  let pending = 0;
  const errorSummaries: string[] = [];
  for (let i = 0; i < VARIANT_COUNT; i++) {
    if (normalized[i]) {
      succeeded++;
    } else if (failedByIndex.has(i)) {
      failed++;
      errorSummaries.push(`variant ${i}: ${failedByIndex.get(i)}`);
    } else {
      pending++;
    }
  }

  if (pending > 0) return;

  if (succeeded === 0) {
    await supabase
      .from("story_series")
      .update({
        cover_status: "failed",
        cover_error: errorSummaries.join("; ") || "All cover variants failed",
      })
      .eq("id", seriesId);
    return;
  }

  await supabase
    .from("story_series")
    .update({
      cover_status: "variants_ready",
      cover_error: errorSummaries.length > 0 ? errorSummaries.join("; ") : null,
    })
    .eq("id", seriesId);
}
