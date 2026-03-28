/**
 * V4 Scene Generation Pipeline: Multi-LoRA + Face Swap via Replicate
 *
 * Two-step cloud pipeline — no RunPod, no ComfyUI, no PuLID:
 *
 * Step 1: lucataco/flux-dev-multi-lora
 *         Flux 1 Dev base + Uncensored LoRA (+ optional style LoRAs)
 *         → Generates scene with natural poses, NSFW works, no character identity
 *
 * Step 2: easel/advanced-face-swap
 *         Takes generated scene + approved character face portraits
 *         → Swaps in the correct faces while preserving scene, lighting, skin tone
 *         → Supports TWO faces in one pass for dual-character scenes
 *
 * Also exports the original Flux 2 Pro client for SFW-only workflows.
 *
 * Cost per image: ~$0.038 (multi-LoRA) + ~$0.04 (face swap) = ~$0.08 total
 */

import Replicate from 'replicate';
import { readReplicateOutput } from './replicate-client';

// ════════════════════════════════════════════════════════════════════
// V4 Pipeline: Multi-LoRA Scene Generation + Easel Face Swap
// ════════════════════════════════════════════════════════════════════

// Must use owner/name:version format — this model doesn't support the /models/.../predictions shorthand
const FLUX_MULTI_LORA_MODEL = 'lucataco/flux-dev-multi-lora:ad0314563856e714367fdc7244b19b160d25926d305fec270c9e00f64665d352' as const;
const FACE_SWAP_MODEL = 'easel/advanced-face-swap' as const;

/** Uncensored LoRA — removes Flux 1 Dev's content restrictions for NSFW */
const UNCENSORED_LORA_URL = 'https://huggingface.co/enhanceaiteam/Flux-Uncensored-V2/resolve/main/lora.safetensors';

// ── Multi-LoRA Scene Types ──

export interface MultiLoraSceneConfig {
  /** Scene prompt — Five Layers format, flowing prose.
   *  Focus on: setting, lighting, pose, clothing state, composition, atmosphere.
   *  Character identity is handled by the face swap step. */
  prompt: string;
  /** Aspect ratio. Default: '2:3' (portrait) for single character, '3:2' (landscape) for dual. */
  aspectRatio?: string;
  /** Additional style LoRA URLs from HuggingFace or CivitAI.
   *  The uncensored LoRA is added automatically when isNsfw=true. */
  styleLoraUrls?: string[];
  /** LoRA scales matching styleLoraUrls order. Default: 0.8 for each. */
  styleLoraScales?: number[];
  /** Whether this is NSFW content (adds uncensored LoRA). */
  isNsfw: boolean;
  /** Seed for reproducibility. */
  seed?: number;
  /** Guidance scale. Default: 3.5. Lower (2-3) = more natural. Higher (4-5) = more stylized. */
  guidanceScale?: number;
  /** Number of inference steps. Default: 28. */
  numInferenceSteps?: number;
  /** Output format. Default: 'png'. */
  outputFormat?: 'png' | 'jpg' | 'webp';
}

export interface MultiLoraSceneResult {
  imageBuffer: Buffer;
  imageBase64: string;
  /** Scene image URL from Replicate — temporary, valid for passing to face swap. */
  imageUrl: string;
}

// ── Face Swap Types ──

export interface FaceSwapConfig {
  /** URL of the generated scene image (output from multi-LoRA step) */
  targetImageUrl: string;
  /** URL of the primary character's approved face portrait */
  primaryFaceUrl: string;
  /** Gender of the primary character. Sent as "a man" / "a woman" per Easel API. */
  primaryGender: 'male' | 'female';
  /** URL of the secondary character's approved face portrait (dual-character scenes) */
  secondaryFaceUrl?: string;
  /** Gender of the secondary character */
  secondaryGender?: 'male' | 'female';
  /** Hair source: 'target' preserves scene's hair, 'user' uses face reference's hair.
   *  Default: 'target' — we want the scene's hair since the prompt describes it. */
  hairSource?: 'target' | 'user';
}

export interface FaceSwapResult {
  imageBuffer: Buffer;
  imageBase64: string;
}

// ── Combined V4 Pipeline Types ──

