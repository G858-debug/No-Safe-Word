/**
 * Flux 2 Pro Scene Generation via Replicate
 *
 * Cloud-only pipeline — no LoRAs, no PuLID, no RunPod/ComfyUI.
 * Character consistency comes from multi-reference images (up to 8)
 * passed as `input_images` array (URI strings).
 *
 * NSFW GENERATION BEST PRACTICES (Flux 2 Pro):
 *
 * 1. safety_tolerance=5 for NSFW, safety_tolerance=2 for SFW
 * 2. Use artistic/photographic terminology in prompts:
 *    - "boudoir photography" not "naked woman"
 *    - "intimate portrait, skin texture, natural lighting" not explicit keywords
 *    - "elegant pose, draped fabric revealing form" for tasteful nudity
 * 3. Portrait orientation (3:4 / 2:3) for figure-focused content
 * 4. NO negative prompts — Flux 2 Pro will ADD what you try to exclude
 * 5. Describe what you WANT explicitly. Positive descriptions only.
 * 6. Include: lighting source, camera angle, depth of field, film stock reference
 * 7. For dark-skinned characters: specify "rich dark brown skin with visible
 *    skin texture and pores" — generic prompts often lighten skin tone
 * 8. Reference images are critical for character identity. Always include
 *    face + body refs for each character in the scene.
 * 9. seed control enables reproducible results — save seeds for good outputs
 */

import Replicate from 'replicate';
import { readReplicateOutput } from './replicate-client';

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
