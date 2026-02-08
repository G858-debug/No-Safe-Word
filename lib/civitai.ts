import type { CharacterData, SceneData, GenerationSettings } from "./types";
import { buildPrompt, buildNegativePrompt } from "./prompt-builder";

const CIVITAI_API_BASE = "https://civitai.com/api/v1";

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
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const apiKey = getApiKey();

  const response = await fetch(`${CIVITAI_API_BASE}${path}`, {
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
  settings: GenerationSettings
): Promise<GenerationResponse> {
  const prompt = buildPrompt(character, scene);
  const negativePrompt = buildNegativePrompt(scene);

  return request<GenerationResponse>("/consumer/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
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
  result: JobResult;
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  return request<JobStatus>(`/consumer/jobs/${jobId}`);
}

// -- Models --

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
  return request<ModelsResponse>(`/models?${params}`);
}
