/**
 * Singleton Siray.ai client.
 *
 * Replaces the Replicate client for HunyuanImage 3.0 generation. Siray.ai
 * exposes an async two-step API: POST to submit a job (returns a task_id),
 * then GET to poll until status === "completed".
 *
 * Reads SIRAY_API_KEY from the environment. No safety/content-filter
 * parameters are sent — by deliberate design.
 */

const SIRAY_BASE_URL = "https://api.siray.ai/v1";
const POLL_INTERVAL_MS = 3_000;
// HunyuanImage 3.0 on Siray typically returns in 30s–3min, but queue
// spikes have been observed pushing it past 6min. 10min is generous
// enough to absorb that without surfacing spurious timeout failures.
const DEFAULT_MAX_WAIT_MS = 600_000;

export type SirayModelId =
  | "tencent/hunyuan-image-3-instruct-t2i"
  | "tencent/hunyuan-image-3-instruct-i2i";

export interface SirayJobPayload {
  model: SirayModelId;
  prompt: string;
  size: string;
  seed?: number;
  /** Only present for i2i. MUST be omitted entirely for t2i. */
  images?: string[];
}

/**
 * Siray's async-job poll response. The API wraps the actual job state in
 * a `data` envelope and uses uppercase status values:
 *   IN_PROGRESS → SUCCESS (or FAILED)
 *
 * `fail_reason` is observed to contain a URL even on success — only read
 * it when status is FAILED.
 */
export interface SirayPollResponse {
  code: string | number;
  message: string;
  data: SirayJobState;
}

export interface SirayJobState {
  task_id: string;
  action?: string;
  status: string;
  outputs?: string[];
  fail_reason?: string;
  progress?: string;
  submit_time?: number;
  start_time?: number;
  finish_time?: number;
}

/**
 * Submit-response shape — the API duplicates `task_id` at the root and
 * inside `data`. We accept either.
 */
interface SiraySubmitResponse {
  code: string | number;
  message: string;
  task_id?: string;
  data?: { task_id?: string };
}

interface SirayClient {
  submitJob: (payload: SirayJobPayload) => Promise<string>;
  pollForResult: (taskId: string, maxWaitMs?: number) => Promise<string>;
}

let _client: SirayClient | null = null;

export function getSirayClient(): SirayClient {
  if (_client) return _client;

  const apiKey = process.env.SIRAY_API_KEY;
  if (!apiKey) {
    throw new Error("SIRAY_API_KEY is not set");
  }

  _client = {
    submitJob: (payload) => submitJob(apiKey, payload),
    pollForResult: (taskId, maxWaitMs) =>
      pollForResult(apiKey, taskId, maxWaitMs ?? DEFAULT_MAX_WAIT_MS),
  };

  return _client;
}

async function submitJob(
  apiKey: string,
  payload: SirayJobPayload
): Promise<string> {
  const res = await fetch(`${SIRAY_BASE_URL}/images/generations/async`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await safeReadText(res);
    throw new Error(
      `[siray] submit failed: HTTP ${res.status} ${res.statusText} — ${body}`
    );
  }

  const body = (await res.json()) as SiraySubmitResponse;
  const taskId = body.task_id ?? body.data?.task_id;
  if (!taskId || typeof taskId !== "string") {
    throw new Error(
      `[siray] submit returned no task_id (response: ${safeStringify(body)})`
    );
  }

  console.log(`[siray] submitted task_id=${taskId}`);
  return taskId;
}

async function pollForResult(
  apiKey: string,
  taskId: string,
  maxWaitMs: number
): Promise<string> {
  const startedAt = Date.now();
  let lastProgress: string | undefined;

  while (Date.now() - startedAt < maxWaitMs) {
    const res = await fetch(
      `${SIRAY_BASE_URL}/images/generations/async/${taskId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    if (!res.ok) {
      const body = await safeReadText(res);
      throw new Error(
        `[siray] poll failed for task ${taskId}: HTTP ${res.status} ${res.statusText} — ${body}`
      );
    }

    const body = (await res.json()) as SirayPollResponse;
    const job = body.data;
    if (!job) {
      throw new Error(
        `[siray] poll for task ${taskId} returned no data envelope (response: ${safeStringify(body)})`
      );
    }

    if (job.progress && job.progress !== lastProgress) {
      console.log(`[siray] task ${taskId} progress=${job.progress}`);
      lastProgress = job.progress;
    }

    // Siray uses uppercase status strings. Normalize to be tolerant of
    // future case changes; treat both SUCCESS and COMPLETED as terminal.
    const status = (job.status ?? "").toUpperCase();
    if (status === "SUCCESS" || status === "COMPLETED") {
      const url = job.outputs?.[0];
      if (!url) {
        throw new Error(
          `[siray] task ${taskId} succeeded with no outputs (response: ${safeStringify(body)})`
        );
      }
      return url;
    }

    if (status === "FAILED" || status === "FAILURE" || status === "ERROR") {
      throw new Error(
        `[siray] task ${taskId} failed: ${job.fail_reason ?? "unknown reason"}`
      );
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`[siray] timeout after ${maxWaitMs}ms for task ${taskId}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<unreadable body>";
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
