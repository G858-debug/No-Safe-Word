/**
 * Nano Banana 2 Scene Generation (Stage A of V2 Pipeline)
 *
 * Generates a full scene image via NB2 on Replicate.
 * NB2's multi-image reference handles character visual consistency
 * without LoRAs or PuLID — the reference images guide the generation.
 *
 * This module is independent from the existing runNanoBanana() function
 * in replicate-client.ts, which is tuned for character portraits (1:1 aspect).
 * Scene generation uses different aspect ratios and multiple reference images.
 */

import Replicate from 'replicate';
import { readReplicateOutput } from './replicate-client';

const NANO_BANANA_MODEL = 'google/nano-banana-2' as const;

export interface Nb2SceneConfig {
  /** Scene prompt (setting, lighting, pose, clothing, composition) */
  prompt: string;
  /** Character reference image URLs — NB2 uses these for visual consistency.
   *  Typically: [face_url, body_url] for primary character,
   *  plus [face_url, body_url] for secondary character in dual scenes. */
  referenceImageUrls: string[];
  /** Aspect ratio for the scene image. Default: '3:4' (portrait orientation) */
  aspectRatio?: string;
  /** Seed for reproducibility */
  seed?: number;
  /** Safety tolerance (1=strict, 6=permissive). Default: 6 */
  safetyTolerance?: number;
}

export interface Nb2SceneResult {
  /** Generated scene image as a Buffer */
  imageBuffer: Buffer;
  /** Base64-encoded image (convenience — avoids re-encoding downstream) */
  imageBase64: string;
}

/**
 * Run Nano Banana 2 on Replicate for scene generation.
 *
 * Returns the generated scene as both Buffer and base64.
 * This is Stage A of the V2 pipeline.
 */
export async function runNb2Scene(config: Nb2SceneConfig): Promise<Nb2SceneResult> {
  if (!process.env.REPLICATE_API_TOKEN) {
    throw new Error('Missing REPLICATE_API_TOKEN environment variable');
  }

  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

  const input: Record<string, unknown> = {
    prompt: config.prompt,
    aspect_ratio: config.aspectRatio || '3:4',
    output_format: 'png',
    safety_tolerance: config.safetyTolerance ?? 6,
  };

  // NB2 accepts multiple reference images for multi-subject consistency
  if (config.referenceImageUrls.length > 0) {
    input.image_input = config.referenceImageUrls;
  }

  if (config.seed !== undefined) {
    input.seed = config.seed;
  }

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(
      `[NB2 Scene] Generating scene (attempt ${attempt}/${maxRetries}) with ` +
      `${config.referenceImageUrls.length} reference images, ` +
      `aspect=${config.aspectRatio || '3:4'}, seed=${input.seed ?? 'random'}`,
    );

    try {
      const output = await replicate.run(NANO_BANANA_MODEL, { input });
      const imageBuffer = await readReplicateOutput(output);
      const imageBase64 = imageBuffer.toString('base64');

      console.log(
        `[NB2 Scene] Generated: ${Math.round(imageBuffer.length / 1024)}KB`,
      );

      return { imageBuffer, imageBase64 };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[NB2 Scene] Attempt ${attempt} failed: ${message}`,
      );

      if (attempt === maxRetries) {
        throw new Error(`NB2 scene generation failed after ${maxRetries} attempts: ${message}`);
      }

      // Retry with a new seed to avoid hitting the same failure
      input.seed = Math.floor(Math.random() * 2_147_483_647) + 1;
      console.log(`[NB2 Scene] Retrying with new seed: ${input.seed}`);
    }
  }

  // Unreachable, but TypeScript needs it
  throw new Error('NB2 scene generation failed');
}
