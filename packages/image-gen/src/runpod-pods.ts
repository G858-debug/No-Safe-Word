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

// GPU fallback list — try cheapest adequate GPUs first (24GB+ VRAM for SDXL LoRA training)
const TRAINING_GPU_TYPES = [
  'NVIDIA RTX A4000',                 // 16GB — tight but works for dim-8
  'NVIDIA RTX 4000 Ada Generation',   // 20GB
  'NVIDIA GeForce RTX 3090',          // 24GB
  'NVIDIA RTX A4500',                 // 20GB
  'NVIDIA GeForce RTX 4090',          // 24GB
  'NVIDIA L4',                        // 24GB
  'NVIDIA L40',                       // 48GB (overkill but available)
  'NVIDIA L40S',                      // 48GB
];

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
  /** Override the GPU type list (default: TRAINING_GPU_TYPES) */
  gpuTypes?: string[];
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

// ── Pod Operations ──

/**
 * Create a GPU pod for LoRA training.
 * Tries each GPU type in the fallback list until one is available.
 */
export async function createTrainingPod(config: TrainingPodConfig): Promise<{ podId: string }> {
  const gpuTypes = config.gpuTypes || TRAINING_GPU_TYPES;
  const volumeKey = config.volumeKey || process.env.RUNPOD_NETWORK_VOLUME_ID;

  // Build env array for the GraphQL mutation
  const envEntries = Object.entries(config.env)
    .map(([key, value]) => `{ key: "${key}", value: ${JSON.stringify(value)} }`)
    .join(', ');

  for (const gpuType of gpuTypes) {
    try {
      console.log(`[RunPod Pods] Trying ${gpuType}...`);

      const volumeClause = volumeKey
        ? `volumeKey: "${volumeKey}", volumeMountPath: "${config.volumeMountPath || '/workspace'}",`
        : '';

      const data = await runpodGql(`
        mutation {
          podFindAndDeployOnDemand(input: {
            name: "${config.name}"
            imageName: "${config.dockerImage}"
            gpuTypeId: "${gpuType}"
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
      console.log(`[RunPod Pods] Created pod ${pod.id} on ${gpuType}`);
      return { podId: pod.id };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('SUPPLY_CONSTRAINT') || msg.includes('no available')) {
        continue; // Try next GPU type
      }
      throw err; // Unexpected error — don't swallow it
    }
  }

  throw new Error(`No GPU available for training pod. Tried: ${gpuTypes.join(', ')}`);
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
