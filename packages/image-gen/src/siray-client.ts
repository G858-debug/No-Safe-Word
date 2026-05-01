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

/** Result of a single one-shot Siray poll. */
export interface SirayJobStatus {
  /** Normalized state — `pending` while in-flight, `completed` on SUCCESS, `failed` on FAILED. */
  state: "pending" | "completed" | "failed";
  /** Output image URL (Siray CDN, single-use rotating token). Present iff state === "completed". */
  imageUrl?: string;
  /** Failure reason from Siray. Present iff state === "failed". */
  failReason?: string;
  /** Optional progress string like "30%" for UI. */
  progress?: string;
  /** Raw upstream status string ("IN_PROGRESS" | "SUCCESS" | "FAILED" | …). */
  rawStatus: string;
}

interface SirayClient {
  submitJob: (payload: SirayJobPayload) => Promise<string>;
  pollForResult: (taskId: string, maxWaitMs?: number) => Promise<string>;
  /** One-shot poll — returns the current job state without looping. */
  getJobStatus: (taskId: string) => Promise<SirayJobStatus>;
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
    getJobStatus: (taskId) => getJobStatus(apiKey, taskId),
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

/**
 * One-shot poll. Reads the upstream `data` envelope, normalises the status
 * to one of {pending, completed, failed}, and surfaces the output URL or
 * failure reason as appropriate. Used by both the looping `pollForResult`
 * and the async status handler that runs per browser-poll.
 */
async function getJobStatus(apiKey: string, taskId: string): Promise<SirayJobStatus> {
  const res = await fetch(
    `${SIRAY_BASE_URL}/images/generations/async/${taskId}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
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

  // Siray uses uppercase status strings. Tolerate case + alternate spellings
  // so a server-side rename doesn't silently break our state machine.
  const rawStatus = job.status ?? "";
  const upper = rawStatus.toUpperCase();

  if (upper === "SUCCESS" || upper === "COMPLETED") {
    const url = job.outputs?.[0];
    if (!url) {
      throw new Error(
        `[siray] task ${taskId} succeeded with no outputs (response: ${safeStringify(body)})`
      );
    }
    return { state: "completed", imageUrl: url, progress: job.progress, rawStatus };
  }

  if (upper === "FAILED" || upper === "FAILURE" || upper === "ERROR") {
    return {
      state: "failed",
      failReason: job.fail_reason ?? "unknown reason",
      progress: job.progress,
      rawStatus,
    };
  }

  return { state: "pending", progress: job.progress, rawStatus };
}

async function pollForResult(
  apiKey: string,
  taskId: string,
  maxWaitMs: number
): Promise<string> {
  const startedAt = Date.now();
  let lastProgress: string | undefined;

  while (Date.now() - startedAt < maxWaitMs) {
    const status = await getJobStatus(apiKey, taskId);

    if (status.progress && status.progress !== lastProgress) {
      console.log(`[siray] task ${taskId} progress=${status.progress}`);
      lastProgress = status.progress;
    }

    if (status.state === "completed") return status.imageUrl!;
    if (status.state === "failed") {
      throw new Error(`[siray] task ${taskId} failed: ${status.failReason ?? "unknown reason"}`);
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