export interface V4PipelineConfig {
  /** Scene prompt — setting, lighting, pose, clothing, composition. */
  prompt: string;
  /** Primary character's approved face image URL */
  primaryFaceUrl: string;
  primaryGender: 'male' | 'female';
  /** Secondary character (for dual-character scenes) */
  secondaryFaceUrl?: string;
  secondaryGender?: 'male' | 'female';
  /** Whether this is NSFW content */
  isNsfw: boolean;
  /** Additional style LoRAs */
  styleLoraUrls?: string[];
  styleLoraScales?: number[];
  /** Aspect ratio override */
  aspectRatio?: string;
  /** Seed */
  seed?: number;
}

export interface V4PipelineResult {
  /** Final image with faces swapped */
  finalImageBuffer: Buffer;
  finalImageBase64: string;
  /** Intermediate scene image before face swap (for debugging) */
  sceneImageBase64: string;
  seed: number;
}

// ── Multi-LoRA Scene Generation ──

/**
 * Extract a URL string from Replicate output.
 * FileOutput objects have a .url() method; legacy outputs are plain URL strings.
 */
function extractReplicateUrl(output: unknown): string | null {
  const value = Array.isArray(output) ? output[0] : output;
  if (!value) return null;

  // FileOutput — has a url() method
  if (typeof value === 'object' && 'url' in value && typeof (value as any).url === 'function') {
    return String((value as any).url());
  }

  // Plain URL string
  if (typeof value === 'string' && value.startsWith('http')) {
    return value;
  }

  return null;
}

/**
 * Generate a scene image using Flux Dev Multi-LoRA on Replicate.
 *
 * Applies the uncensored LoRA for NSFW content and any additional style LoRAs.
 * Returns the image buffer + a temporary Replicate URL for the face swap step.
 */
