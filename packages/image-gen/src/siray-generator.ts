/**
 * Siray.ai image generation — drop-in replacement for the Replicate /
 * HunyuanImage 3.0 path.
 *
 * Two model variants are available on Siray:
 *   - tencent/hunyuan-image-3-instruct-t2i  (text-to-image)
 *   - tencent/hunyuan-image-3-instruct-i2i  (image-to-image, reference-conditioned)
 *
 * `generateSirayImage` picks the variant based on whether reference image
 * URLs were supplied. Helper wrappers (`generateCharacterPortrait`,
 * `generateSceneImage`) exist for clarity at call sites.
 */

import { getSirayClient, type SirayJobPayload, type SirayModelId } from "./siray-client";

const T2I_MODEL: SirayModelId = "tencent/hunyuan-image-3-instruct-t2i";
const I2I_MODEL: SirayModelId = "tencent/hunyuan-image-3-instruct-i2i";

const FALLBACK_SIZE = "1024x1024";

const ASPECT_RATIO_TO_SIZE: Record<string, string> = {
  "3:4": "768x1024",
  "4:3": "1024x768",
  "2:3": "768x1024",
};

export interface GenerateSirayImageParams {
  prompt: string;
  aspectRatio: string;
  /** Empty/undefined → t2i. One or more URLs → i2i. */
  referenceImageUrls?: string[];
  seed?: number;
}

/**
 * Submit a single Siray.ai generation and return the resulting image URL.
 *
 * t2i payloads omit the `images` field entirely. i2i payloads always include
 * a non-empty `images` array.
 */
export async function generateSirayImage(
  params: GenerateSirayImageParams
): Promise<string> {
  const prompt = params.prompt?.trim();
  if (!prompt) {
    throw new Error("[siray] generateSirayImage: prompt is empty");
  }

  const size = mapAspectRatioToSize(params.aspectRatio);
  const useI2I = Array.isArray(params.referenceImageUrls) && params.referenceImageUrls.length > 0;

  const payload: SirayJobPayload = useI2I
    ? {
        model: I2I_MODEL,
        prompt,
        size,
        images: params.referenceImageUrls!,
        ...(params.seed !== undefined ? { seed: params.seed } : {}),
      }
    : {
        model: T2I_MODEL,
        prompt,
        size,
        ...(params.seed !== undefined ? { seed: params.seed } : {}),
      };

  const client = getSirayClient();
  const taskId = await client.submitJob(payload);
  const imageUrl = await client.pollForResult(taskId);
  return imageUrl;
}

/**
 * Generate a character portrait (text-to-image, no reference).
 */
export async function generateCharacterPortrait(
  prompt: string,
  seed?: number
): Promise<string> {
  return generateSirayImage({
    prompt,
    aspectRatio: "3:4",
    seed,
  });
}

/**
 * Generate a scene image. If `referenceImageUrls` is empty, falls back to
 * t2i (logs a warning so missing-portrait drift is visible) rather than
 * throwing — some callers run before any portraits are approved.
 */
export async function generateSceneImage(
  prompt: string,
  referenceImageUrls: string[],
  aspectRatio: string,
  seed?: number
): Promise<string> {
  if (!referenceImageUrls || referenceImageUrls.length === 0) {
    console.warn(
      "[siray] generateSceneImage: no reference images supplied — falling back to t2i"
    );
    return generateSirayImage({ prompt, aspectRatio, seed });
  }

  return generateSirayImage({
    prompt,
    aspectRatio,
    referenceImageUrls,
    seed,
  });
}

function mapAspectRatioToSize(aspectRatio: string | undefined): string {
  if (!aspectRatio) return FALLBACK_SIZE;
  return ASPECT_RATIO_TO_SIZE[aspectRatio] ?? FALLBACK_SIZE;
}
