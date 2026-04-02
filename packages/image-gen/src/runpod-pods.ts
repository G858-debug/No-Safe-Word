/**
 * RunPod Pod API client for batch GPU jobs (LoRA training).
 *
 * Unlike the serverless endpoint in runpod.ts (which runs short inference jobs),
 * pods are full GPU instances that run until explicitly stopped or the entrypoint exits.
 *
 * Patterns extracted from scripts/download-pony-checkpoint.mjs.
 */

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
const GQL_URL = `https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}`;

// Minimum VRAM for SDXL LoRA training (dim-8, batch 2, resolution 1024)
const MIN_TRAINING_VRAM_GB = 24;

// ── Types ──

export interface TrainingPodConfig {
  /** Human-readable pod name (e.g., "kohya-train-lindiwe_nsw-1234567890") */
  name: string;
  /** Docker image to run (e.g., "ghcr.io/g858-debug/nsw-kohya-trainer:latest") */
  dockerImage: string;
  /** Environment variables passed to the container */
  env: Record<string, string>;
  /** RunPod network volume ID for checkpoint access (optional) */
  volumeKey?: string;
  /** Mount path for the network volume (default: /workspace) */
  volumeMountPath?: string;
  /** Minimum VRAM in GB (default: MIN_TRAINING_VRAM_GB) */
  minVramGb?: number;
}

export type PodDesiredStatus = 'CREATED' | 'RUNNING' | 'EXITED' | 'TERMINATED';

export interface PodStatus {
  id: string;
  desiredStatus: PodDesiredStatus;
  uptimeSeconds: number;
  gpuCount: number;
}

// ── GraphQL Helper ──

async function runpodGql(query: string): Promise<Record<string, unknown>> {
  if (!RUNPOD_API_KEY) {
    throw new Error('RUNPOD_API_KEY not set');
  }

  const res = await fetch(GQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    throw new Error(`RunPod GraphQL HTTP ${res.status}: ${res.statusText}`);
  }

  const json = await res.json() as { data?: Record<string, unknown>; errors?: unknown[] };

  if (json.errors) {
    throw new Error(`RunPod GraphQL error: ${JSON.stringify(json.errors)}`);
  }

  return json.data!;
}

// ── GPU Discovery ──

interface GpuOption {
  id: string;
  displayName: string;
  price: number;
}

/**
 * Query RunPod for available GPUs sorted by price (cheapest first).
 * Re-queried each retry round since availability and pricing change frequently.
 */
async function getAvailableGpusSortedByPrice(minVramGb: number = MIN_TRAINING_VRAM_GB): Promise<GpuOption[]> {
  const data = await runpodGql(`{
    gpuTypes {
      id
      displayName
      memoryInGb
      secureCloud
      communityCloud
      lowestPrice {
        uninterruptablePrice
      }
    }
  }`);

  return ((data.gpuTypes || []) as any[])
    .filter(gpu =>
      gpu.memoryInGb >= minVramGb &&
      (gpu.secureCloud || gpu.communityCloud) &&
      gpu.lowestPrice?.uninterruptablePrice != null &&
      gpu.lowestPrice.uninterruptablePrice > 0
    )
    .sort((a, b) =>
      a.lowestPrice.uninterruptablePrice - b.lowestPrice.uninterruptablePrice
    )
    .map(gpu => ({
      id: gpu.id,
      displayName: gpu.displayName,
      price: gpu.lowestPrice.uninterruptablePrice,
    }));
}

// ── Pod Operations ──

/**
 * Create a GPU pod for LoRA training.
 * Dynamically queries RunPod for available GPUs sorted by price each round.
 */
