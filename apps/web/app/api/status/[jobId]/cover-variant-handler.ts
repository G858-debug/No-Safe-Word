import { NextResponse } from "next/server";
import { getRunPodJobStatus, base64ToBuffer, generateFlux2ProImage } from "@no-safe-word/image-gen";
import type { Flux2ProGenerateResult } from "@no-safe-word/image-gen";
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
//   - No scene evaluation, no retry-with-reduced-LoRA, no LoRA discovery
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
const RUNPOD_QUEUE_FALLBACK_MS = 60_000;

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
    // Should be unreachable — migration 042's generation_jobs_cover_shape_check
    // constraint + generate-cover always setting image_id guarantee this —
    // but fail loudly if a malformed row somehow lands here.
    console.error(
      `[status:cover] job ${jobId} has job_type='cover_variant' but missing image_id/variant_index/series_id`
    );
    return NextResponse.json(
      { error: "Malformed cover_variant job row" },
      { status: 500 }
    );
  }

  const { variant_index: variantIndex, series_id: seriesId, image_id: imageId } = jobRow;

  // Resolve RunPod endpoint based on the image's stored model setting
  // (always flux2_dev for covers, but read from settings for correctness).
  const runpodJobId = jobId.startsWith("runpod-") ? jobId.replace("runpod-", "") : jobId;
  const modelSetting = typeof settings.model === "string" ? (settings.model as string) : undefined;
  const endpointOverride =
    modelSetting === "flux2_dev" ? process.env.RUNPOD_FLUX2_ENDPOINT_ID : undefined;

  // Guard: skip RunPod if this job already reached a terminal state (e.g. via
  // a prior Replicate fallback). Prevents a late-arriving RunPod COMPLETED from
  // overwriting a successfully written fallback result.
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

    // Look up the story slug for the storage path
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
        // Variant filenames are NOT content-hashed — `variant-0.png`
        // is overwritten on each regeneration. Keep cache short so
        // admins see the fresh image in the approval UI after a
        // retry. Composite uploads use the immutable long-cache path.
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

    // Cover variant storage paths are stable (`variant-{N}.png`), so each
    // regeneration overwrites the previous file at the same URL. Append
    // `?v={completionTimestamp}` so each completion writes a unique URL
    // into cover_variants — the UI's <img> tag sees a brand-new URL it
    // has never fetched, dodging any browser/CDN cache holding old bytes.
    const cacheBustedUrl = `${variantUrl}?v=${Date.now()}`;

    // Mirror the URL onto the images row (provenance) AND onto
    // story_series.cover_variants (what the UI reads).
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
    // markJobFailed centrally logs cover.variant_failed.
    await markJobFailed(jobId, errorMsg);
    await maybeTransitionCoverStatus(seriesId);
    return NextResponse.json({ jobId, completed: false, error: errorMsg });
  }

  // Write live RunPod status to DB so the status pill reads it without
  // re-calling RunPod on every page load:
  //   IN_QUEUE  → pending   (initial state, unchanged — job is queued)
  //   IN_PROGRESS → processing  (already a valid status value)
  if (status.status === "IN_PROGRESS") {
    await supabase
      .from("generation_jobs")
      .update({ status: "processing" })
      .eq("job_id", jobId)
      .eq("status", "pending"); // only update once, avoid redundant writes
  }

  // IN_QUEUE for longer than the threshold → trigger Replicate fallback.
  // Use DB created_at as the elapsed clock — RunPod does not return delayTime
  // on IN_QUEUE responses for serverless endpoints.
  if (status.status === "IN_QUEUE") {
    const ageMs = jobRow.job_created_at
      ? Date.now() - new Date(jobRow.job_created_at).getTime()
      : 0;
    if (ageMs > RUNPOD_QUEUE_FALLBACK_MS) {
      console.warn(
        `[status:cover][${jobId}] IN_QUEUE ${Math.round(ageMs / 1000)}s > ${RUNPOD_QUEUE_FALLBACK_MS / 1000}s — triggering Flux 2 Pro fallback`
      );
      return handleReplicateFallback({
        jobId,
        runpodJobId,
        endpointOverride,
        imageId,
        variantIndex,
        seriesId,
      });
    }
  }

  // Still running / in queue under threshold
  return NextResponse.json({
    jobId,
    completed: false,
    status: status.status,
    delayTime: status.delayTime ?? null,
  });
}

export async function markJobFailed(jobId: string, error: string): Promise<void> {
  // Look up series_id + variant_index from the job row before marking
  // it failed so we can attach them to the cover.variant_failed event.
  // (The lookup is cheap and lets every failure path through this
  // helper get instrumented automatically — central choke point.)
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

async function cancelRunPodJob(runpodJobId: string, endpointOverride?: string): Promise<void> {
  const endpointId =
    endpointOverride ??
    process.env.RUNPOD_FLUX2_ENDPOINT_ID ??
    process.env.RUNPOD_ENDPOINT_ID;
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!endpointId || !apiKey) return;
  try {
    const res = await fetch(
      `https://api.runpod.ai/v2/${endpointId}/cancel/${runpodJobId}`,
      { method: "POST", headers: { Authorization: `Bearer ${apiKey}` } }
    );
    if (!res.ok) {
      console.warn(`[status:cover] cancel ${runpodJobId} → ${res.status}`);
    } else {
      console.log(`[status:cover] RunPod job ${runpodJobId} cancelled`);
    }
  } catch (err) {
    console.warn(`[status:cover] cancel failed (non-fatal): ${err}`);
  }
}

