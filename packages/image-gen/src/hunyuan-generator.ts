import { getReplicateClient } from "./replicate-client";

/**
 * Shared cinematic "look" suffix appended to every HunyuanImage prompt
 * so all images share a consistent visual signature regardless of scene.
 */
export const VISUAL_SIGNATURE =
  "Cinematic shallow depth of field. Rich shadows with luminous highlights. Soft skin glow. Intimate framing. Editorial photography quality. Photorealistic.";

export interface HunyuanGenerateOptions {
  /** The scene/action description (e.g. from story_image_prompts.prompt) */
  scenePrompt: string;
  /** The approved portrait prompt for the primary character (verbatim injection). */
  characterBlock?: string;
  /** The approved portrait prompt for the secondary character (verbatim injection). */
  secondaryCharacterBlock?: string;
  /** Aspect ratio hint. Defaults to '3:4' (portrait). Use '4:3' for two-character scenes. */
  aspectRatio?: string;
  /** Override the visual signature suffix. Default: the shared VISUAL_SIGNATURE constant. */
  visualSignature?: string;
}

export interface HunyuanGenerateResult {
  /** Temporary Replicate CDN URL — download + re-upload to Supabase Storage. */
  imageUrl: string;
  /** Model slug the image was generated with. */
  model: string;
  /** The exact full prompt that was sent to Replicate. */
  prompt: string;
}

const HUNYUAN_MODEL = "tencent/hunyuan-image-3";

/**
 * Assemble the full prompt that gets sent to HunyuanImage 3.0.
 *
 * Ordering matters — CLIP/language models weight earlier tokens more
 * heavily, so character identity (the locked portrait prompts) goes
 * first, then the scene action, then the cinematic signature.
 */
export function assembleHunyuanPrompt(options: HunyuanGenerateOptions): string {
  const parts: string[] = [];

  if (options.characterBlock?.trim()) {
    parts.push(options.characterBlock.trim());
  }
  if (options.secondaryCharacterBlock?.trim()) {
    parts.push(options.secondaryCharacterBlock.trim());
  }
  if (options.scenePrompt?.trim()) {
    parts.push(options.scenePrompt.trim());
  }

  const signature = options.visualSignature ?? VISUAL_SIGNATURE;
  if (signature.trim()) {
    parts.push(signature.trim());
  }

  return parts.join(" ");
}

/**
 * Run a single HunyuanImage 3.0 generation on Replicate.
 *
 * Synchronous from the caller's perspective — `replicate.run()` polls
 * the prediction internally and resolves when the output is ready.
 *
 * Throws descriptive errors on auth failure, safety filter, timeouts,
 * or a missing image URL. Does NOT re-upload to Supabase Storage — the
 * caller is responsible for persisting the returned URL.
 */
export async function generateHunyuanImage(
  options: HunyuanGenerateOptions
): Promise<HunyuanGenerateResult> {
  const prompt = assembleHunyuanPrompt(options);
  if (!prompt) {
    throw new Error("Cannot generate HunyuanImage: assembled prompt is empty");
  }

  const aspectRatio = options.aspectRatio ?? "3:4";
  const client = getReplicateClient();

  let output: unknown;
  try {
    output = await client.run(HUNYUAN_MODEL, {
      input: {
        prompt,
        aspect_ratio: aspectRatio,
      },
    });
  } catch (err) {
    throw new Error(
      `HunyuanImage generation failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const imageUrl = extractImageUrl(output);
  if (!imageUrl) {
    throw new Error(
      `HunyuanImage generation returned no image URL (output: ${safeStringify(output)})`
    );
  }

  return {
    imageUrl,
    model: HUNYUAN_MODEL,
    prompt,
  };
}

/**
 * Replicate's `run()` can return: a string URL, a ReadableStream/FileOutput
 * with a .url() method, an array of either, or an object wrapping one of
 * the above. Normalize all of these to a plain https:// URL.
 */
function extractImageUrl(output: unknown): string | null {
  if (!output) return null;

  // Direct string URL
  if (typeof output === "string") {
    return output.startsWith("http") ? output : null;
  }

  // Array — take the first entry and recurse
  if (Array.isArray(output)) {
    for (const entry of output) {
      const url = extractImageUrl(entry);
      if (url) return url;
    }
    return null;
  }

  // FileOutput-like object with a .url() method (Replicate SDK v1+)
  if (typeof output === "object") {
    const obj = output as { url?: unknown };
    if (typeof obj.url === "function") {
      try {
        const urlObj = (obj.url as () => unknown)();
        if (urlObj && typeof urlObj === "object" && "toString" in urlObj) {
          const s = String(urlObj);
          return s.startsWith("http") ? s : null;
        }
        if (typeof urlObj === "string" && urlObj.startsWith("http")) {
          return urlObj;
        }
      } catch {
        // fall through to other checks
      }
    }
    if (typeof obj.url === "string" && obj.url.startsWith("http")) {
      return obj.url;
    }
  }

  return null;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
