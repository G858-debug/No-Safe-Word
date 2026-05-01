import { NextResponse } from "next/server";
import { getSirayClient } from "@no-safe-word/image-gen";
import { supabase } from "@no-safe-word/story-engine";
import { uploadRemoteImageToStorage } from "@/lib/server/upload-generated-image";

/**
 * Handle a single browser-poll for a Siray-backed async job.
 *
 * Job-id convention: `siray-{taskId}`. The taskId is the UUID Siray returns
 * from POST /v1/images/generations/async. We persist it on
 * `generation_jobs.job_id` (with the `siray-` prefix) at submit time and
 * link it to the corresponding `images` row via `image_id`.
 *
 * On completion we fetch the image from Siray's CDN, upload it to Supabase
 * Storage, fill in `images.stored_url`, and mark the generation_jobs row +
 * any linked story_image_prompts row as completed/generated.
 *
 * Idempotent: if the job is already marked completed, returns the cached
 * stored_url without re-fetching.
 */
export async function handleSirayJobStatus(args: {
  jobId: string;
  imageId: string | null;
  imageType: "portrait" | "scene";
}): Promise<NextResponse> {
  const { jobId, imageId, imageType } = args;

  const taskId = jobId.startsWith("siray-") ? jobId.slice("siray-".length) : jobId;

  // Short-circuit: if the job already completed, just return the cached URL.
  // (Multiple browser polls can race; this prevents redundant Siray calls
  //  and re-uploads after the first successful completion.)
  const { data: jobRow } = await supabase
    .from("generation_jobs")
    .select("status, error")
    .eq("job_id", jobId)
    .single();

  if (jobRow?.status === "completed" && imageId) {
    const { data: img } = await supabase
      .from("images")
      .select("stored_url")
      .eq("id", imageId)
      .single();
    if (img?.stored_url) {
      return NextResponse.json({
        jobId,
        completed: true,
        imageUrl: img.stored_url,
      });
    }
  }

  if (jobRow?.status === "failed") {
    return NextResponse.json({
      jobId,
      completed: false,
      error: jobRow.error ?? "Siray job failed",
    });
  }

  // Live poll Siray for the current state.
  let status;
  try {
    status = await getSirayClient().getJobStatus(taskId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error polling Siray";
    console.error(`[siray-handler] poll failed for ${jobId}:`, msg);
    return NextResponse.json({ jobId, completed: false, error: msg });
  }

  // Still in progress — surface progress to the client.
  if (status.state === "pending") {
    return NextResponse.json({
      jobId,
      completed: false,
      status: status.rawStatus,
      progress: status.progress ?? null,
    });
  }

  if (status.state === "failed") {
    await supabase
      .from("generation_jobs")
      .update({ status: "failed", error: status.failReason ?? "Siray failed" })
      .eq("job_id", jobId);

    if (imageId) {
      const { data: prompt } = await supabase
        .from("story_image_prompts")
        .select("id")
        .eq("image_id", imageId)
        .maybeSingle();
      if (prompt) {
        await supabase
          .from("story_image_prompts")
          .update({ status: "failed" })
          .eq("id", prompt.id);
      }
    }

    return NextResponse.json({
      jobId,
      completed: false,
      error: status.failReason ?? "Siray job failed",
    });
  }

  // status.state === "completed"
  if (!imageId) {
    // Job has no images row to attach to — return URL but don't persist.
    return NextResponse.json({
      jobId,
      completed: true,
      imageUrl: status.imageUrl,
      scheduled: false,
    });
  }

  // Download the Siray-hosted output and re-upload to Supabase Storage so
  // the URL is permanent. Storage path mirrors the sync routes' convention:
  //   portraits → characters/{imageId}.jpeg
  //   scenes    → stories/{imageId}.jpeg
  const storagePath =
    imageType === "portrait"
      ? `characters/${imageId}.jpeg`
      : `stories/${imageId}.jpeg`;

  let storedUrl: string;
  try {
    storedUrl = await uploadRemoteImageToStorage(status.imageUrl!, storagePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Storage upload failed";
    console.error(`[siray-handler] upload failed for ${jobId}:`, msg);
    await supabase
      .from("generation_jobs")
      .update({ status: "failed", error: msg })
      .eq("job_id", jobId);
    return NextResponse.json({ jobId, completed: false, error: msg });
  }

  await supabase
    .from("images")
    .update({ stored_url: storedUrl })
    .eq("id", imageId);

  await supabase
    .from("generation_jobs")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("job_id", jobId);

  // Mark the linked story_image_prompts row as generated, if there is one
  // (scene generation only — portraits don't have prompt rows).
  const { data: linkedPrompt } = await supabase
    .from("story_image_prompts")
    .select("id")
    .eq("image_id", imageId)
    .maybeSingle();
  if (linkedPrompt) {
    await supabase
      .from("story_image_prompts")
      .update({ status: "generated" })
      .eq("id", linkedPrompt.id);
  }

  return NextResponse.json({
    jobId,
    completed: true,
    imageUrl: storedUrl,
  });
}
