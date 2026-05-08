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

// Native 1-MP sizes documented for HunyuanImage 3.0. Labels match the actual
// pixel ratio of the size (1024:1280 = 4:5, 1280:1024 = 5:4).
const ASPECT_RATIO_TO_SIZE: Record<string, string> = {
  "4:5": "1024x1280",
  "5:4": "1280x1024",
};

export interface GenerateSirayImageParams {
  prompt: string;
  aspectRatio: string;
  /**
   * Optional explicit Siray `size` string ("WIDTHxHEIGHT") that overrides
   * the aspectRatio→size lookup. Used by portrait generation to request
   * higher-resolution outputs (1536x1536 / 1024x1536) than the default
   * 1-MP scene sizes.
   */
  size?: string;
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

  const size = params.size ?? mapAspectRatioToSize(params.aspectRatio);
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
    aspectRatio: "4:5",
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

/**
 * Result of a portrait submission, including visible-fallback metadata.
 *
 * If Siray rejected the requested size and we retried at the fallback,
 * `actualSize` will differ from `requestedSize` and `fallbackReason`
 * will carry Siray's submit-time error message. Otherwise `actualSize`
 * equals `requestedSize` and `fallbackReason` is null.
 */
export interface SubmitSirayPortraitResult extends SubmitSirayImageResult {
  requestedSize: string;
  actualSize: string;
  fallbackReason: string | null;
}

const SIZE_REJECTION_HINTS = [
  "size",
  "dimension",
  "width",
  "height",
  "resolution",
  "pixel",
];

function looksLikeSizeRejection(message: string): boolean {
  const lower = message.toLowerCase();
  return SIZE_REJECTION_HINTS.some((h) => lower.includes(h));
}

/**
 * Portrait-specific submit with VISIBLE fallback.
 *
 * Attempt `requestedSize` first. If Siray rejects it at submit time with a
 * size-shaped error, log a WARN with the full upstream message and retry
 * once at `fallbackSize`. The result captures both the requested and the
 * actual size used, plus the rejection reason — the caller persists those
 * on the `images` row so the dashboard can surface a fallback badge.
 *
 * Never silently narrows. If the fallback also fails, throws the second
 * error so the user sees that the portrait did not generate.
 */
export async function submitSirayPortraitWithFallback(
  params: GenerateSirayImageParams & { fallbackSize: string }
): Promise<SubmitSirayPortraitResult> {
  const requestedSize =
    params.size ?? mapAspectRatioToSize(params.aspectRatio);
  const fallbackSize = params.fallbackSize;

  try {
    const submitted = await submitSirayImage({
      ...params,
      size: requestedSize,
    });
    return {
      ...submitted,
      requestedSize,
      actualSize: submitted.size,
      fallbackReason: null,
    };
  } catch (err) {
    const firstMessage = err instanceof Error ? err.message : String(err);
    if (
      requestedSize === fallbackSize ||
      !looksLikeSizeRejection(firstMessage)
    ) {
      throw err;
    }

    console.warn(
      `[siray] portrait submission rejected at ${requestedSize}; ` +
        `retrying at fallback ${fallbackSize}. Upstream: ${firstMessage}`
    );

    const submitted = await submitSirayImage({
      ...params,
      size: fallbackSize,
    });
    return {
      ...submitted,
      requestedSize,
      actualSize: submitted.size,
      fallbackReason: firstMessage,
    };
  }
}