export async function runMultiLoraScene(config: MultiLoraSceneConfig): Promise<MultiLoraSceneResult> {
  if (!process.env.REPLICATE_API_TOKEN) {
    throw new Error('Missing REPLICATE_API_TOKEN environment variable');
  }

  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

  // Build LoRA stack
  const loras: string[] = [];
  const scales: number[] = [];

  if (config.isNsfw) {
    loras.push(UNCENSORED_LORA_URL);
    scales.push(0.8);
  }

  if (config.styleLoraUrls) {
    loras.push(...config.styleLoraUrls);
    const styleScales = config.styleLoraScales || config.styleLoraUrls.map(() => 0.8);
    scales.push(...styleScales);
  }

  const input: Record<string, unknown> = {
    prompt: config.prompt,
    aspect_ratio: config.aspectRatio || '2:3',
    output_format: config.outputFormat || 'png',
    output_quality: 95,
    guidance_scale: config.guidanceScale ?? 3.5,
    num_inference_steps: config.numInferenceSteps ?? 28,
    disable_safety_checker: true,
    num_outputs: 1,
  };

  // hf_loras and lora_scales are both arrays per the Replicate schema
  if (loras.length > 0) {
    input.hf_loras = loras;
    input.lora_scales = scales;
  }

  if (config.seed !== undefined) {
    input.seed = config.seed;
  }

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(
      `[MultiLoRA] Generating scene (attempt ${attempt}/${maxRetries}) — ` +
      `${loras.length} LoRA(s) [${config.isNsfw ? 'uncensored' : 'SFW'}], ` +
      `aspect=${config.aspectRatio || '2:3'}, seed=${input.seed ?? 'random'}`,
    );

    try {
      const output = await replicate.run(FLUX_MULTI_LORA_MODEL, { input });

      // Extract URL before consuming the stream (FileOutput can only be read once)
      const imageUrl = extractReplicateUrl(output);
      const imageBuffer = imageUrl
        ? await fetchImageBuffer(imageUrl)
        : await readReplicateOutput(output);

      if (!imageUrl) {
        throw new Error('Could not extract URL from Replicate output — face swap requires a URL');
      }

      console.log(
        `[MultiLoRA] Generated: ${Math.round(imageBuffer.length / 1024)}KB`,
      );

      return {
        imageBuffer,
        imageBase64: imageBuffer.toString('base64'),
        imageUrl,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[MultiLoRA] Attempt ${attempt} failed: ${message}`);

      if (attempt === maxRetries) {
        throw new Error(`Multi-LoRA scene generation failed after ${maxRetries} attempts: ${message}`);
      }

      input.seed = Math.floor(Math.random() * 2_147_483_647) + 1;
      console.log(`[MultiLoRA] Retrying with new seed: ${input.seed}`);
    }
  }

  throw new Error('Multi-LoRA scene generation failed');
}

/** Download an image from a URL into a Buffer */
async function fetchImageBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image from ${url}: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

// ── Face Swap ──

/** Build the Replicate input object for Easel face swap */
function buildFaceSwapInput(config: FaceSwapConfig): Record<string, unknown> {
  const genderLabel = (g: 'male' | 'female') => g === 'male' ? 'a man' : 'a woman';

  const input: Record<string, unknown> = {
    target_image: config.targetImageUrl,
    swap_image: config.primaryFaceUrl,
    hair_source: config.hairSource || 'target',
    user_gender: genderLabel(config.primaryGender),
  };

  if (config.secondaryFaceUrl) {
    input.swap_image_b = config.secondaryFaceUrl;
  }
  if (config.secondaryGender) {
    input.user_b_gender = genderLabel(config.secondaryGender);
  }

  return input;
}

/**
 * Submit a face swap as an async Replicate prediction (non-blocking).
 * Returns the prediction ID for polling via checkFaceSwapStatus().
 *
 * Use this instead of runFaceSwap() when the total pipeline time
 * would exceed the HTTP request timeout (e.g. Cloudflare's 100s limit).
 */
export async function submitFaceSwap(config: FaceSwapConfig): Promise<string> {
  if (!process.env.REPLICATE_API_TOKEN) {
    throw new Error('Missing REPLICATE_API_TOKEN environment variable');
  }

  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
  const input = buildFaceSwapInput(config);

  console.log(
    `[FaceSwap] Submitting async: ${config.secondaryFaceUrl ? '2 faces' : '1 face'}, ` +
    `hair_source=${config.hairSource || 'target'}, ` +
    `primary=${config.primaryGender}, secondary=${config.secondaryGender || 'none'}`,
  );

  const prediction = await replicate.predictions.create({
    model: FACE_SWAP_MODEL,
    input,
  });

  console.log(`[FaceSwap] Prediction submitted: ${prediction.id}, status=${prediction.status}`);
  return prediction.id;
}

export interface FaceSwapStatus {
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  /** Set when status === 'succeeded' */
  imageBuffer?: Buffer;
  imageBase64?: string;
  /** Set when status === 'failed' */
  error?: string;
}

/**
 * Check the status of an async face swap prediction.
 * When succeeded, downloads and returns the result image.
 */
export async function checkFaceSwapStatus(predictionId: string): Promise<FaceSwapStatus> {
  if (!process.env.REPLICATE_API_TOKEN) {
    throw new Error('Missing REPLICATE_API_TOKEN environment variable');
  }

  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
  const prediction = await replicate.predictions.get(predictionId);

  if (prediction.status === 'failed' || prediction.status === 'canceled') {
    return {
      status: prediction.status,
      error: prediction.error ? String(prediction.error) : `Face swap ${prediction.status}`,
    };
  }

  if (prediction.status === 'succeeded') {
    const imageBuffer = await readReplicateOutput(prediction.output);
    console.log(`[FaceSwap] Complete: ${Math.round(imageBuffer.length / 1024)}KB`);
    return {
      status: 'succeeded',
      imageBuffer,
      imageBase64: imageBuffer.toString('base64'),
    };
  }

  // Still running
  return { status: prediction.status as FaceSwapStatus['status'] };
}

/**
 * Swap faces synchronously (blocking). Only use when timeout is not a concern
 * (e.g. batch scripts, background workers). For HTTP routes, use
 * submitFaceSwap() + checkFaceSwapStatus() instead.
 */
export async function runFaceSwap(config: FaceSwapConfig): Promise<FaceSwapResult> {
  if (!process.env.REPLICATE_API_TOKEN) {
    throw new Error('Missing REPLICATE_API_TOKEN environment variable');
  }

  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
  const input = buildFaceSwapInput(config);

  console.log(
    `[FaceSwap] Swapping ${config.secondaryFaceUrl ? '2 faces' : '1 face'} ` +
    `onto scene, hair_source=${config.hairSource || 'target'}, ` +
    `primary=${config.primaryGender}, secondary=${config.secondaryGender || 'none'}`,
  );

  const output = await replicate.run(FACE_SWAP_MODEL, { input });
  const imageBuffer = await readReplicateOutput(output);

  console.log(`[FaceSwap] Complete: ${Math.round(imageBuffer.length / 1024)}KB`);

  return {
    imageBuffer,
    imageBase64: imageBuffer.toString('base64'),
  };
}

// ── Combined V4 Pipeline ──

export interface V4PipelineAsyncResult {
  /** Scene image buffer (pre-face-swap) — store this immediately */
  sceneImageBuffer: Buffer;
  sceneImageBase64: string;
  /** Replicate prediction ID for the face swap step (poll via checkFaceSwapStatus) */
  faceSwapPredictionId: string | null;
  seed: number;
}

/**
 * Run V4 pipeline Step 1 synchronously, then submit Step 2 (face swap) async.
 *
 * Returns immediately after submitting the face swap prediction.
 * The caller should store the scene image, then poll checkFaceSwapStatus()
 * to get the final face-swapped image when ready.
 *
 * If no face URL is provided, faceSwapPredictionId is null (no swap needed).
 */
export async function runV4PipelineAsync(config: V4PipelineConfig): Promise<V4PipelineAsyncResult> {
  const seed = config.seed ?? Math.floor(Math.random() * 2_147_483_647) + 1;
  const isDual = !!config.secondaryFaceUrl;
  const aspectRatio = config.aspectRatio || (isDual ? '3:2' : '2:3');

  console.log(`[V4 Pipeline] Step 1: Generating scene via flux-dev-multi-lora...`);
  console.log(`[V4 Pipeline]   NSFW: ${config.isNsfw}, LoRAs: ${(config.styleLoraUrls?.length || 0)} style + ${config.isNsfw ? '1 uncensored' : '0'}`);
  console.log(`[V4 Pipeline]   Aspect: ${aspectRatio}, Seed: ${seed}`);

  // Step 1: Generate scene (synchronous, ~30s)
  const sceneResult = await runMultiLoraScene({
    prompt: config.prompt,
    isNsfw: config.isNsfw,
    aspectRatio,
    styleLoraUrls: config.styleLoraUrls,
    styleLoraScales: config.styleLoraScales,
    seed,
  });

  console.log(`[V4 Pipeline] Step 1 complete: ${Math.round(sceneResult.imageBuffer.length / 1024)}KB`);

  // Step 2: Submit face swap async (non-blocking)
  if (!config.primaryFaceUrl) {
    console.log(`[V4 Pipeline] No face URL — skipping face swap`);
    return {
      sceneImageBuffer: sceneResult.imageBuffer,
      sceneImageBase64: sceneResult.imageBase64,
      faceSwapPredictionId: null,
      seed,
    };
  }

  console.log(`[V4 Pipeline] Step 2: Submitting face swap — ${isDual ? '2 faces' : '1 face'}...`);

  const predictionId = await submitFaceSwap({
    targetImageUrl: sceneResult.imageUrl,
    primaryFaceUrl: config.primaryFaceUrl,
    primaryGender: config.primaryGender,
    secondaryFaceUrl: config.secondaryFaceUrl,
    secondaryGender: config.secondaryGender,
    hairSource: 'target',
  });

  return {
    sceneImageBuffer: sceneResult.imageBuffer,
    sceneImageBase64: sceneResult.imageBase64,
    faceSwapPredictionId: predictionId,
    seed,
  };
}

/**
 * Run the full V4 pipeline synchronously (blocking).
 * Only use in batch scripts or workers where timeout is not a concern.
 * For HTTP routes, use runV4PipelineAsync() + checkFaceSwapStatus() instead.
 */
export async function runV4Pipeline(config: V4PipelineConfig): Promise<V4PipelineResult> {
  const seed = config.seed ?? Math.floor(Math.random() * 2_147_483_647) + 1;
  const isDual = !!config.secondaryFaceUrl;
  const aspectRatio = config.aspectRatio || (isDual ? '3:2' : '2:3');

  const sceneResult = await runMultiLoraScene({
    prompt: config.prompt,
    isNsfw: config.isNsfw,
    aspectRatio,
    styleLoraUrls: config.styleLoraUrls,
    styleLoraScales: config.styleLoraScales,
    seed,
  });

  if (!config.primaryFaceUrl) {
    return {
      finalImageBuffer: sceneResult.imageBuffer,
      finalImageBase64: sceneResult.imageBase64,
      sceneImageBase64: sceneResult.imageBase64,
      seed,
    };
  }

  const swapResult = await runFaceSwap({
    targetImageUrl: sceneResult.imageUrl,
    primaryFaceUrl: config.primaryFaceUrl,
    primaryGender: config.primaryGender,
    secondaryFaceUrl: config.secondaryFaceUrl,
    secondaryGender: config.secondaryGender,
    hairSource: 'target',
  });

  return {
    finalImageBuffer: swapResult.imageBuffer,
    finalImageBase64: swapResult.imageBase64,
    sceneImageBase64: sceneResult.imageBase64,
    seed,
  };
}

// ════════════════════════════════════════════════════════════════════
// Original Flux 2 Pro Client (kept for SFW-only workflows)
// ════════════════════════════════════════════════════════════════════

const FLUX_2_PRO_MODEL = 'black-forest-labs/flux-2-pro' as const;

export interface Flux2ProConfig {
  /** Scene prompt — flowing prose, setting-first, Five Layers format */
  prompt: string;
  /** Character reference image URLs for identity consistency.
   *  Flux 2 Pro supports up to 8 references (9MP total input).
   *  Typically: [face_url, body_url] per character. */
  referenceImageUrls: string[];
  /** Width in pixels. Must be multiple of 16. Default: 1440 */
  width?: number;
  /** Height in pixels. Must be multiple of 16. Default: 1920 */
  height?: number;
  /** Seed for reproducibility */
  seed?: number;
  /** Safety tolerance: 2 for SFW (Facebook), 5 for NSFW (website).
   *  1=most strict, 5=most permissive. */
  safetyTolerance?: number;
  /** Output format. Default: 'png' */
  outputFormat?: 'png' | 'jpg' | 'webp';
}

export interface Flux2ProResult {
  imageBuffer: Buffer;
  imageBase64: string;
}

/** Max 8 reference images per Replicate API schema */
const MAX_REFERENCE_IMAGES = 8;

/**
 * Rewrite NSFW scene prompts to use artistic/photographic language
 * that works with Flux 2 Pro's safety system.
 *
 * Flux 2 Pro's safety filters trigger on direct instructional nudity
 * ("she is naked", "he is shirtless") but pass artistic framing
 * ("bare skin in warm light", "intimate boudoir portrait").
 */
export function rewriteNsfwPromptForFlux2Pro(prompt: string): string {
  let rewritten = prompt;

  const replacements: [RegExp, string][] = [
    // Upper body nudity — female
    [/\b[Ss]he is (naked|nude|bare|topless|unclothed) from the waist up\b/g,
     'her bare upper body is exposed, soft light catching the natural texture of her skin, intimate boudoir framing'],
    [/\b[Ss]he is (naked|nude|topless|bare[- ]?chested)\b/g,
     'her bare skin visible, natural form in soft directional light, fine art nude aesthetic'],
    [/\b[Hh]er (top|shirt|bra|blouse) (is |)(off|removed|on the floor|discarded)\b/g,
     'her upper body bare, natural skin exposed in warm ambient light'],

    // Upper body nudity — male
    [/\b[Hh]e is shirtless\b/g,
     'his bare torso exposed, warm light defining muscle contours and natural skin texture'],
    [/\b[Hh]e is (naked|nude|topless|bare[- ]?chested)\b/g,
     'his bare skin visible, natural musculature in warm light, intimate portrait aesthetic'],
    [/\b[Hh]is (top|shirt) (is |)(off|removed|on the floor|discarded)\b/g,
     'his upper body bare, skin texture visible in warm light'],

    // Gender-neutral / both
    [/\b[Bb]oth (are |)(naked|nude|topless|unclothed|shirtless)\b/g,
     'bare skin on both figures, skin-to-skin warmth, intimate boudoir lighting'],
    [/\b[Tt]hey (are |)(naked|nude|topless|unclothed)\b/g,
     'bare skin on both figures, skin-to-skin warmth, intimate boudoir lighting'],
    [/\bcompletely (naked|nude)\b/gi,
     'fully bare form, artistic nude, natural lighting on exposed skin, fine art photography'],

    // Specific body parts
    [/\bbare breasts\b/gi,
     'exposed chest, natural form with visible skin detail, soft directional lighting'],
    [/\bnaked breasts\b/gi,
     'bare décolletage and natural form, soft shadows across skin, boudoir aesthetic'],
    [/\bnaked from the waist up\b/gi,
     'bare upper body, skin-to-skin warmth, natural light on exposed skin'],

    // Actions
    [/\bundressing\b/gi,
     'fabric slipping away to reveal bare skin underneath'],
    [/\bremoving (her |his |their |)(clothes|clothing|top|shirt|dress|bra)\b/gi,
     'garment falling away, transition from clothed to bare skin'],
    [/\bstripping\b/gi,
     'gradually revealing bare skin, intimate moment of undress'],

    // Overalls / workwear specific (matches the kitchen scene)
    [/\boveralls pushed to his ankles\b/gi,
     'overalls lowered, bare torso fully exposed in warm overhead light'],
    [/\bskirt bunched at her hips\b/gi,
     'skirt gathered at her hips, bare skin above visible in warm light'],
  ];

  for (const [pattern, replacement] of replacements) {
    rewritten = rewritten.replace(pattern, replacement);
  }

  // Append artistic framing if NSFW content detected but no style reference present
  const hasNudeContent = /\b(bare skin|exposed|nude|boudoir|intimate portrait|bare torso|bare upper body)\b/i.test(rewritten);
  const hasStyleRef = /\b(photography|cinematic|photorealistic|editorial|boudoir|fine art)\b/i.test(rewritten);

  if (hasNudeContent && !hasStyleRef) {
    rewritten += ' Photorealistic, cinematic lighting, intimate boudoir photography aesthetic.';
  }

  return rewritten;
}

/**
 * Run Flux 2 Pro on Replicate for scene generation.
 *
 * Returns the generated scene as both Buffer and base64.
 * Synchronous — Replicate returns the image directly (no job polling).
 */
export async function runFlux2Pro(config: Flux2ProConfig): Promise<Flux2ProResult> {
  if (!process.env.REPLICATE_API_TOKEN) {
    throw new Error('Missing REPLICATE_API_TOKEN environment variable');
  }

  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

  const width = config.width ?? 1440;
  const height = config.height ?? 1920;

  const refUrls = config.referenceImageUrls.slice(0, MAX_REFERENCE_IMAGES);

  const input: Record<string, unknown> = {
    prompt: config.prompt,
    aspect_ratio: 'custom',
    width,
    height,
    output_format: config.outputFormat ?? 'png',
    safety_tolerance: config.safetyTolerance ?? 2,
    input_images: refUrls.length > 0 ? refUrls : undefined,
  };

  if (config.seed !== undefined) {
    input.seed = config.seed;
  }

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(
      `[Flux2Pro] Generating scene (attempt ${attempt}/${maxRetries}) with ` +
      `${refUrls.length} reference images via input_images[], ` +
      `${width}x${height} (aspect_ratio=custom), safety=${config.safetyTolerance ?? 2}, seed=${input.seed ?? 'random'}`,
    );
    if (attempt === 1 && refUrls.length > 0) {
      console.log(`[Flux2Pro] Reference URLs: ${refUrls.map((u, i) => `[${i}] ${u.substring(0, 80)}...`).join(', ')}`);
    }

    try {
      const output = await replicate.run(FLUX_2_PRO_MODEL, { input });
      const imageBuffer = await readReplicateOutput(output);
      const imageBase64 = imageBuffer.toString('base64');

      console.log(
        `[Flux2Pro] Generated: ${Math.round(imageBuffer.length / 1024)}KB, ${width}x${height}`,
      );

      return { imageBuffer, imageBase64 };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[Flux2Pro] Attempt ${attempt} failed: ${message}`);

      if (attempt === maxRetries) {
        throw new Error(`Flux 2 Pro generation failed after ${maxRetries} attempts: ${message}`);
      }

      // Retry with a new seed to avoid hitting the same failure
      input.seed = Math.floor(Math.random() * 2_147_483_647) + 1;
      console.log(`[Flux2Pro] Retrying with new seed: ${input.seed}`);
    }
  }

  // Unreachable, but TypeScript needs it
  throw new Error('Flux 2 Pro generation failed');
}
