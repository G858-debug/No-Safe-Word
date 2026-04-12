/**
 * CivitAI integration for the Art Director pipeline.
 *
 * Part A: Image Search  — searches the /api/v1/images endpoint (NOT /models)
 * Part B: Generation     — wraps civitai.image.fromText() (reuses existing SDK pattern)
 * Part C: Metadata Parser — extracts ParsedRecipe from CivitAI image metadata
 */

import { Civitai, JobEventType } from "civitai";
import type { Scheduler } from "civitai";
import type {
  CivitAIImageResult,
  CivitAIImageMeta,
  ParsedRecipe,
} from "./types";

// ── Helpers ──

function getCivitaiToken(): string {
  const token = process.env.CIVITAI_API_KEY;
  if (!token) throw new Error("CIVITAI_API_KEY not configured");
  return token;
}

// Rate-limit delay between CivitAI requests
const RATE_LIMIT_DELAY_MS = 300;
async function rateLimitDelay(): Promise<void> {
  await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
}

// ── Part A: Image Search ──

export interface ImageSearchParams {
  /** Free-text tag query */
  query?: string;
  /** NSFW filter level */
  nsfw?: boolean | "None" | "Soft" | "Mature" | "X";
  /** Sort order */
  sort?: "Most Reactions" | "Most Comments" | "Newest";
  /** Time period */
  period?: "AllTime" | "Year" | "Month" | "Week" | "Day";
  /** Max results per query (default 10, max 200) */
  limit?: number;
  /** Filter images by model ID */
  modelId?: number;
  /** Filter by model version ID */
  modelVersionId?: number;
}

/**
 * Search CivitAI's IMAGE endpoint for reference images with generation metadata.
 * This is different from the model search at /api/v1/models.
 */