export async function createTrainingPod(config: TrainingPodConfig): Promise<{ podId: string }> {
  const volumeKey = config.volumeKey || process.env.RUNPOD_NETWORK_VOLUME_ID;
  const maxRetries = 5;
  const retryDelayMs = 3 * 60_000; // 3 minutes between retry rounds

  // Build env array for the GraphQL mutation
  const envEntries = Object.entries(config.env)
    .map(([key, value]) => `{ key: "${key}", value: ${JSON.stringify(value)} }`)
    .join(', ');

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Re-query available GPUs each round — prices and availability change
    let gpus: GpuOption[];
    try {
      gpus = await getAvailableGpusSortedByPrice();
      console.log(`[RunPod Pods] Attempt ${attempt}/${maxRetries}: found ${gpus.length} GPU types (cheapest: ${gpus[0]?.displayName} at $${gpus[0]?.price}/hr)`);
    } catch (err) {
      console.error(`[RunPod Pods] Failed to query GPU types:`, err);
      gpus = [];
    }

    if (gpus.length === 0) {
      console.warn(`[RunPod Pods] No GPUs with >= ${MIN_TRAINING_VRAM_GB}GB VRAM listed`);
    }

    for (const gpu of gpus) {
      try {
        console.log(`[RunPod Pods] Trying ${gpu.displayName} ($${gpu.price}/hr)...`);

        const volumeClause = volumeKey
          ? `volumeKey: "${volumeKey}", volumeMountPath: "${config.volumeMountPath || '/workspace'}",`
          : '';

        const data = await runpodGql(`
          mutation {
            podFindAndDeployOnDemand(input: {
              name: "${config.name}"
              imageName: "${config.dockerImage}"
              gpuTypeId: "${gpu.id}"
              cloudType: SECURE
              ${volumeClause}
              startJupyter: false
              startSsh: false
              minMemoryInGb: 16
              minVcpuCount: 4
              containerDiskInGb: 30
              volumeInGb: ${volumeKey ? 0 : 50}
              env: [${envEntries}]
            }) {
              id
              desiredStatus
            }
          }
        `);

        const pod = (data as Record<string, unknown>).podFindAndDeployOnDemand as { id: string; desiredStatus: string };
        console.log(`[RunPod Pods] Created pod ${pod.id} on ${gpu.displayName} at $${gpu.price}/hr (attempt ${attempt})`);
        return { podId: pod.id };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('SUPPLY_CONSTRAINT') || msg.includes('no available')) {
          continue; // Try next GPU type
        }
        throw err; // Unexpected error — don't swallow it
      }
    }

    // All GPUs exhausted for this attempt — wait and retry
    if (attempt < maxRetries) {
      console.log(`[RunPod Pods] No GPUs available (attempt ${attempt}/${maxRetries}). Retrying in ${retryDelayMs / 60_000} minutes...`);
      await new Promise(r => setTimeout(r, retryDelayMs));
    }
  }

  throw new Error(`No GPU available for training pod after ${maxRetries} attempts (~${maxRetries * 3} min)`);
}

/**
 * Get the status of a training pod.
 */
export async function getTrainingPodStatus(podId: string): Promise<PodStatus> {
  const data = await runpodGql(`
    query {
      pod(input: { podId: "${podId}" }) {
        id
        desiredStatus
        runtime {
          uptimeInSeconds
          gpus { id }
        }
      }
    }
  `);

  const pod = (data as Record<string, unknown>).pod as {
    id: string;
    desiredStatus: PodDesiredStatus;
    runtime?: { uptimeInSeconds?: number; gpus?: { id: string }[] };
  };

  return {
    id: pod.id,
    desiredStatus: pod.desiredStatus,
    uptimeSeconds: pod.runtime?.uptimeInSeconds ?? 0,
    gpuCount: pod.runtime?.gpus?.length ?? 0,
  };
}

/**
 * Terminate a training pod (stop and delete).
 */
export async function terminateTrainingPod(podId: string): Promise<void> {
  await runpodGql(`mutation { podTerminate(input: { podId: "${podId}" }) }`);
  console.log(`[RunPod Pods] Terminated pod ${podId}`);
}
