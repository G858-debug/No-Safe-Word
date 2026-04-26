import { NextRequest, NextResponse } from "next/server";
import { getRunPodJobStatus, base64ToBuffer } from "@no-safe-word/image-gen";
import { handleCoverVariantCompletion } from "./cover-variant-handler";
import { supabase } from "@no-safe-word/story-engine";

/**
 * GET /api/status/[jobId]
 *
 * Poll a pending RunPod job (Flux 2 Dev character portrait or scene image) and,
 * when it completes, upload the image to Supabase Storage and link it to the
 * associated `images` row. Cover-variant jobs are delegated to their dedicated
 * handler which writes back to story_series.cover_variants.
 *
 * The V4 scene-evaluator / Claude-vision retry pipeline that previously lived
 * here was removed along with the Juggernaut Ragnarok path; Flux 2 and Hunyuan
 * don't need it.
 */
export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await props.params;

    if (!jobId) {
      return NextResponse.json(
        { error: "Missing jobId parameter" },
        { status: 400 }
      );
    }

    const { data: jobRow } = await supabase
      .from("generation_jobs")
      .select("image_id, job_type, variant_index, series_id, created_at")
      .eq("job_id", jobId)
      .single();

    const settings: Record<string, unknown> = {};
    const imageId: string | null = jobRow?.image_id ?? null;

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

    // Cover variants have their own state machine — delegate.
    if (jobRow?.job_type === "cover_variant") {
      return await handleCoverVariantCompletion({
        jobId,
        jobRow: {
          image_id: jobRow.image_id,
          variant_index: jobRow.variant_index ?? null,
          series_id: jobRow.series_id ?? null,
          job_created_at: jobRow.created_at ?? null,
        },
        settings,
      });
    }

    const runpodJobId = jobId.startsWith("runpod-")
      ? jobId.replace("runpod-", "")
      : jobId;
    // Flux 2 Dev jobs live on a separate RunPod endpoint from any legacy one.
    const modelSetting =
      typeof settings.model === "string" ? (settings.model as string) : undefined;
    const endpointOverride =
      modelSetting === "flux2_dev"
        ? process.env.RUNPOD_FLUX2_ENDPOINT_ID
        : undefined;
    const status = await getRunPodJobStatus(runpodJobId, endpointOverride);

    if (status.status === "COMPLETED" && status.output?.images?.[0]) {
      const imageData = status.output.images[0].data;
      const base64Data = imageData.includes(",")
        ? imageData.split(",")[1]
        : imageData;

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

      const buffer = base64ToBuffer(base64Data);
      const timestamp = Date.now();
      const storagePath = `stories/${imageId}-${timestamp}.png`;

      const { error: uploadError } = await supabase.storage
        .from("story-images")
        .upload(storagePath, buffer, {
          contentType: "image/png",
          upsert: true,
        });

      if (uploadError) {
        return NextResponse.json({
          jobId,
          completed: false,
          error: `Image storage failed: ${uploadError.message}`,
        });
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("story-images").getPublicUrl(storagePath);

      await supabase
        .from("images")
        .update({ stored_url: publicUrl, sfw_url: publicUrl })
        .eq("id", imageId);

      await supabase
        .from("generation_jobs")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("job_id", jobId);

      // If a story_image_prompts row points at this image, mark it generated.
      const { data: promptResult } = await supabase
        .from("story_image_prompts")
        .select("id")
        .eq("image_id", imageId)
        .maybeSingle();

      if (promptResult) {
        await supabase
          .from("story_image_prompts")
          .update({ status: "generated" })
          .eq("id", promptResult.id);
      }

      const seed = settings.seed != null ? Number(settings.seed) : null;

      return NextResponse.json({
        jobId,
        completed: true,
        imageUrl: publicUrl,
        seed,
        cost: 0,
        scheduled: true,
      });
    }

    if (status.status === "FAILED") {
      await supabase
        .from("generation_jobs")
        .update({ status: "failed" })
        .eq("job_id", jobId);

      if (imageId) {
        const { data: failedPrompt } = await supabase
          .from("story_image_prompts")
          .select("id")
          .eq("image_id", imageId)
          .maybeSingle();
        if (failedPrompt) {
          await supabase
            .from("story_image_prompts")
            .update({ status: "failed" })
            .eq("id", failedPrompt.id);
        }
      }

      return NextResponse.json({
        jobId,
        completed: false,
        error: status.error || "RunPod job failed",
      });
    }

    return NextResponse.json({
      jobId,
      completed: false,
      status: status.status,
      delayTime: status.delayTime ?? null,
    });
  } catch (err) {
    console.error("Status check failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
