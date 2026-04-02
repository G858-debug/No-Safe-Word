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

// Fallback GPU list in case the dynamic query fails
const FALLBACK_GPU_TYPES: GpuOption[] = [
  { id: 'NVIDIA GeForce RTX 3090', displayName: 'RTX 3090', price: 0 },
  { id: 'NVIDIA RTX A4500', displayName: 'RTX A4500', price: 0 },
  { id: 'NVIDIA GeForce RTX 4090', displayName: 'RTX 4090', price: 0 },
  { id: 'NVIDIA L4', displayName: 'L4', price: 0 },
  { id: 'NVIDIA RTX 4000 Ada Generation', displayName: 'RTX 4000 Ada', price: 0 },
  { id: 'NVIDIA L40', displayName: 'L40', price: 0 },
  { id: 'NVIDIA L40S', displayName: 'L40S', price: 0 },
  { id: 'NVIDIA RTX A6000', displayName: 'RTX A6000', price: 0 },
];

/**
 * Query RunPod for available GPUs sorted by price (cheapest first).
 * Falls back to a hardcoded list if the API query fails (e.g. lowestPrice errors).
 */
async function getAvailableGpusSortedByPrice(minVramGb: number = MIN_TRAINING_VRAM_GB): Promise<GpuOption[]> {
  try {
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

    const gpus = ((data.gpuTypes || []) as any[])
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

    if (gpus.length > 0) return gpus;
  } catch (err) {
    console.warn(`[RunPod Pods] Dynamic GPU query failed, using fallback list:`, err instanceof Error ? err.message : err);
  }

  // Fallback: try without lowestPrice (just filter by VRAM)
  try {
    const data = await runpodGql(`{
      gpuTypes {
        id
        displayName
        memoryInGb
        secureCloud
      }
    }`);

    const gpus = ((data.gpuTypes || []) as any[])
      .filter(gpu => gpu.memoryInGb >= minVramGb && gpu.secureCloud)
      .map(gpu => ({
        id: gpu.id,
        displayName: gpu.displayName,
        price: 0,
      }));

    if (gpus.length > 0) return gpus;
  } catch {
    console.warn(`[RunPod Pods] Fallback GPU query also failed, using hardcoded list`);
  }

  return FALLBACK_GPU_TYPES;
}

// ── Pod Operations ──

/**
 * Create a GPU pod for LoRA training.
 * Dynamically queries RunPod for available GPUs sorted by price each round.
 */
export async function createTrainingPod(config: TrainingPodConfig): Promise<{ podId: string }> {
  const volumeKey = config.volumeKey;
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
      const cheapest = gpus[0];
      console.log(`[RunPod Pods] Attempt ${attempt}/${maxRetries}: found ${gpus.length} GPU types (first: ${cheapest?.displayName}${cheapest?.price ? ` at $${cheapest.price}/hr` : ''})`);
    } catch (err) {
      console.error(`[RunPod Pods] Failed to query GPU types:`, err);
      gpus = [];
    }

    if (gpus.length === 0) {
      console.warn(`[RunPod Pods] No GPUs with >= ${MIN_TRAINING_VRAM_GB}GB VRAM listed`);
    }

    const cloudTypes = ['SECURE', 'COMMUNITY'] as const;
    for (const cloudType of cloudTypes) {
      for (const gpu of gpus) {
        try {
          console.log(`[RunPod Pods] Trying ${gpu.displayName} on ${cloudType}${gpu.price ? ` ($${gpu.price}/hr)` : ''}...`);

          const volumeClause = volumeKey
            ? `volumeKey: "${volumeKey}", volumeMountPath: "${config.volumeMountPath || '/workspace'}",`
            : '';

          const data = await runpodGql(`
            mutation {
              podFindAndDeployOnDemand(input: {
                name: "${config.name}"
                imageName: "${config.dockerImage}"
                gpuTypeId: "${gpu.id}"
                cloudType: ${cloudType}
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
          console.log(`[RunPod Pods] Created pod ${pod.id} on ${gpu.displayName} ${cloudType}${gpu.price ? ` at $${gpu.price}/hr` : ''} (attempt ${attempt})`);
          return { podId: pod.id };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('SUPPLY_CONSTRAINT') || msg.includes('no available')) {
            continue; // Try next GPU type
          }
          throw err; // Unexpected error — don't swallow it
        }
      }
    }

    // All GPUs exhausted for this attempt — wait and retry
    if (attempt < maxRetries) {
      console.log(`[RunPod Pods] No GPUs available (attempt ${attempt}/${maxRetries}). Retrying in ${retryDelayMs / 60_000} minutes...`);
      await new Promise(r => setTimeout(r, retryDelayMs));
    }
  }

  throw new Error(`No GPU available for training pod after ${maxRetries} attempts (~${maxRetries * 3} min) on SECURE + COMMUNITY clouds`);
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
