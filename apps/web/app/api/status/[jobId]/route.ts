import { NextRequest, NextResponse } from "next/server";
import { getRunPodJobStatus, base64ToBuffer, buildKontextWorkflow, submitRunPodJob } from "@no-safe-word/image-gen";
import { validatePersonCount, canRetryValidation, buildRetrySettings, generateRetrySeed } from "@no-safe-word/image-gen";
import { checkFaceSwapStatus } from "@no-safe-word/image-gen";
import { supabase } from "@no-safe-word/story-engine";
import type { Json } from "@no-safe-word/shared";

export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ jobId: string }> }
) {
  try {
    const params = await props.params;
    const { jobId } = params;

    if (!jobId) {
      return NextResponse.json(
        { error: "Missing jobId parameter" },
        { status: 400 }
      );
    }

    // ── V4 Face Swap: poll Replicate prediction instead of RunPod ──
    if (jobId.startsWith("replicate-faceswap-")) {
      return handleFaceSwapStatus(jobId);
    }

    // Find the image_id from generation_jobs first — needed for two-step pipeline check
    const { data: jobRow } = await supabase
      .from("generation_jobs")
      .select("image_id")
      .eq("job_id", jobId)
      .single();

    // Fetch image settings to check for two-step pipeline
    const settings: Record<string, unknown> = {};
    let imageId: string | null = jobRow?.image_id ?? null;

    if (imageId) {
      const { data: imageResult } = await supabase
        .from("images")
        .select("settings")
        .eq("id", imageId)
        .single();
      if (imageResult?.settings) {
        Object.assign(settings, imageResult.settings as Record<string, unknown>);
      }
    }

    // Determine which RunPod job to poll
    const isTwoStep = settings.pipelineType === 'sdxl-flux-img2img';
    const currentStep = isTwoStep ? Number(settings.currentStep || 1) : 0;
    const activeRunpodJobId = (isTwoStep && currentStep === 2 && settings.activeRunpodJobId)
      ? String(settings.activeRunpodJobId)
      : (jobId.startsWith("runpod-") ? jobId.replace("runpod-", "") : jobId);

    const status = await getRunPodJobStatus(activeRunpodJobId);

    // Only log on status transitions
    if (status.status === "COMPLETED") {
      console.log(`[StoryPublisher] RunPod job COMPLETED: ${activeRunpodJobId}${isTwoStep ? ` (step ${currentStep})` : ''}`);
    } else if (status.status === "FAILED") {
      console.log(`[StoryPublisher] RunPod job FAILED: ${activeRunpodJobId}${isTwoStep ? ` (step ${currentStep})` : ''}`);
    }

    if (status.status === "COMPLETED" && status.output?.images?.[0]) {
      const imageData = status.output.images[0].data;
      const base64Data = imageData.includes(",") ? imageData.split(",")[1] : imageData;

      if (!imageId) {
        return NextResponse.json({
          jobId,
          completed: true,
          imageUrl: null,
          seed: null,
          cost: 0,
          scheduled: true,
        });
      }

      // --- Two-step pipeline: Step 1 complete → submit Step 2 ---
      if (isTwoStep && currentStep === 1) {
        return await handleTwoStepTransition(jobId, imageId, base64Data, settings);
      }

      // Fetch prompt metadata for dual-character validation
      const { data: promptResult } = await supabase
        .from("story_image_prompts")
        .select("id, secondary_character_id")
        .eq("image_id", imageId)
        .single();

      const seed = settings.seed != null ? Number(settings.seed) : null;
      const isDualCharacter = !!promptResult?.secondary_character_id;
      const promptId = promptResult?.id;

      // --- Dual-character person count validation ---
      let validation: { personCountDetected: number; validationPassed: boolean; attempts: number; seedsUsed: number[] } | undefined;

      if (isDualCharacter) {
        const existingValidation = settings.validation as Record<string, unknown> | undefined;
        const previousSeeds = (existingValidation?.seedsUsed as number[]) ?? [];
        const attemptNumber = previousSeeds.length + 1;
        const allSeeds = seed != null ? [...previousSeeds, seed] : previousSeeds;

        console.log(`[PersonValidator] Dual-character scene detected, validating (attempt ${attemptNumber}/3)...`);

        const { detected, passed } = await validatePersonCount(base64Data, 2);

        validation = {
          personCountDetected: detected,
          validationPassed: passed,
          attempts: attemptNumber,
          seedsUsed: allSeeds,
        };

        if (!passed && canRetryValidation(settings)) {
          const newSeed = generateRetrySeed();
          const updatedSettings = buildRetrySettings(settings, newSeed, detected);

          console.log(`[PersonValidator] FAILED: detected ${detected} person(s), expected 2. Retrying with seed ${newSeed} (attempt ${attemptNumber}/3)`);

          await supabase
            .from("images")
            .update({ settings: updatedSettings as Json })
            .eq("id", imageId);

          if (promptId) {
            try {
              const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
              const retryRes = await fetch(`${siteUrl}/api/stories/images/${promptId}/retry`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ newSeed, jobId }),
              });

              if (retryRes.ok) {
                const retryData = await retryRes.json();
                console.log(`[PersonValidator] Retry submitted: new job ${retryData.jobId}`);

                return NextResponse.json({
                  jobId: retryData.jobId,
                  completed: false,
                  status: "RETRYING",
                  validation,
                  retryReason: `Detected ${detected} person(s), expected 2`,
                });
              } else {
                console.error(`[PersonValidator] Retry endpoint failed: ${retryRes.status}`);
              }
            } catch (retryErr) {
              console.error("[PersonValidator] Retry request failed:", retryErr);
            }
          }
        } else if (!passed) {
          console.warn(`[PersonValidator] FAILED after max retries: detected ${detected} person(s), expected 2. Storing best result.`);
        } else {
          console.log(`[PersonValidator] PASSED: detected ${detected} person(s)`);
        }
      }

      // --- Store the image ---
      const buffer = base64ToBuffer(base64Data);
      const timestamp = Date.now();
      const storagePath = `stories/${imageId}-${timestamp}.png`;

      const { error: uploadError } = await supabase.storage
        .from("story-images")
        .upload(storagePath, buffer, { contentType: "image/png", upsert: true });

      if (uploadError) {
        console.error(
          `[Status][${jobId}] Supabase storage upload FAILED for image ${imageId}: ${uploadError.message}`,
        );
        return NextResponse.json({
          jobId,
          completed: false,
          error: `Image storage failed: ${uploadError.message}`,
        });
      }

      const { data: { publicUrl } } = supabase.storage
        .from("story-images")
        .getPublicUrl(storagePath);

      // Update image record
      await supabase
        .from("images")
        .update({ stored_url: publicUrl, sfw_url: publicUrl })
        .eq("id", imageId);

      // Update job status
      await supabase
        .from("generation_jobs")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("job_id", jobId);

      // Update story_image_prompts status
      if (promptId) {
        await supabase
          .from("story_image_prompts")
          .update({ status: "generated" })
          .eq("id", promptId);
      }

      return NextResponse.json({
        jobId,
        completed: true,
        imageUrl: publicUrl,
        seed,
        cost: 0,
        scheduled: true,
        ...(validation ? { validation } : {}),
      });

    } else if (status.status === "FAILED") {
      await supabase
        .from("generation_jobs")
        .update({ status: "failed" })
        .eq("job_id", jobId);

      return NextResponse.json({
        jobId,
        completed: false,
        error: status.error || "RunPod job failed",
      });

    } else {
      // Still in queue or processing
      return NextResponse.json({
        jobId,
        completed: false,
        status: status.status,
        delayTime: status.delayTime ?? null,
        ...(isTwoStep ? { pipelineStep: currentStep } : {}),
      });
    }
  } catch (err) {
    console.error("Status check failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Handle V4 face swap prediction status check.
 * Polls Replicate for the async face swap prediction, stores the result when done.
 */
async function handleFaceSwapStatus(jobId: string): Promise<NextResponse> {
  const predictionId = jobId.replace("replicate-faceswap-", "");

  // Find the image record linked to this job
  const { data: jobRow } = await supabase
    .from("generation_jobs")
    .select("image_id, status")
    .eq("job_id", jobId)
    .single();

  if (!jobRow || !jobRow.image_id) {
    return NextResponse.json({ jobId, completed: false, error: "Job not found" });
  }

  const imageId = jobRow.image_id;

  // Already completed (cached from previous poll)
  if (jobRow.status === "completed") {
    const { data: img } = await supabase
      .from("images")
      .select("stored_url")
      .eq("id", imageId)
      .single();

    return NextResponse.json({
      jobId,
      completed: true,
      imageUrl: img?.stored_url || null,
      seed: null,
      cost: 0,
    });
  }

  // Poll Replicate
  const swapStatus = await checkFaceSwapStatus(predictionId);

  if (swapStatus.status === "succeeded" && swapStatus.imageBuffer) {
    // Store the face-swapped image
    const timestamp = Date.now();
    const storagePath = `stories/${imageId}-${timestamp}_faceswap.png`;

    const { error: uploadError } = await supabase.storage
      .from("story-images")
      .upload(storagePath, swapStatus.imageBuffer, {
        contentType: "image/png",
        upsert: true,
      });

    if (uploadError) {
      console.error(`[FaceSwap Status] Upload failed: ${uploadError.message}`);
      return NextResponse.json({ jobId, completed: false, error: `Upload failed: ${uploadError.message}` });
    }

    const { data: { publicUrl } } = supabase.storage
      .from("story-images")
      .getPublicUrl(storagePath);

    // Update image record with face-swapped version
    await supabase
      .from("images")
      .update({ stored_url: publicUrl, sfw_url: publicUrl })
      .eq("id", imageId);

    // Mark job as completed
    await supabase
      .from("generation_jobs")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("job_id", jobId);

    console.log(`[FaceSwap Status] Complete: ${imageId} → ${publicUrl}`);

    return NextResponse.json({
      jobId,
      completed: true,
      imageUrl: publicUrl,
      seed: null,
      cost: 0,
    });
  }

  if (swapStatus.status === "failed" || swapStatus.status === "canceled") {
    console.error(`[FaceSwap Status] ${swapStatus.status}: ${swapStatus.error}`);

    // Mark job as completed (fall back to scene image without face swap)
    await supabase
      .from("generation_jobs")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("job_id", jobId);

    // Return the scene image URL as fallback
    const { data: img } = await supabase
      .from("images")
      .select("stored_url")
      .eq("id", imageId)
      .single();

    return NextResponse.json({
      jobId,
      completed: true,
      imageUrl: img?.stored_url || null,
      seed: null,
      cost: 0,
      warning: `Face swap ${swapStatus.status}: ${swapStatus.error}`,
    });
  }

  // Still processing
  return NextResponse.json({
    jobId,
    completed: false,
    status: swapStatus.status.toUpperCase(),
  });
}

/**
 * Handle the transition from Step 1 (SDXL) to Step 2 (Flux img2img)
 * in the two-step female body generation pipeline.
 */
async function handleTwoStepTransition(
  jobId: string,
  imageId: string,
  sdxlBase64: string,
  settings: Record<string, unknown>,
): Promise<NextResponse> {
  const step2Config = settings.step2Config as Record<string, unknown>;
  if (!step2Config) {
    throw new Error(`Two-step pipeline missing step2Config for image ${imageId}`);
  }

  console.log(`[TwoStep] Step 1 complete for ${imageId}. Submitting Flux img2img (Step 2)...`);

  // Build the Flux img2img workflow from the stored config
  const fluxWorkflow = buildKontextWorkflow({
    type: 'img2img',
    kontextModel: step2Config.kontextModel as string,
    positivePrompt: step2Config.img2imgPrompt as string,
    width: step2Config.width as number,
    height: step2Config.height as number,
    seed: step2Config.seed as number,
    denoiseStrength: step2Config.denoise as number,
    filenamePrefix: step2Config.filenamePrefix as string,
    loras: step2Config.loras as Array<{ filename: string; strengthModel: number; strengthClip: number }>,
  });

  // Submit Step 2 to RunPod with the SDXL output as input
  const { jobId: fluxJobId } = await submitRunPodJob(fluxWorkflow, [
    { name: 'input.jpg', image: sdxlBase64 },
  ]);

  console.log(`[TwoStep] Flux img2img submitted: ${fluxJobId}`);

  // Update image settings to track Step 2
  const updatedSettings = {
    ...settings,
    currentStep: 2,
    activeRunpodJobId: fluxJobId,
  };

  await supabase
    .from("images")
    .update({ settings: updatedSettings as Json })
    .eq("id", imageId);

  // Return not-completed so frontend keeps polling
  return NextResponse.json({
    jobId,
    completed: false,
    status: "STEP2_SUBMITTED",
    pipelineStep: 2,
  });
}
