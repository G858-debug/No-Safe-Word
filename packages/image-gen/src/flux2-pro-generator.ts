import { getReplicateClient } from "./replicate-client";

export interface Flux2ProGenerateOptions {
  prompt: string;
  aspectRatio?: string;
}

export interface Flux2ProGenerateResult {
  imageUrl: string;
  model: string;
  prompt: string;
}

const FLUX2_PRO_MODEL = "black-forest-labs/flux-2-pro" as const;

/**
 * Generate a single image via Flux 2 Pro on Replicate.
 * Text-only — no reference images. Used as a fallback when the RunPod
 * Flux 2 Dev endpoint has no GPU capacity (cover generation only).
 * safety_tolerance: 6 disables content filtering.
 */
export async function generateFlux2ProImage(
  options: Flux2ProGenerateOptions
): Promise<Flux2ProGenerateResult> {
  if (!options.prompt?.trim()) {
    throw new Error("Cannot generate Flux 2 Pro image: prompt is empty");
  }

  const client = getReplicateClient();
  let output: unknown;
  try {
    output = await client.run(FLUX2_PRO_MODEL, {
      input: {
        prompt: options.prompt,
        aspect_ratio: options.aspectRatio ?? "2:3",
        output_format: "jpeg",
        output_quality: 90,
        guidance: 3.5,
        safety_tolerance: 6,
      },
    });
  } catch (err) {
    throw new Error(
      `Flux 2 Pro generation failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const imageUrl = extractImageUrl(output);
  if (!imageUrl) {
    throw new Error(
      `Flux 2 Pro returned no image URL (output: ${JSON.stringify(output)})`
    );
  }

  return { imageUrl, model: FLUX2_PRO_MODEL, prompt: options.prompt };
}

function extractImageUrl(output: unknown): string | null {
  if (!output) return null;
  if (typeof output === "string") return output.startsWith("http") ? output : null;
  if (Array.isArray(output)) {
    for (const entry of output) {
      const url = extractImageUrl(entry);
      if (url) return url;
    }
    return null;
  }
  if (typeof output === "object") {
    const obj = output as { url?: unknown };
    if (typeof obj.url === "function") {
      try {
        const r = (obj.url as () => unknown)();
        if (typeof r === "string" && r.startsWith("http")) return r;
        if (r && typeof r === "object" && "toString" in r) {
          const s = String(r);
          return s.startsWith("http") ? s : null;
        }
      } catch { /* fall through */ }
    }
    if (typeof obj.url === "string" && obj.url.startsWith("http")) return obj.url;
  }
  return null;
}
