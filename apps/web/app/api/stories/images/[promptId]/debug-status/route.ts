/**
 * Debug Status Polling Endpoint
 *
 * GET /api/stories/images/[promptId]/debug-status?jobId=runpod-xxx
 *
 * Polls RunPod job status and, when completed, maps intermediate images
 * back to their debug pass filename prefixes.
 *
 * Location: apps/web/app/api/stories/images/[promptId]/debug-status/route.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { getRunPodJobStatus } from "@no-safe-word/image-gen";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ promptId: string }> }
) {
  const params = await props.params;
  const { promptId } = params;
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");

  if (!jobId) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }

  try {
    // Strip "runpod-" prefix if present for the actual API call
    const runpodJobId = jobId.replace(/^runpod-/, "");
    const status = await getRunPodJobStatus(runpodJobId);

    console.log(`[DebugStatus] Job ${runpodJobId}: status=${status.status}, hasOutput=${!!status.output}, imageCount=${status.output?.images?.length ?? 0}`);

    if (status.status === "COMPLETED" && status.output) {
      // RunPod returns all images (including debug intermediates) in the output
      // Map filename prefixes to image URLs
      const intermediateImages: Record<string, string> = {};

      // The output format from RunPod ComfyUI worker contains images with filenames
      // Each image has { filename, type: 'base64' | 's3_url', data: string }
      if (status.output.images && Array.isArray(status.output.images)) {
        for (const img of status.output.images) {
          if (img.filename && img.data) {
            // Strip ComfyUI counter suffix (_00001_.png) to get the prefix
            // e.g. "debug_43597c6b_pass1_composition_00001_.png" → "debug_43597c6b_pass1_composition"
            const prefix = img.filename.replace(/_\d+_\.png$/, "");
            if (prefix.startsWith("debug_")) {
              const imageUrl = img.type === "s3_url"
                ? img.data
                : `data:image/png;base64,${img.data.replace(/^data:image\/\w+;base64,/, "")}`;
              intermediateImages[prefix] = imageUrl;
            }
          }
        }
      }

      // Also check for the message array format some RunPod workers use
      const output = status.output as any;
      if (output.message && Array.isArray(output.message)) {
        for (const item of output.message) {
          if (typeof item === "object" && item.filename && (item.data || item.url)) {
            const prefix = item.filename.replace(/_\d+_\.png$/, "");
            if (prefix.startsWith("debug_")) {
              intermediateImages[prefix] = item.url || item.data;
            }
          }
        }
      }

      console.log(`[DebugStatus] Matched ${Object.keys(intermediateImages).length} images:`, Object.keys(intermediateImages));

      // Update the debug_data with intermediate image URLs
      // Note: debug_data is a JSONB column added via migration, not yet in generated types
      if (Object.keys(intermediateImages).length > 0) {
        const { data: prompt } = await (supabase as any)
          .from("story_image_prompts")
          .select("debug_data")
          .eq("id", promptId)
          .single() as { data: { debug_data: any } | null };

        if (prompt?.debug_data) {
          const updatedDebugData = {
            ...prompt.debug_data,
            intermediateImages,
          };

          await (supabase as any)
            .from("story_image_prompts")
            .update({ debug_data: updatedDebugData, status: "generated" })
            .eq("id", promptId);
        }
      }

      return NextResponse.json({
        status: "completed",
        intermediateImages,
        executionTime: status.executionTime,
      });
    }

    if (status.status === "FAILED") {
      await supabase
        .from("story_image_prompts")
        .update({ status: "failed" })
        .eq("id", promptId);

      return NextResponse.json({
        status: "failed",
        error: status.error || "Job failed on RunPod",
      });
    }

    // Still in progress
    return NextResponse.json({
      status: status.status === "IN_QUEUE" ? "queued" : "generating",
      delayTime: status.delayTime,
      executionTime: status.executionTime,
    });
  } catch (err) {
    console.error("[DebugStatus] Error:", err);
    return NextResponse.json(
      {
        error: "Status check failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
