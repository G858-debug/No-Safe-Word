import { NextRequest, NextResponse } from "next/server";
import { getRunPodJobStatus, base64ToBuffer } from "@no-safe-word/image-gen";
import { validatePersonCount, canRetryValidation, buildRetrySettings, generateRetrySeed } from "@no-safe-word/image-gen";
import { supabase } from "@no-safe-word/story-engine";

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

    // Strip the runpod- prefix if present
    const runpodJobId = jobId.startsWith("runpod-") ? jobId.replace("runpod-", "") : jobId;
    console.log(`[StoryPublisher] Polling RunPod job: ${runpodJobId}`);

    const status = await getRunPodJobStatus(runpodJobId);

    if (status.status === "COMPLETED" && status.output?.images?.[0]) {
      const imageData = status.output.images[0].data;
      const base64Data = imageData.includes(",") ? imageData.split(",")[1] : imageData;

      // Find the image_id from generation_jobs
      const { data: jobRow } = await supabase
        .from("generation_jobs")
        .select("image_id")
        .eq("job_id", jobId)
        .single();

      if (!jobRow?.image_id) {
        return NextResponse.json({
          jobId,
          completed: true,
          imageUrl: null,
          seed: null,
          cost: 0,
          scheduled: true,
        });
      }

      // Fetch image settings and prompt metadata in parallel
      const [imageResult, promptResult] = await Promise.all([
        supabase
          .from("images")
          .select("settings")
          .eq("id", jobRow.image_id)
          .single(),
        supabase
          .from("story_image_prompts")
          .select("id, secondary_character_id")
          .eq("image_id", jobRow.image_id)
          .single(),
      ]);

      const settings = (imageResult.data?.settings as Record<string, unknown>) ?? {};
      const seed = settings.seed != null ? Number(settings.seed) : null;
      const isDualCharacter = !!promptResult.data?.secondary_character_id;
      const promptId = promptResult.data?.id;

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
          // Validation failed and retries remain — trigger retry
          const newSeed = generateRetrySeed();
          const updatedSettings = buildRetrySettings(settings, newSeed, detected);

          console.log(`[PersonValidator] FAILED: detected ${detected} person(s), expected 2. Retrying with seed ${newSeed} (attempt ${attemptNumber}/3)`);

          // Update image settings with new seed and validation tracking
          await supabase
            .from("images")
            .update({ settings: updatedSettings })
            .eq("id", jobRow.image_id);

          // Trigger retry via internal endpoint
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
                // Fall through to store the image anyway
              }
            } catch (retryErr) {
              console.error("[PersonValidator] Retry request failed:", retryErr);
              // Fall through to store the image anyway
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
      const storagePath = `stories/${jobRow.image_id}-${timestamp}.png`;
      let finalImageUrl: string | null = null;

      const { error: uploadError } = await supabase.storage
        .from("story-images")
        .upload(storagePath, buffer, { contentType: "image/png", upsert: true });

      if (!uploadError) {
        const { data: { publicUrl } } = supabase.storage
          .from("story-images")
          .getPublicUrl(storagePath);

        finalImageUrl = publicUrl;

        // Update image record
        await supabase
          .from("images")
          .update({ stored_url: publicUrl, sfw_url: publicUrl })
          .eq("id", jobRow.image_id);
      }

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
        imageUrl: finalImageUrl,
        seed,
        cost: 0,
        scheduled: true,
        ...(validation ? { validation } : {}),
      });

    } else if (status.status === "FAILED") {
      // Update job as failed
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
