/**
 * V2 Scene Pipeline: NB2 → Florence-2/SAM2 → UnCanny Inpainting
 *
 * This module orchestrates the full V2 inpainting pipeline:
 *   Stage A: NB2 generates the base scene image (caller provides the URL)
 *   Stage B: Florence-2 + SAM2 detect and mask the target region (clothing)
 *   Stage C: UnCanny (Chroma) inpaints the masked region with explicit content
 *
 * Stages B+C run as a single ComfyUI workflow on the existing RunPod endpoint.
 * The original NB2 image is sent as a base64-encoded input image.
 *
 * This module is completely independent from the V1 Kontext pipeline.
 */

import {
  imageUrlToBase64,
  submitRunPodJob,
  waitForRunPodResult,
} from './runpod';
import {
  buildUncannyInpaintWorkflow,
  type FlorenceSam2MaskConfig,
  type UncannyInpaintWorkflowConfig,
} from './workflow-builder-uncanny';
import { runNb2Scene, type Nb2SceneConfig } from './replicate-nb2-scene';

// ── Public Types ──

export interface UncannyInpaintConfig {
  /** NB2 output image URL — the base scene to inpaint */
  baseImageUrl: string;
  /** Florence-2 text query describing what to mask (e.g. 'clothing', 'dress', 'shirt and trousers') */
  maskQuery: string;
  /** Explicit description of what replaces the masked region */
  inpaintPrompt: string;
  /** Random seed for reproducibility. Auto-generated if not provided. */
  seed?: number;
  /** Denoise strength for the inpainting KSampler (0.0–1.0). Default: 0.90 */
  denoiseStrength?: number;
  /** Mask edge feathering radius in pixels. Default: 8 */
  maskBlurRadius?: number;
  /** Mask expansion in pixels to avoid edge artifacts. Default: 12 */
  maskDilationPixels?: number;
  /** Filename prefix for saved ComfyUI outputs. Default: 'uncanny_v2' */
  filenamePrefix?: string;
}

export interface UncannyInpaintResult {
  /** URL of the final inpainted image (base64 from RunPod) */
  imageBase64: string;
  /** The seed used for generation (useful for reproduction) */
  seed: number;
  /** RunPod execution time in ms */
  executionTime: number;
}

// ── Pipeline Orchestrator ──

/**
 * Run the full V2 inpainting pipeline.
 *
 * 1. Downloads the NB2 base image and converts to base64
 * 2. Builds a combined Florence-2/SAM2 + UnCanny ComfyUI workflow
 * 3. Submits to RunPod as a single async job
 * 4. Polls for completion
 * 5. Returns the final inpainted image
 *
 * Throws on any failure — no silent fallbacks.
 */
