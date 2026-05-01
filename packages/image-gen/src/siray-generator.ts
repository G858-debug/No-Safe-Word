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

import {
  getSirayClient,
  type SirayJobPayload,
  type SirayModelId,
  type SirayJobStatus,
} from "./siray-client";

export type { SirayJobStatus };

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

/** Result of a submit-only call. The caller is responsible for polling. */
export interface SubmitSirayImageResult {
  /** Siray task_id — used as the unique handle to poll status. */
  taskId: string;
  /** The model variant the job was submitted to. */
  model: SirayModelId;
  /** The exact prompt sent. */
  prompt: string;
  /** Resolved size string (e.g. "768x1024"). */
  size: string;
  /** True if i2i (referenceImageUrls non-empty), false for t2i. */
  isI2I: boolean;
  /** How many reference images were attached, for telemetry. */
  referenceImageCount: number;
}

function buildSirayPayload(params: GenerateSirayImageParams): {
  payload: SirayJobPayload;
  isI2I: boolean;
  size: string;
} {
  const prompt = params.prompt?.trim();
  if (!prompt) {
    throw new Error("[siray] prompt is empty");
  }

  const size = mapAspectRatioToSize(params.aspectRatio);
  const useI2I =
    Array.isArray(params.referenceImageUrls) && params.referenceImageUrls.length > 0;

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

  return { payload, isI2I: useI2I, size };
}

/**
 * Submit a single Siray.ai generation, wait for completion, and return the
 * resulting image URL. Synchronous from the caller's perspective. Use this
 * for short-lived contexts (scripts, tests) or when wrapping in an external
 * job runner. For HTTP routes prefer `submitSirayImage` + the `/api/status`
 * polling pattern — Siray generations regularly cross HTTP-proxy timeouts.
 *
 * t2i payloads omit the `images` field entirely. i2i payloads always include
 * a non-empty `images` array.
 */
export async function generateSirayImage(
  params: GenerateSirayImageParams
): Promise<string> {
  const { payload } = buildSirayPayload(params);
  const client = getSirayClient();
  const taskId = await client.submitJob(payload);
  return client.pollForResult(taskId);
}

/**
 * Submit a single Siray.ai generation and return the task_id immediately.
 * The caller must poll `getSirayClient().getJobStatus(taskId)` (typically via
 * `/api/status/siray-{taskId}`) until completion.
 *
 * This is the recommended path for HTTP routes — it decouples the Node
 * request-handler lifetime from Siray's queue depth, which can occasionally
 * push a single generation past 2-3 minutes (longer than browser/proxy
 * timeouts in the 60–120s range).
 */
export async function submitSirayImage(
  params: GenerateSirayImageParams
): Promise<SubmitSirayImageResult> {
  const { payload, isI2I, size } = buildSirayPayload(params);
  const client = getSirayClient();
  const taskId = await client.submitJob(payload);
  return {
    taskId,
    model: payload.model,
    prompt: payload.prompt,
    size,
    isI2I,
    referenceImageCount: isI2I ? params.referenceImageUrls!.length : 0,
  };
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