async function handleReplicateFallback(args: {
  jobId: string;
  runpodJobId: string;
  endpointOverride: string | undefined;
  imageId: string;
  variantIndex: number;
  seriesId: string;
}): Promise<NextResponse> {
  const { jobId, runpodJobId, endpointOverride, imageId, variantIndex, seriesId } = args;

  const { data: imageRow } = await supabase
    .from("images")
    .select("prompt")
    .eq("id", imageId)
    .single();
  if (!imageRow?.prompt) {
    await markJobFailed(jobId, "Fallback: assembled prompt missing from images table");
    await maybeTransitionCoverStatus(seriesId);
    return NextResponse.json({ jobId, completed: false, error: "Fallback: prompt not found" });
  }

  const { data: series } = await supabase
    .from("story_series")
    .select("slug")
    .eq("id", seriesId)
    .single();
  if (!series?.slug) {
    await markJobFailed(jobId, "Fallback: series slug missing");
    await maybeTransitionCoverStatus(seriesId);
    return NextResponse.json(
      { jobId, completed: false, error: "Fallback: slug missing" },
      { status: 500 }
    );
  }

  let replicateResult: Flux2ProGenerateResult;
  try {
    replicateResult = await generateFlux2ProImage({
      prompt: imageRow.prompt,
      aspectRatio: "2:3",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[status:cover][${jobId}] Flux 2 Pro failed: ${msg}`);
    void cancelRunPodJob(runpodJobId, endpointOverride);
    await markJobFailed(jobId, `Replicate fallback failed: ${msg}`);
    await maybeTransitionCoverStatus(seriesId);
    return NextResponse.json({ jobId, completed: false, error: msg });
  }

  // Cancel the RunPod job once Replicate has the image (best-effort, non-blocking)
  void cancelRunPodJob(runpodJobId, endpointOverride);

  // Fetch JPEG from Replicate CDN and upload directly to Supabase Storage
  const storagePath = `${series.slug}/variants/variant-${variantIndex}.jpeg`;
  let variantUrl: string;
  try {
    const imgRes = await fetch(replicateResult.imageUrl);
    if (!imgRes.ok) throw new Error(`Replicate CDN fetch failed: ${imgRes.status}`);
    const buffer = Buffer.from(await imgRes.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: "image/jpeg",
        upsert: true,
        cacheControl: "public, max-age=60",
      });
    if (uploadError) throw new Error(uploadError.message);

    const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    variantUrl = publicUrlData.publicUrl;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markJobFailed(jobId, `Fallback upload failed: ${msg}`);
    await maybeTransitionCoverStatus(seriesId);
    return NextResponse.json({ jobId, completed: false, error: msg });
  }

  // Same cache-bust as the primary path: append a unique ?v= so the URL
  // stored in cover_variants differs each completion, defeating any
  // browser/CDN cache holding old bytes from a prior regeneration.
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

  console.log(
    `[status:cover][${jobId}] Replicate fallback done: variant ${variantIndex} → ${cacheBustedUrl}`
  );
  return NextResponse.json({
    jobId,
    completed: true,
    imageUrl: cacheBustedUrl,
    variantIndex,
    scheduled: true,
    fallback: "replicate_flux2_pro",
  });
}

export async function writeVariantUrl(
  seriesId: string,
  variantIndex: number,
  url: string
): Promise<void> {
  // Read-modify-write. cover_variants is a fixed-length 4-slot array;
  // there's no ambiguity about other writers because each slot is owned
  // by exactly one variant_index.
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

/**
 * After any cover_variant job reaches a terminal state, check whether
 * all 4 variants have settled. If yes:
 *   - ≥1 succeeded → cover_status = 'variants_ready' (failed slots stay null)
 *   - all failed    → cover_status = 'failed' + cover_error populated
 * If no — some variants still generating — leave cover_status='generating'.
 */
export async function maybeTransitionCoverStatus(seriesId: string): Promise<void> {
  const { data: jobs } = await supabase
    .from("generation_jobs")
    .select("status, variant_index, error")
    .eq("series_id", seriesId)
    .eq("job_type", "cover_variant");

  if (!jobs || jobs.length === 0) return;

  // Group by variant_index — when the user does partial retries, old jobs
  // for the same variant remain in the table but superseded. The newest
  // job for each variant (highest row per variant_index) is authoritative.
  // We don't have created_at on this select, so rely on the invariant that
  // the generate-cover route nulls the cover_variants slot before
  // submitting a new job for that index — so a non-null slot means the
  // latest job for that variant has already completed.
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

  // Determine per-slot terminal state:
  //   populated URL                          → succeeded
  //   null + active (pending/processing) job → still generating
  //   null + no active job + failed job      → failed
  //
  // A slot with BOTH a failed old job AND a pending new job (i.e. the user
  // retried that slot) must NOT be counted as failed — the pending job is the
  // active one and supersedes the old failure. We track active indices first
  // and exclude them from failedByIndex so stale failures don't pollute the
  // transition logic.
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

  // Partial or full success
  await supabase
    .from("story_series")
    .update({
      cover_status: "variants_ready",
      cover_error: errorSummaries.length > 0 ? errorSummaries.join("; ") : null,
    })
    .eq("id", seriesId);
}
