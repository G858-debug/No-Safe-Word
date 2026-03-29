import { NextRequest, NextResponse } from "next/server";
import { getRunPodJobStatus, base64ToBuffer } from "@no-safe-word/image-gen";
import { validatePersonCount, canRetryValidation, buildRetrySettings, generateRetrySeed } from "@no-safe-word/image-gen";
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

    // Find the image_id from generation_jobs
    const { data: jobRow } = await supabase
      .from("generation_jobs")
      .select("image_id")
      .eq("job_id", jobId)
      .single();

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

    const runpodJobId = jobId.startsWith("runpod-") ? jobId.replace("runpod-", "") : jobId;
    const status = await getRunPodJobStatus(runpodJobId);

    // Only log on status transitions
    if (status.status === "COMPLETED") {
      console.log(`[StoryPublisher] RunPod job COMPLETED: ${runpodJobId}`);
    } else if (status.status === "FAILED") {
      console.log(`[StoryPublisher] RunPod job FAILED: ${runpodJobId}`);
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
