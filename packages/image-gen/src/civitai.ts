import type { CharacterData, SceneData, GenerationSettings } from "@no-safe-word/shared";
import { buildPrompt, buildNegativePrompt } from "./prompt-builder";

// Generation/job endpoints live on the orchestration host
const ORCHESTRATION_BASE = "https://orchestration.civitai.com/v1";
// Model browsing endpoints live on the public REST API
const REST_BASE = "https://civitai.com/api/v1";

export class CivitaiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: string
  ) {
    super(message);
    this.name = "CivitaiError";
  }
}

function getApiKey(): string {
  const key = process.env.CIVITAI_API_KEY;
  if (!key) {
    throw new CivitaiError("CIVITAI_API_KEY is not configured", 500);
  }
  return key;
}

async function request<T>(
  baseUrl: string,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const apiKey = getApiKey();

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new CivitaiError(
      `Civitai API error: ${response.status} ${response.statusText}`,
      response.status,
      body
    );
  }

  return response.json();
}

// -- Generation --

export interface GenerationJob {
  jobId: string;
  cost: number;
  scheduled: boolean;
}

export interface GenerationResponse {
  token: string;
  jobs: GenerationJob[];
}

export async function submitGeneration(
  character: CharacterData,
  scene: SceneData,
  settings: GenerationSettings,
  overrides?: { prompt?: string; negativePrompt?: string }
): Promise<GenerationResponse> {
  const prompt = overrides?.prompt || buildPrompt(character, scene);
  const negativePrompt = overrides?.negativePrompt || buildNegativePrompt(scene);

  return request<GenerationResponse>(ORCHESTRATION_BASE, "/consumer/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      $type: "textToImage",
      model: settings.modelUrn,
      params: {
        prompt,
        negativePrompt,
        scheduler: settings.scheduler,
        steps: settings.steps,
        cfgScale: settings.cfgScale,
        width: settings.width,
        height: settings.height,
        seed: settings.seed,
        clipSkip: settings.clipSkip,
      },
      quantity: settings.batchSize,
    }),
  });
}

// -- Job Status --

export interface JobResult {
  blobKey: string;
  available: boolean;
  blobUrl?: string;
  blobUrlExpirationDate?: string;
}

export interface JobStatus {
  jobId: string;
  cost: number;
  scheduled: boolean;
  result: JobResult[];
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  return request<JobStatus>(ORCHESTRATION_BASE, `/consumer/jobs/${jobId}`, {
    cache: 'no-store',
  });
}

// -- Models (public REST API) --

export interface CivitaiModel {
  id: number;
  name: string;
  type: string;
  nsfw: boolean;
}

export interface ModelsResponse {
  items: CivitaiModel[];
  metadata: {
    totalItems: number;
    currentPage: number;
    pageSize: number;
  };
}

export async function searchModels(
  query?: string,
  limit = 10
): Promise<ModelsResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query) params.set("query", query);
  return request<ModelsResponse>(REST_BASE, `/models?${params}`);
}