export async function runUncannyInpaintPipeline(
  config: UncannyInpaintConfig,
): Promise<UncannyInpaintResult> {
  const seed = config.seed ?? Math.floor(Math.random() * 2_147_483_647) + 1;
  const denoiseStrength = config.denoiseStrength ?? 0.90;
  const maskBlurRadius = config.maskBlurRadius ?? 8;
  const maskDilationPixels = config.maskDilationPixels ?? 12;
  const filenamePrefix = config.filenamePrefix ?? 'uncanny_v2';
  const uncannyModelName = process.env.UNCANNY_MODEL_NAME || 'uncanny_v1.3_fp8.safetensors';

  // ── Step 1: Download the NB2 base image ──
  console.log(`[V2 Pipeline] Downloading NB2 base image...`);
  const baseImageBase64 = await imageUrlToBase64(config.baseImageUrl);
  console.log(`[V2 Pipeline] Base image: ${Math.round(baseImageBase64.length / 1024)}KB base64`);

  const inputImageName = 'nb2_base_scene.jpg';

  // ── Step 2: Build the combined workflow ──
  const maskConfig: FlorenceSam2MaskConfig = {
    inputImageName,
    florenceQuery: config.maskQuery,
    maskBlurRadius,
    maskDilationPixels,
    filenamePrefix,
  };

  const inpaintConfig: UncannyInpaintWorkflowConfig = {
    inputImageName,
    inpaintPrompt: config.inpaintPrompt,
    seed,
    denoiseStrength,
    filenamePrefix,
    uncannyModelName,
  };

  const workflow = buildUncannyInpaintWorkflow({
    mask: maskConfig,
    inpaint: inpaintConfig,
  });

  console.log(
    `[V2 Pipeline] Workflow built: ${Object.keys(workflow).length} nodes, ` +
    `model=${uncannyModelName}, seed=${seed}, denoise=${denoiseStrength}, ` +
    `maskQuery="${config.maskQuery}", blur=${maskBlurRadius}, dilation=${maskDilationPixels}`,
  );

  // ── Step 3: Submit to RunPod ──
  const images = [{ name: inputImageName, image: baseImageBase64 }];

  const { jobId } = await submitRunPodJob(workflow, images);
  console.log(`[V2 Pipeline] RunPod job submitted: ${jobId}`);

  // ── Step 4: Poll for completion ──
  // Allow up to 5 minutes — Florence-2 + SAM2 + UnCanny is heavier than Flux alone
  const result = await waitForRunPodResult(jobId, 300_000, 3000);
  console.log(`[V2 Pipeline] Job completed in ${result.executionTime}ms`);

  return {
    imageBase64: result.imageBase64,
    seed,
    executionTime: result.executionTime,
  };
}

/**
 * Submit a V2 inpainting job asynchronously (returns job ID immediately).
 * Use this for batch generation where polling happens externally.
 */
export async function submitUncannyInpaintJob(
  config: UncannyInpaintConfig,
): Promise<{ jobId: string; seed: number }> {
  const seed = config.seed ?? Math.floor(Math.random() * 2_147_483_647) + 1;
  const denoiseStrength = config.denoiseStrength ?? 0.90;
  const maskBlurRadius = config.maskBlurRadius ?? 8;
  const maskDilationPixels = config.maskDilationPixels ?? 12;
  const filenamePrefix = config.filenamePrefix ?? 'uncanny_v2';
  const uncannyModelName = process.env.UNCANNY_MODEL_NAME || 'uncanny_v1.3_fp8.safetensors';

  // Download the NB2 base image
  const baseImageBase64 = await imageUrlToBase64(config.baseImageUrl);
  const inputImageName = 'nb2_base_scene.jpg';

  // Build the combined workflow
  const workflow = buildUncannyInpaintWorkflow({
    mask: {
      inputImageName,
      florenceQuery: config.maskQuery,
      maskBlurRadius,
      maskDilationPixels,
      filenamePrefix,
    },
    inpaint: {
      inputImageName,
      inpaintPrompt: config.inpaintPrompt,
      seed,
      denoiseStrength,
      filenamePrefix,
      uncannyModelName,
    },
  });

  const images = [{ name: inputImageName, image: baseImageBase64 }];

  // Ensure the UnCanny model is available on the worker.
  // The model is downloaded via character_lora_downloads handler to /comfyui/models/loras/,
  // which is mapped as a diffusion_models search path in extra_model_paths.yaml.
  // The handler caches the file — subsequent jobs skip the download.
  const uncannyDownloadUrl = process.env.UNCANNY_MODEL_DOWNLOAD_URL || '';
  const characterLoraDownloads = uncannyDownloadUrl
    ? [{ filename: uncannyModelName, url: uncannyDownloadUrl }]
    : undefined;

  const { jobId } = await submitRunPodJob(workflow, images, characterLoraDownloads);

  console.log(
    `[V2 Pipeline] Async job submitted: ${jobId}, seed=${seed}, ` +
    `maskQuery="${config.maskQuery}", denoise=${denoiseStrength}`,
  );

  return { jobId, seed };
}

// ── Full End-to-End Pipeline (Stage A + B + C) ──

