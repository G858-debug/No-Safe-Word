/**
 * V2 Pipeline Masking Test Route
 *
 * POST /api/stories/[seriesId]/test-mask-v2
 *
 * Runs ONLY Stage B (Florence-2 + SAM2 masking) on a provided image URL.
 * Used for isolation testing to verify mask quality before running the
 * full inpainting pipeline.
 *
 * Guarded by SCENE_PIPELINE_VERSION=v2 env var.
 *
 * Request body:
 * {
 *   "image_url": "https://...",          // Image URL to mask
 *   "mask_query": "clothing",            // What to detect/mask
 *   "mask_blur_radius": 8,              // Optional, default 8
 *   "mask_dilation_pixels": 12           // Optional, default 12
 * }
 *
 * Returns the mask as base64 image data + the RunPod execution time.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  imageUrlToBase64,
  submitRunPodJob,
  waitForRunPodResult,
} from "@no-safe-word/image-gen";
import { buildFlorenceSam2MaskWorkflow } from "@no-safe-word/image-gen";

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  if (process.env.SCENE_PIPELINE_VERSION !== "v2") {
    return NextResponse.json(
      { error: "V2 pipeline not enabled. Set SCENE_PIPELINE_VERSION=v2 to activate." },
      { status: 404 }
    );
  }

  try {
    const body = await request.json();
    const {
      image_url,
      mask_query = "clothing",
      mask_blur_radius = 8,
      mask_dilation_pixels = 12,
    } = body as {
      image_url: string;
      mask_query?: string;
      mask_blur_radius?: number;
      mask_dilation_pixels?: number;
    };

    if (!image_url) {
      return NextResponse.json(
        { error: "image_url is required" },
        { status: 400 }
      );
    }

    // Download the image
    console.log(`[V2 Mask Test] Downloading image...`);
    const imageBase64 = await imageUrlToBase64(image_url);
    console.log(`[V2 Mask Test] Image: ${Math.round(imageBase64.length / 1024)}KB base64`);

    const inputImageName = "test_image.jpg";

    // Build masking-only workflow
    const workflow = buildFlorenceSam2MaskWorkflow({
      inputImageName,
      florenceQuery: mask_query,
      maskBlurRadius: mask_blur_radius,
      maskDilationPixels: mask_dilation_pixels,
      filenamePrefix: "mask_test",
    });

    console.log(
      `[V2 Mask Test] Workflow built: ${Object.keys(workflow).length} nodes, ` +
      `query="${mask_query}", blur=${mask_blur_radius}, dilation=${mask_dilation_pixels}`
    );

    // Submit to RunPod
    const images = [{ name: inputImageName, image: imageBase64 }];
    const { jobId } = await submitRunPodJob(workflow, images);
    console.log(`[V2 Mask Test] RunPod job submitted: ${jobId}`);

    // Poll for completion (masking should be fast — 30s timeout)
    const result = await waitForRunPodResult(jobId, 120_000, 2000);
    console.log(`[V2 Mask Test] Job completed in ${result.executionTime}ms`);

    return NextResponse.json({
      pipeline: "v2-mask-test",
      maskBase64: result.imageBase64,
      executionTimeMs: result.executionTime,
      config: {
        maskQuery: mask_query,
        maskBlurRadius: mask_blur_radius,
        maskDilationPixels: mask_dilation_pixels,
      },
    });
  } catch (err) {
    console.error("[V2 Mask Test] Failed:", err);
    return NextResponse.json(
      {
        error: "Mask test failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