export async function searchCivitAIImages(
  params: ImageSearchParams
): Promise<CivitAIImageResult[]> {
  const token = getCivitaiToken();

  const url = new URL("https://civitai.com/api/v1/images");
  if (params.query) url.searchParams.set("query", params.query);
  if (params.sort) url.searchParams.set("sort", params.sort);
  if (params.period) url.searchParams.set("period", params.period);
  url.searchParams.set("limit", String(params.limit ?? 10));

  // NSFW filtering
  if (params.nsfw === true) {
    url.searchParams.set("nsfw", "true");
  } else if (params.nsfw === false) {
    url.searchParams.set("nsfw", "false");
  } else if (typeof params.nsfw === "string") {
    url.searchParams.set("nsfw", params.nsfw);
  }

  if (params.modelId) url.searchParams.set("modelId", String(params.modelId));
  if (params.modelVersionId) url.searchParams.set("modelVersionId", String(params.modelVersionId));

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[CivitAI Images] Search failed: ${res.status}`, text);
    throw new Error(`CivitAI image search failed: ${res.status}`);
  }

  const data = await res.json();

  return ((data.items || []) as any[]).map((item) => ({
    id: item.id,
    url: item.url,
    width: item.width,
    height: item.height,
    nsfw: item.nsfw ?? item.nsfwLevel ?? false,
    nsfwLevel: item.nsfwLevel,
    meta: item.meta ?? null,
    stats: {
      likeCount: item.stats?.likeCount ?? 0,
      laughCount: item.stats?.laughCount ?? 0,
      heartCount: item.stats?.heartCount ?? 0,
      dislikeCount: item.stats?.dislikeCount ?? 0,
      commentCount: item.stats?.commentCount ?? 0,
    },
    createdAt: item.createdAt,
  }));
}

/**
 * Download an image from URL and return as base64 data URI.
 * Resizes if the image exceeds 4MB (Qwen VL limit).
 */
export async function downloadImageAsBase64(imageUrl: string): Promise<string> {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());

  // If under 4MB, return directly
  if (buffer.length <= 4_000_000) {
    const contentType = res.headers.get("content-type") || "image/jpeg";
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  }

  // Resize large images with sharp
  const sharp = (await import("sharp")).default;
  const resized = await sharp(buffer)
    .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  return `data:image/jpeg;base64,${resized.toString("base64")}`;
}

/**
 * Search across multiple queries, deduplicate results, and return unique images.
 */
export async function searchMultipleQueries(
  queries: string[],
  params: Omit<ImageSearchParams, "query"> = {}
): Promise<CivitAIImageResult[]> {
  const allResults: CivitAIImageResult[] = [];
  const seenIds = new Set<number>();

  for (const query of queries) {
    await rateLimitDelay();
    try {
      const results = await searchCivitAIImages({ ...params, query });
      for (const result of results) {
        if (!seenIds.has(result.id)) {
          seenIds.add(result.id);
          allResults.push(result);
        }
      }
    } catch (err) {
      console.error(`[CivitAI Images] Search failed for query "${query}":`, err);
    }
  }

  return allResults;
}

// ── Part B: Image Generation ──

export interface GenerationParams {
  model: string; // URN: urn:air:sdxl:checkpoint:civitai:133005@357609
  prompt: string;
  negativePrompt?: string;
  scheduler?: string;
  steps?: number;
  cfgScale?: number;
  width?: number;
  height?: number;
  seed?: number;
  clipSkip?: number;
  additionalNetworks?: Record<string, { type: string; strength?: number }>;
  quantity?: number;
}

/**
 * Submit an image generation job to CivitAI.
 * Returns a job token for polling.
 */
export async function generateViaCivitAI(
  params: GenerationParams
): Promise<{ token: string; jobs: unknown[] }> {
  const token = getCivitaiToken();
  const civitai = new Civitai({ auth: token });

  const payload = {
    model: params.model,
    params: {
      prompt: params.prompt,
      negativePrompt: params.negativePrompt || "",
      scheduler: (params.scheduler || "EulerA") as Scheduler,
      steps: params.steps || 30,
      cfgScale: params.cfgScale || 7,
      width: params.width || 832,
      height: params.height || 1216,
      seed: params.seed ?? -1,
      clipSkip: params.clipSkip || 1,
    },
    additionalNetworks: params.additionalNetworks || undefined,
    quantity: params.quantity || 1,
  };

  console.log("[Art Director CivitAI] Submitting generation:", JSON.stringify({
    model: payload.model,
    prompt: payload.params.prompt.slice(0, 100) + "...",
    steps: payload.params.steps,
    cfg: payload.params.cfgScale,
    size: `${payload.params.width}x${payload.params.height}`,
  }));

  const result = await civitai.image.fromText(payload, false);
  const jobResult = result as { token?: string; jobs?: any[] };

  if (!jobResult.token) {
    throw new Error("No job token returned from CivitAI");
  }

  return { token: jobResult.token, jobs: jobResult.jobs || [] };
}

const FAILURE_EVENTS = new Set([
  JobEventType.FAILED,
  JobEventType.REJECTED,
  JobEventType.LATE_REJECTED,
  JobEventType.DELETED,
  JobEventType.EXPIRED,
]);

/**
 * Poll a CivitAI generation job for completion.
 */
export async function pollCivitAIJob(jobToken: string): Promise<{
  status: "pending" | "processing" | "completed" | "failed";
  images?: Array<{ url: string; seed: number; cost: number }>;
  error?: string;
}> {
  const apiToken = getCivitaiToken();
  const civitai = new Civitai({ auth: apiToken });

  const result = await civitai.jobs.getByToken(jobToken);

  if (!result.jobs || result.jobs.length === 0) {
    return { status: "pending" };
  }

  const job = result.jobs[0];

  const resultItems: any[] = Array.isArray(job.result)
    ? job.result
    : job.result
      ? [job.result]
      : [];

  const completedItems = resultItems.filter((r) => r?.blobUrl);
  if (completedItems.length > 0) {
    return {
      status: "completed",
      images: completedItems.map((r) => ({
        url: r.blobUrl as string,
        seed: r.seed ?? -1,
        cost: job.cost ?? 0,
      })),
    };
  }

  const eventType = job.lastEvent?.type;
  if (eventType && FAILURE_EVENTS.has(eventType)) {
    const context = job.lastEvent?.context
      ? JSON.stringify(job.lastEvent.context)
      : "";
    return {
      status: "failed",
      error: `CivitAI generation failed (${eventType}${context ? `: ${context}` : ""})`,
    };
  }

  return { status: "processing" };
}

/**
 * Poll CivitAI job until completion or timeout.
 */
export async function waitForCivitAIJob(
  jobToken: string,
  timeoutMs: number = 300_000, // 5 minutes
  pollIntervalMs: number = 4_000
): Promise<{ url: string; seed: number; cost: number }> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const result = await pollCivitAIJob(jobToken);

    if (result.status === "completed" && result.images && result.images.length > 0) {
      return result.images[0];
    }

    if (result.status === "failed") {
      throw new Error(result.error || "CivitAI generation failed");
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error(`CivitAI generation timed out after ${timeoutMs / 1000}s`);
}

// ── Part C: Metadata Parser ──

/**
 * Parse CivitAI image metadata into a structured recipe.
 */
export function parseImageMetadata(meta: CivitAIImageMeta | null): ParsedRecipe {
  if (!meta) {
    return {
      model: null,
      modelHash: null,
      loras: [],
      prompt: "",
      negativePrompt: "",
      sampler: "EulerA",
      cfgScale: 7,
      steps: 30,
      dimensions: { width: 832, height: 1216 },
      seed: null,
      clipSkip: 1,
    };
  }

  // Extract LoRAs from meta.resources
  const loras: Array<{ name: string; weight: number }> = [];
  if (meta.resources) {
    for (const resource of meta.resources) {
      if (resource.type === "lora") {
        loras.push({
          name: resource.name,
          weight: resource.weight ?? 0.7,
        });
      }
    }
  }

  // Also extract LoRAs from <lora:name:weight> tags in the prompt
  let cleanPrompt = meta.prompt || "";
  const loraTagRegex = /<lora:([^:>]+):([^>]+)>/g;
  let match;
  while ((match = loraTagRegex.exec(cleanPrompt)) !== null) {
    const name = match[1];
    const weight = parseFloat(match[2]) || 0.7;
    // Avoid duplicates
    if (!loras.some((l) => l.name === name)) {
      loras.push({ name, weight });
    }
  }
  // Remove LoRA tags from the prompt
  cleanPrompt = cleanPrompt.replace(/<lora:[^>]+>/g, "").trim();

  // Parse dimensions from Size string ("832x1216")
  let width = 832;
  let height = 1216;
  if (meta.Size) {
    const parts = meta.Size.split("x");
    if (parts.length === 2) {
      width = parseInt(parts[0], 10) || 832;
      height = parseInt(parts[1], 10) || 1216;
    }
  }

  // Normalise sampler names to CivitAI's Scheduler enum
  const samplerMap: Record<string, string> = {
    "Euler a": "EulerA",
    "Euler": "EulerA",
    "DPM++ 2M Karras": "DPM2MKarras",
    "DPM++ 2M SDE Karras": "DPMSDEKarras",
    "DPM++ SDE Karras": "DPMSDEKarras",
    "Heun": "HeunKarras",
    "DDIM": "DDIM",
    "LMS": "LMS",
    "LMS Karras": "LMSKarras",
    "DPM2": "DPM2",
    "DPM2 Karras": "DPM2Karras",
    "DPM2 a Karras": "DPM2AKarras",
    "UniPC": "UniPC",
  };

  const rawSampler = meta.sampler || "Euler a";
  const sampler = samplerMap[rawSampler] || rawSampler;

  return {
    model: meta.Model || null,
    modelHash: meta["Model hash"] || null,
    loras,
    prompt: cleanPrompt,
    negativePrompt: meta.negativePrompt || "",
    sampler,
    cfgScale: typeof meta.cfgScale === "number" ? meta.cfgScale : parseFloat(String(meta.cfgScale ?? "7")) || 7,
    steps: typeof meta.steps === "number" ? meta.steps : parseInt(String(meta.steps ?? "30"), 10) || 30,
    dimensions: { width, height },
    seed: meta.seed != null ? (typeof meta.seed === "number" ? meta.seed : parseInt(String(meta.seed), 10) || null) : null,
    clipSkip: typeof meta["Clip skip"] === "number" ? meta["Clip skip"] : parseInt(String(meta["Clip skip"] ?? "1"), 10) || 1,
  };
}
