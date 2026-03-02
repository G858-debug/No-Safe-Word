const RUNPOD_API_BASE = 'https://api.runpod.ai/v2';

interface RunPodImage {
  name: string;
  image: string; // base64 encoded, with or without data URI prefix
}

/** Character LoRA download instruction for the RunPod worker */
export interface CharacterLoraDownload {
  filename: string; // e.g. "characters/char_zanele_abc123.safetensors"
  url: string;      // Supabase Storage URL to download from
}

interface RunPodRequest {
  input: {
    workflow: Record<string, any>;
    images?: RunPodImage[];
    /** Character LoRAs to download before workflow execution */
    character_lora_downloads?: CharacterLoraDownload[];
  };
}

interface RunPodImageOutput {
  filename: string;
  type: 'base64' | 's3_url';
  data: string;
}

interface RunPodResponse {
  id: string;
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT';
  output?: {
    images?: RunPodImageOutput[];
  };
  error?: string;
  delayTime?: number;
  executionTime?: number;
}

/**
 * Submit a workflow to RunPod asynchronously (returns job ID immediately).
 * Use for batch generation where we don't need to wait.
 */
export async function submitRunPodJob(
  workflow: Record<string, any>,
  images?: RunPodImage[],
  characterLoraDownloads?: CharacterLoraDownload[]
): Promise<{ jobId: string }> {
  const endpointId = process.env.RUNPOD_ENDPOINT_ID;
  const apiKey = process.env.RUNPOD_API_KEY;

  if (!endpointId || !apiKey) {
    throw new Error('Missing RUNPOD_ENDPOINT_ID or RUNPOD_API_KEY environment variables');
  }

  const payload: RunPodRequest = {
    input: {
      workflow,
      ...(images && images.length > 0 ? { images } : {}),
      ...(characterLoraDownloads && characterLoraDownloads.length > 0 ? { character_lora_downloads: characterLoraDownloads } : {}),
    },
  };

  const response = await fetch(`${RUNPOD_API_BASE}/${endpointId}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`RunPod API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return { jobId: data.id };
}

/**
 * Check the status of a RunPod job.
 */
export async function getRunPodJobStatus(jobId: string): Promise<RunPodResponse> {
  const endpointId = process.env.RUNPOD_ENDPOINT_ID;
  const apiKey = process.env.RUNPOD_API_KEY;

  if (!endpointId || !apiKey) {
    throw new Error('Missing RUNPOD_ENDPOINT_ID or RUNPOD_API_KEY environment variables');
  }

  const response = await fetch(`${RUNPOD_API_BASE}/${endpointId}/status/${jobId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`RunPod status check failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Submit a workflow synchronously (waits for completion, up to 120s).
 * Use for single image generation or character portraits.
 * Returns the base64 image data directly.
 */
export async function submitRunPodSync(
  workflow: Record<string, any>,
  images?: RunPodImage[],
  characterLoraDownloads?: CharacterLoraDownload[]
): Promise<{ imageBase64: string; executionTime: number }> {
  const endpointId = process.env.RUNPOD_ENDPOINT_ID;
  const apiKey = process.env.RUNPOD_API_KEY;

  if (!endpointId || !apiKey) {
    throw new Error('Missing RUNPOD_ENDPOINT_ID or RUNPOD_API_KEY environment variables');
  }

  const payload: RunPodRequest = {
    input: {
      workflow,
      ...(images && images.length > 0 ? { images } : {}),
      ...(characterLoraDownloads && characterLoraDownloads.length > 0 ? { character_lora_downloads: characterLoraDownloads } : {}),
    },
  };

  const response = await fetch(`${RUNPOD_API_BASE}/${endpointId}/runsync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`RunPod sync request failed (${response.status}): ${errorText}`);
  }

  const data: RunPodResponse = await response.json();

  if (data.status === 'FAILED') {
    throw new Error(`RunPod job failed: ${data.error || 'Unknown error'}`);
  }

  if (data.status === 'TIMED_OUT') {
    throw new Error('RunPod job timed out — try using async /run endpoint instead');
  }

  if (data.status !== 'COMPLETED' || !data.output?.images?.[0]) {
    throw new Error(`RunPod unexpected response: status=${data.status}`);
  }

  const imageData = data.output.images[0].data;
  // Strip data URI prefix if present
  const base64Data = imageData.includes(',') ? imageData.split(',')[1] : imageData;

  return {
    imageBase64: base64Data,
    executionTime: data.executionTime || 0,
  };
}

/**
 * Poll a RunPod job until completion or timeout.
 * @param jobId - The RunPod job ID
 * @param timeoutMs - Maximum time to wait (default 5 minutes)
 * @param pollIntervalMs - Time between status checks (default 2 seconds)
 */
export async function waitForRunPodResult(
  jobId: string,
  timeoutMs: number = 300000,
  pollIntervalMs: number = 2000
): Promise<{ imageBase64: string; executionTime: number }> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const status = await getRunPodJobStatus(jobId);

    if (status.status === 'COMPLETED') {
      if (!status.output?.images?.[0]) {
        throw new Error('RunPod job completed but no images returned');
      }
      const imageData = status.output.images[0].data;
      const base64Data = imageData.includes(',') ? imageData.split(',')[1] : imageData;
      return {
        imageBase64: base64Data,
        executionTime: status.executionTime || 0,
      };
    }

    if (status.status === 'FAILED') {
      throw new Error(`RunPod job failed: ${status.error || 'Unknown error'}`);
    }

    if (status.status === 'CANCELLED') {
      throw new Error('RunPod job was cancelled');
    }

    if (status.status === 'TIMED_OUT') {
      throw new Error('RunPod job timed out on the worker');
    }

    // Still IN_QUEUE or IN_PROGRESS — wait and poll again
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Timed out waiting for RunPod job ${jobId} after ${timeoutMs}ms`);
}

/**
 * Convert a Supabase image URL or buffer to base64 for RunPod input.
 */
export async function imageUrlToBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image from ${url}: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

/**
 * Convert base64 image data to a Buffer for Supabase storage upload.
 */
export function base64ToBuffer(base64: string): Buffer {
  return Buffer.from(base64, 'base64');
}
