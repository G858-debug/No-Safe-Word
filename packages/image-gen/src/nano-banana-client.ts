/**
 * Google Nano Banana 2 (Gemini 3.1 Flash Image Preview) client on Siray.ai.
 *
 * Sits alongside `siray-generator.ts` (Hunyuan-shaped) because Nano Banana 2
 * uses size CLASSES ("1k" | "2k" | …) plus an explicit `aspect_ratio`
 * field, whereas Hunyuan takes literal pixel dims and no aspect ratio.
 *
 * Same Siray endpoint, same API key, same async-task lifecycle — submit
 * returns a task_id; `/api/status/siray-{taskId}` polls. Job ID stays
 * `siray-{taskId}` so the existing siray-job-handler picks it up unchanged.
 *
 * Used today by the face-portrait dispatcher only. Body / scene / cover
 * generation continue to dispatch on `story_series.image_model`.
 */
import {
  getSirayClient,
  type SirayJobPayload,
} from "./siray-client";

// Narrow subtype of SirayModelId. Used for the result type so callers
// can rely on `model` being one of these two strings without re-checking.
export type NanoBananaModelId =
  | "google/nano-banana-2-t2i"
  | "google/nano-banana-2-i2i";

const T2I_MODEL: NanoBananaModelId = "google/nano-banana-2-t2i";
const I2I_MODEL: NanoBananaModelId = "google/nano-banana-2-i2i";

export type NanoBananaSize = "512" | "1k" | "2k" | "4k";

// Subset of the 14 ratios Nano Banana 2 supports — only the ones the
// portrait pipeline actually needs. Widen as new call sites come online.
export type NanoBananaAspect = "1:1" | "2:3" | "3:2" | "4:5" | "5:4";

export interface SubmitNanoBananaParams {
  prompt: string;
  size: NanoBananaSize;
  aspectRatio: NanoBananaAspect;
  /** Empty/undefined → t2i. Non-empty → i2i. URLs or base64 data-URIs. */
  referenceImageUrls?: string[];
  seed?: number;
}

export interface SubmitNanoBananaResult {
  taskId: string;
  model: NanoBananaModelId;
  prompt: string;
  size: NanoBananaSize;
  aspectRatio: NanoBananaAspect;
  isI2I: boolean;
  referenceImageCount: number;
}

/**
 * Pure payload builder. Exported so the unit test can pin the contract:
 * `model` is always one of the two Nano Banana 2 strings, never anything
 * else, regardless of input.
 */
export function buildNanoBananaPayload(
  params: SubmitNanoBananaParams
): { payload: SirayJobPayload; isI2I: boolean } {
  const prompt = params.prompt?.trim();
  if (!prompt) {
    throw new Error("[nano-banana] prompt is empty");
  }

  const useI2I =
    Array.isArray(params.referenceImageUrls) &&
    params.referenceImageUrls.length > 0;

  const payload: SirayJobPayload = useI2I
    ? {
        model: I2I_MODEL,
        prompt,
        size: params.size,
        aspect_ratio: params.aspectRatio,
        images: params.referenceImageUrls!,
        ...(params.seed !== undefined ? { seed: params.seed } : {}),
      }
    : {
        model: T2I_MODEL,
        prompt,
        size: params.size,
        aspect_ratio: params.aspectRatio,
        ...(params.seed !== undefined ? { seed: params.seed } : {}),
      };

  return { payload, isI2I: useI2I };
}

/**
 * Submit a single Nano Banana 2 generation and return the task_id
 * immediately. Caller polls `/api/status/siray-{taskId}` until completion.
 */
export async function submitNanoBananaImage(
  params: SubmitNanoBananaParams
): Promise<SubmitNanoBananaResult> {
  const { payload, isI2I } = buildNanoBananaPayload(params);
  const model: NanoBananaModelId = isI2I ? I2I_MODEL : T2I_MODEL;
  const client = getSirayClient();
  const taskId = await client.submitJob(payload);
  return {
    taskId,
    model,
    prompt: payload.prompt,
    size: params.size,
    aspectRatio: params.aspectRatio,
    isI2I,
    referenceImageCount: isI2I ? params.referenceImageUrls!.length : 0,
  };
}
