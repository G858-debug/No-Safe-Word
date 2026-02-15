import { NextRequest, NextResponse } from "next/server";
import { getJobStatus, CivitaiError, getRunPodJobStatus, base64ToBuffer } from "@no-safe-word/image-gen";
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

    // Detect RunPod vs Civitai job
    const isRunPod = jobId.startsWith("runpod-");

    if (isRunPod) {
      // === RUNPOD STATUS CHECK ===
      const runpodJobId = jobId.replace("runpod-", "");
      console.log(`[StoryPublisher] Polling RunPod job: ${runpodJobId}`);

      const status = await getRunPodJobStatus(runpodJobId);

      if (status.status === "COMPLETED" && status.output?.images?.[0]) {
        const imageData = status.output.images[0].data;
        const base64Data = imageData.includes(",") ? imageData.split(",")[1] : imageData;

        // Store the image to Supabase Storage
        const buffer = base64ToBuffer(base64Data);

        // Find the image_id from generation_jobs
        const { data: jobRow } = await supabase
          .from("generation_jobs")
          .select("image_id")
          .eq("job_id", jobId)
          .single();

        let finalImageUrl: string | null = null;
        let seed: number | null = null;

        if (jobRow?.image_id) {
          const timestamp = Date.now();
          const storagePath = `stories/${jobRow.image_id}-${timestamp}.png`;

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

            // Get seed from image settings
            const { data: imageRow } = await supabase
              .from("images")
              .select("settings")
              .eq("id", jobRow.image_id)
              .single();

            const settings = imageRow?.settings as Record<string, unknown> | null;
            if (settings?.seed != null) seed = Number(settings.seed);
          }

          // Update job status
          await supabase
            .from("generation_jobs")
            .update({ status: "completed", completed_at: new Date().toISOString() })
            .eq("job_id", jobId);

          // Update story_image_prompts status
          const { data: promptRow } = await supabase
            .from("story_image_prompts")
            .select("id")
            .eq("image_id", jobRow.image_id)
            .single();

          if (promptRow) {
            await supabase
              .from("story_image_prompts")
              .update({ status: "generated" })
              .eq("id", promptRow.id);
          }
        }

        return NextResponse.json({
          jobId,
          completed: true,
          imageUrl: finalImageUrl,
          seed,
          cost: 0,
          scheduled: true,
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
        });
      }

    } else {
      // === CIVITAI STATUS CHECK ===
      console.log(`[StoryPublisher] Polling job status: ${jobId}`);
      const job = await getJobStatus(jobId);

      const completed = job.result?.[0]?.available ?? false;
      const imageUrl = job.result?.[0]?.blobUrl ?? null;
      console.log(`[StoryPublisher] Job ${jobId} status: completed=${completed}, hasImageUrl=${!!imageUrl}`);

      // Update Supabase job status (best-effort)
      let finalImageUrl = imageUrl;
      let seed: number | null = null;
      if (completed) {
        try {
          await supabase
            .from("generation_jobs")
            .update({
              status: "completed",
              completed_at: new Date().toISOString(),
            })
            .eq("job_id", jobId);

          // Store the image URL on the parent image row
          if (imageUrl) {
            const { data: jobRow } = await supabase
              .from("generation_jobs")
              .select("image_id")
              .eq("job_id", jobId)
              .single();

            if (jobRow?.image_id) {
              await supabase
                .from("images")
                .update({ sfw_url: imageUrl })
                .eq("id", jobRow.image_id);

              // Fetch stored_url and seed from the image record
              const { data: imageRow } = await supabase
                .from("images")
                .select("stored_url, settings")
                .eq("id", jobRow.image_id)
                .single();

              // Prefer stored_url over temporary blob URL
              if (imageRow?.stored_url) {
                finalImageUrl = imageRow.stored_url;
              }

              // Extract the seed from image settings so the client can use it
              // for character approval / consistency
              const settings = imageRow?.settings as Record<string, unknown> | null;
              if (settings?.seed != null && settings.seed !== -1) {
                seed = Number(settings.seed);
              }
            }
          }
        } catch {
          console.warn("Failed to update job status in Supabase");
        }
      }

      return NextResponse.json({
        jobId: job.jobId,
        cost: job.cost,
        scheduled: job.scheduled,
        completed,
        imageUrl: finalImageUrl,
        imageUrlExpiration: job.result?.[0]?.blobUrlExpirationDate ?? null,
        seed,
      });
    }
  } catch (err) {
    if (err instanceof CivitaiError) {
      return NextResponse.json(
        { error: err.message, details: err.details },
        { status: err.status }
      );
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
