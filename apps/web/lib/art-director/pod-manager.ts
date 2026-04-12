/**
 * RunPod pod lifecycle management for the Qwen 2.5 VL 72B inference pod.
 *
 * Mirrors the GraphQL pattern from packages/image-gen/src/runpod-pods.ts
 * but adapted for a persistent inference pod (start/stop) rather than
 * one-shot training pods (create/terminate).
 */

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
const GQL_URL = `https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}`;

// vLLM Docker image with OpenAI-compatible API
const VLLM_DOCKER_IMAGE = "vllm/vllm-openai:latest";

// Qwen 2.5 VL 72B needs ~75 GB VRAM in FP16
const QWEN_MODEL_ID = "Qwen/Qwen2.5-VL-72B-Instruct";
const REQUIRED_VRAM_GB = 80;

// GPU allow-list — only A100 80GB variants have enough VRAM
const ALLOWED_GPU_IDS = [
  "NVIDIA A100 80GB PCIe",
  "NVIDIA A100-SXM4-80GB",
];

// ── GraphQL Helper ──

async function runpodGql(query: string, timeoutMs: number = 15_000): Promise<Record<string, unknown>> {
  if (!RUNPOD_API_KEY) {
    throw new Error("RUNPOD_API_KEY not set");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const res = await fetch(GQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!res.ok) {
    throw new Error(`RunPod GraphQL HTTP ${res.status}: ${res.statusText}`);
  }

  const json = (await res.json()) as {
    data?: Record<string, unknown>;
    errors?: unknown[];
  };

  if (json.errors) {
    throw new Error(`RunPod GraphQL error: ${JSON.stringify(json.errors)}`);
  }

  return json.data!;
}

// ── Pod Endpoint URL ──

export function getPodEndpoint(podId: string): string {
  return `https://${podId}-8000.proxy.runpod.net`;
}

// ── Pod Operations ──

export interface PodInfo {
  id: string;
  desiredStatus: string;
  running: boolean;
  endpoint: string | null;
  uptimeSeconds: number;
  gpuDisplayName: string | null;
}

/**
 * Create a new RunPod pod for Qwen 2.5 VL 72B inference via vLLM.
 */
export async function createQwenVLPod(): Promise<{ podId: string; endpoint: string }> {
  const cloudTypes = ["SECURE", "COMMUNITY"] as const;

  for (const cloudType of cloudTypes) {
    for (const gpuId of ALLOWED_GPU_IDS) {
      try {
        console.log(`[Art Director Pod] Trying ${gpuId} on ${cloudType}...`);

        // Use the existing network volume for persistent HF model cache
        const networkVolumeId = process.env.RUNPOD_NETWORK_VOLUME_ID || "";
        const volumeClause = networkVolumeId
          ? `volumeKey: "${networkVolumeId}", volumeMountPath: "/runpod-volume",`
          : `volumeInGb: 150,`;

        const data = await runpodGql(`
          mutation {
            podFindAndDeployOnDemand(input: {
              name: "qwen-vl-72b-art-director"
              imageName: "${VLLM_DOCKER_IMAGE}"
              gpuTypeId: "${gpuId}"
              gpuCount: 1
              cloudType: ${cloudType}
              startJupyter: false
              startSsh: false
              containerDiskInGb: 150
              ${volumeClause}
              dockerArgs: "--model ${QWEN_MODEL_ID} --max-model-len 32768 --tensor-parallel-size 1 --trust-remote-code --dtype auto --gpu-memory-utilization 0.95"
              ports: "8000/http"
              env: [
                { key: "HUGGING_FACE_HUB_TOKEN", value: "${process.env.HUGGINGFACE_TOKEN || ""}" }
                { key: "HF_HOME", value: "/runpod-volume/huggingface" }
              ]
            }) {
              id
              desiredStatus
            }
          }
        `);

        const pod = (data as Record<string, unknown>)
          .podFindAndDeployOnDemand as { id: string; desiredStatus: string };

        console.log(
          `[Art Director Pod] Created pod ${pod.id} on ${gpuId} (${cloudType})`
        );

        return { podId: pod.id, endpoint: getPodEndpoint(pod.id) };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes("SUPPLY_CONSTRAINT") ||
          msg.includes("no available")
        ) {
          continue;
        }
        throw err;
      }
    }
  }

  throw new Error(
    `No A100 80GB GPU available for Qwen VL pod on SECURE or COMMUNITY clouds`
  );
}

/**
 * Get the current status of the Qwen VL pod.
 */
export async function getPodStatus(podId: string): Promise<PodInfo> {
  const data = await runpodGql(`
    query {
      pod(input: { podId: "${podId}" }) {
        id
        desiredStatus
        runtime {
          uptimeInSeconds
          gpus {
            id
          }
          ports {
            ip
            isIpPublic
            privatePort
            publicPort
            type
          }
        }
        machine {
          gpuDisplayName
        }
      }
    }
  `);

  const pod = (data as Record<string, unknown>).pod as {
    id: string;
    desiredStatus: string;
    runtime?: {
      uptimeInSeconds?: number;
      gpus?: { id: string }[];
      ports?: { privatePort: number; publicPort: number }[];
    };
    machine?: { gpuDisplayName?: string };
  };

  if (!pod) {
    throw new Error(`Pod ${podId} not found`);
  }

  // Pod is running if desiredStatus is RUNNING — uptime may still be 0 during startup
  const running = pod.desiredStatus === "RUNNING";

  return {
    id: pod.id,
    desiredStatus: pod.desiredStatus,
    running,
    endpoint: running ? getPodEndpoint(pod.id) : null,
    uptimeSeconds: pod.runtime?.uptimeInSeconds ?? 0,
    gpuDisplayName: pod.machine?.gpuDisplayName ?? null,
  };
}

/**
 * Resume a stopped pod (preserves disk, fast restart).
 */
export async function startPod(podId: string): Promise<void> {
  await runpodGql(`
    mutation {
      podResume(input: { podId: "${podId}", gpuCount: 1 }) {
        id
        desiredStatus
      }
    }
  `);
  console.log(`[Art Director Pod] Resumed pod ${podId}`);
}

/**
 * Stop the pod (preserves disk, stops billing for GPU).
 */
export async function stopPod(podId: string): Promise<void> {
  await runpodGql(`
    mutation {
      podStop(input: { podId: "${podId}" }) {
        id
        desiredStatus
      }
    }
  `);
  console.log(`[Art Director Pod] Stopped pod ${podId}`);
}

/**
 * Terminate the pod (deletes it entirely).
 */
export async function terminatePod(podId: string): Promise<void> {
  await runpodGql(
    `mutation { podTerminate(input: { podId: "${podId}" }) }`
  );
  console.log(`[Art Director Pod] Terminated pod ${podId}`);
}