export interface V2FullPipelineConfig {
  /** Scene prompt for NB2 generation (Stage A) */
  scenePrompt: string;
  /** Character reference image URLs for NB2 visual consistency */
  referenceImageUrls: string[];
  /** Aspect ratio for NB2 scene generation. Default: '3:4' */
  aspectRatio?: string;
  /** Florence-2 mask query. Default: 'clothing' */
  maskQuery?: string;
  /** Inpainting prompt for UnCanny (Stage C) */
  inpaintPrompt: string;
  /** Seed for NB2 generation */
  nb2Seed?: number;
  /** Seed for UnCanny inpainting */
  inpaintSeed?: number;
  /** Denoise strength for inpainting. Default: 0.90 */
  denoiseStrength?: number;
  /** Mask blur radius. Default: 8 */
  maskBlurRadius?: number;
  /** Mask dilation pixels. Default: 12 */
  maskDilationPixels?: number;
  /** Filename prefix for outputs */
  filenamePrefix?: string;
}

export interface V2FullPipelineResult {
  /** Final inpainted image as base64 */
  imageBase64: string;
  /** NB2 base scene image as base64 (useful for comparison) */
  nb2ImageBase64: string;
  /** Seeds used (for reproducibility) */
  nb2Seed?: number;
  inpaintSeed: number;
  /** RunPod execution time for inpainting (ms) */
  inpaintExecutionTime: number;
}

/**
 * Run the full V2 pipeline end-to-end:
 *   Stage A: NB2 on Replicate → base scene image
 *   Stage B+C: Florence-2/SAM2 masking + UnCanny inpainting on RunPod
 *
 * This function handles the complete flow. For batch generation where
 * NB2 and inpainting run separately, use runNb2Scene() + submitUncannyInpaintJob().
 */
export async function runV2FullPipeline(
  config: V2FullPipelineConfig,
): Promise<V2FullPipelineResult> {
  const filenamePrefix = config.filenamePrefix ?? 'uncanny_v2';

  // ── Stage A: NB2 Scene Generation on Replicate ──
  console.log(`[V2 Full] Stage A: Generating base scene via NB2...`);
  const nb2Result = await runNb2Scene({
    prompt: config.scenePrompt,
    referenceImageUrls: config.referenceImageUrls,
    aspectRatio: config.aspectRatio || '3:4',
    seed: config.nb2Seed,
  });
  console.log(`[V2 Full] Stage A complete: ${Math.round(nb2Result.imageBuffer.length / 1024)}KB`);

  // ── Stage B+C: Masking + Inpainting on RunPod ──
  const inpaintSeed = config.inpaintSeed ?? Math.floor(Math.random() * 2_147_483_647) + 1;
  const uncannyModelName = process.env.UNCANNY_MODEL_NAME || 'uncanny_v1.3_fp8.safetensors';
  const maskQuery = config.maskQuery || 'clothing';
  const denoiseStrength = config.denoiseStrength ?? 0.90;
  const maskBlurRadius = config.maskBlurRadius ?? 8;
  const maskDilationPixels = config.maskDilationPixels ?? 12;

  const inputImageName = 'nb2_base_scene.jpg';

  const workflow = buildUncannyInpaintWorkflow({
    mask: {
      inputImageName,
      florenceQuery: maskQuery,
      maskBlurRadius,
      maskDilationPixels,
      filenamePrefix,
    },
    inpaint: {
      inputImageName,
      inpaintPrompt: config.inpaintPrompt,
      seed: inpaintSeed,
      denoiseStrength,
      filenamePrefix,
      uncannyModelName,
    },
  });

  console.log(`[V2 Full] Stage B+C: Submitting masking + inpainting workflow...`);
  const images = [{ name: inputImageName, image: nb2Result.imageBase64 }];
  const { jobId } = await submitRunPodJob(workflow, images);
  console.log(`[V2 Full] RunPod job: ${jobId}`);

  const result = await waitForRunPodResult(jobId, 300_000, 3000);
  console.log(`[V2 Full] Pipeline complete in ${result.executionTime}ms`);

  return {
    imageBase64: result.imageBase64,
    nb2ImageBase64: nb2Result.imageBase64,
    nb2Seed: config.nb2Seed,
    inpaintSeed,
    inpaintExecutionTime: result.executionTime,
  };
}
