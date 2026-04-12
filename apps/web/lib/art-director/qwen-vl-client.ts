/**
 * Qwen 2.5 VL 72B client — wraps the OpenAI-compatible vLLM API.
 *
 * The model runs on a RunPod pod managed by pod-manager.ts.
 * Endpoint is derived from QWEN_VL_POD_ID env var.
 */

import type { QwenVLConfig, QwenVLImageInput, QwenVLResponse } from "./types";
import { getPodEndpoint, getPodStatus, startPod, createQwenVLPod } from "./pod-manager";

// ── Configuration ──

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes — 72B VL is slow
const DEFAULT_MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 2_000;

export function getQwenVLConfig(): QwenVLConfig {
  const podId = process.env.QWEN_VL_POD_ID;
  if (!podId) {
    throw new Error("QWEN_VL_POD_ID not set — create a pod first via /api/art-director/pod");
  }

  return {
    endpoint: getPodEndpoint(podId),
    apiKey: process.env.QWEN_VL_API_KEY || "EMPTY",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
  };
}

// ── Retry Helper ──

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  config: QwenVLConfig
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) return res;

      // Retryable server errors (vLLM startup, overloaded)
      if ([502, 503, 504].includes(res.status) && attempt < config.maxRetries) {
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(
          `[Qwen VL] ${res.status} on attempt ${attempt}/${config.maxRetries}, retrying in ${delay}ms...`
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      const body = await res.text().catch(() => "");
      throw new Error(`Qwen VL API ${res.status}: ${body.slice(0, 500)}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (lastError.name === "AbortError") {
        lastError = new Error(`Qwen VL request timed out after ${config.timeoutMs}ms`);
      }

      if (attempt < config.maxRetries && !lastError.message.includes("timed out")) {
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(
          `[Qwen VL] Error on attempt ${attempt}/${config.maxRetries}: ${lastError.message}, retrying in ${delay}ms...`
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
    }
  }

  throw lastError ?? new Error("Qwen VL request failed");
}

// ── Chat Completions ──

interface ChatCompletionOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  systemPrompt?: string;
}

async function chatCompletion(
  messages: Array<{ role: string; content: unknown }>,
  options: ChatCompletionOptions = {}
): Promise<QwenVLResponse> {
  const config = getQwenVLConfig();
  const url = `${config.endpoint}/v1/chat/completions`;

  const fullMessages = options.systemPrompt
    ? [{ role: "system", content: options.systemPrompt }, ...messages]
    : messages;

  const body: Record<string, unknown> = {
    model: "Qwen/Qwen2.5-VL-72B-Instruct",
    messages: fullMessages,
    temperature: options.temperature ?? 0.1,
    max_tokens: options.maxTokens ?? 4096,
  };

  if (options.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  }, config);

  const json = await res.json() as {
    choices: Array<{ message: { content: string } }>;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };

  return {
    content: json.choices[0]?.message?.content ?? "",
    usage: json.usage,
  };
}

// ── Public API ──

/**
 * Analyze a single image with a text prompt.
 */
export async function analyzeImage(
  imageUrl: string,
  prompt: string,
  options?: ChatCompletionOptions
): Promise<QwenVLResponse> {
  const content: unknown[] = [
    {
      type: "image_url",
      image_url: { url: imageUrl },
    },
    { type: "text", text: prompt },
  ];

  return chatCompletion(
    [{ role: "user", content }],
    options
  );
}

/**
 * Analyze multiple images in a single turn.
 * Each image can have a label for identification.
 */
export async function analyzeMultipleImages(
  images: QwenVLImageInput[],
  prompt: string,
  options?: ChatCompletionOptions
): Promise<QwenVLResponse> {
  const content: unknown[] = [];

  for (const img of images) {
    if (img.label) {
      content.push({ type: "text", text: `[${img.label}]` });
    }
    content.push({
      type: "image_url",
      image_url: { url: img.url },
    });
  }

  content.push({ type: "text", text: prompt });

  return chatCompletion(
    [{ role: "user", content }],
    options
  );
}

/**
 * Text-only chat (no images). Used for prompt analysis.
 */
export async function analyzeText(
  prompt: string,
  options?: ChatCompletionOptions
): Promise<QwenVLResponse> {
  return chatCompletion(
    [{ role: "user", content: prompt }],
    options
  );
}

/**
 * Check if the vLLM server is up and the model is loaded.
 */
export async function healthCheck(): Promise<{
  status: "ok" | "unreachable" | "loading";
  modelLoaded: boolean;
}> {
  try {
    const config = getQwenVLConfig();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(`${config.endpoint}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      return { status: "ok", modelLoaded: true };
    }

    // vLLM returns 503 while model is loading
    if (res.status === 503) {
      return { status: "loading", modelLoaded: false };
    }

    return { status: "unreachable", modelLoaded: false };
  } catch {
    return { status: "unreachable", modelLoaded: false };
  }
}

/**
 * Ensure the Qwen VL pod is running. Creates or starts it if needed.
 * Returns the pod endpoint URL.
 */
export async function ensurePodRunning(): Promise<string> {
  const podId = process.env.QWEN_VL_POD_ID;

  if (!podId) {
    console.log("[Qwen VL] No pod ID set — creating new pod...");
    const { podId: newPodId, endpoint } = await createQwenVLPod();
    console.log(`[Qwen VL] Created pod ${newPodId}. Set QWEN_VL_POD_ID=${newPodId} in .env.local`);
    return endpoint;
  }

  try {
    const status = await getPodStatus(podId);

    if (status.running) {
      return getPodEndpoint(podId);
    }

    if (status.desiredStatus === "EXITED") {
      console.log(`[Qwen VL] Pod ${podId} is stopped — resuming...`);
      await startPod(podId);
      return getPodEndpoint(podId);
    }

    // Pod might be starting up
    if (status.desiredStatus === "RUNNING" || status.desiredStatus === "CREATED") {
      console.log(`[Qwen VL] Pod ${podId} is starting up (status: ${status.desiredStatus})...`);
      return getPodEndpoint(podId);
    }

    // Terminated or unknown — create a new one
    console.log(`[Qwen VL] Pod ${podId} is ${status.desiredStatus} — creating new pod...`);
    const { endpoint } = await createQwenVLPod();
    return endpoint;
  } catch (err) {
    console.error(`[Qwen VL] Error checking pod ${podId}:`, err);
    throw err;
  }
}

/**
 * Parse JSON from a Qwen VL response, stripping markdown fences if present.
 * Throws a descriptive error with the raw text if parsing fails.
 */
export function parseJsonResponse<T>(response: QwenVLResponse, label?: string): T {
  let text = response.content.trim();

  // Strip markdown code fences
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
  }

  try {
    return JSON.parse(text) as T;
  } catch (err) {
    const preview = text.slice(0, 500);
    const step = label ? ` (${label})` : "";
    throw new Error(
      `Failed to parse Qwen VL JSON response${step}: ${err instanceof Error ? err.message : "parse error"}. Raw text: ${preview}`
    );
  }
}
