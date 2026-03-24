// Stage 4: LoRA Training via Replicate API
// Creates a ZIP of images + captions, uploads to Supabase,
// then kicks off LoRA training on Replicate using ostris/flux-dev-lora-trainer.

import Replicate from 'replicate';
import archiver from 'archiver';
import sharp from 'sharp';
import { PassThrough } from 'stream';
import type { CaptionResult, TrainingParams, TrainingResult } from './types';
import { DEFAULT_TRAINING_PARAMS, PIPELINE_CONFIG } from './types';

// Replicate training model — Flux trainer (matches LoRA Studio)
const LORA_TRAINING_OWNER = 'ostris';
const LORA_TRAINING_MODEL = 'flux-dev-lora-trainer';

/**
 * Thrown when dataset ZIP preparation fails (e.g. image download 400/404).
 * This is NOT a training failure — retrying with different training params
 * won't help. The pipeline should surface this immediately without
 * incrementing training_attempts.
 */
export class DatasetPreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatasetPreparationError';
  }
}

async function getFluxTrainerVersion(): Promise<string> {
  const resp = await fetch(
    `https://api.replicate.com/v1/models/${LORA_TRAINING_OWNER}/${LORA_TRAINING_MODEL}`,
    { headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` } },
  );
  if (!resp.ok) throw new Error(`Could not fetch flux trainer model: ${resp.status}`);
  const data = await resp.json();
  const version = data.latest_version?.id as string | undefined;
  if (!version) throw new Error('No latest_version found for flux-dev-lora-trainer');
  return version;
}

interface TrainerDeps {
  supabase: {
    from: (table: string) => any;
    storage: { from: (bucket: string) => any };
  };
}

/**
 * Train a character LoRA on Replicate.
 *
 * 1. Creates a ZIP of images + matching .txt caption files
 * 2. Uploads ZIP to Supabase Storage
 * 3. Starts training on Replicate
 * 4. Polls until complete
 * 5. Downloads the trained .safetensors file
 */
export async function trainLora(
  captionedImages: CaptionResult['captionedImages'],
  characterSlug: string,
  loraId: string,
  attempt: number,
  deps: TrainerDeps,
  paramsOverrides?: Partial<TrainingParams>,
  existingZipUrl?: string,
): Promise<TrainingResult> {
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

  if (!process.env.REPLICATE_API_TOKEN) {
    throw new Error('Missing REPLICATE_API_TOKEN environment variable');
  }

  const params = { ...DEFAULT_TRAINING_PARAMS, ...paramsOverrides };

  console.log(
    `[LoRA Train] Starting training for ${characterSlug} (attempt ${attempt}, ${captionedImages.length} images)...`
  );

  let zipUrl: string;

  if (existingZipUrl) {
    // Reuse existing ZIP from a previous run
    zipUrl = existingZipUrl;
    console.log(`[LoRA Train] Reusing existing ZIP: ${zipUrl}`);
  } else {
    // Step 1: Create ZIP of images + captions
    // Wrap in DatasetPreparationError so the pipeline doesn't count
    // image download failures as training attempts.
    let zipBuffer: Buffer;
    try {
      zipBuffer = await createTrainingZip(captionedImages);
    } catch (err) {
      throw new DatasetPreparationError(
        `ZIP creation failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    console.log(`[LoRA Train] ZIP created: ${(zipBuffer.length / 1024 / 1024).toFixed(1)}MB`);

    // Step 2: Upload ZIP to Supabase Storage
    const zipPath = `character-loras/training/${loraId}/dataset_attempt${attempt}.zip`;
    const { error: uploadError } = await deps.supabase.storage
      .from('story-images')
      .upload(zipPath, zipBuffer, {
        contentType: 'application/zip',
        upsert: true,
      });

    if (uploadError) {
      throw new DatasetPreparationError(`Failed to upload training ZIP: ${uploadError.message}`);
    }

    const { data: urlData } = deps.supabase.storage
      .from('story-images')
      .getPublicUrl(zipPath);

    zipUrl = urlData.publicUrl;
    console.log(`[LoRA Train] ZIP uploaded to: ${zipPath}`);
  }

  // Step 3: Create destination model on Replicate (if needed) and start training
  const replicateOwner = await getReplicateUsername(replicate);
  const destModel = `lora-${characterSlug}`;
  const destination = `${replicateOwner}/${destModel}` as `${string}/${string}`;

  await ensureReplicateModel(replicate, replicateOwner, destModel);

  const trainerVersion = await getFluxTrainerVersion();

  const training = await replicate.trainings.create(
    LORA_TRAINING_OWNER,
    LORA_TRAINING_MODEL,
    trainerVersion,
    {
      destination,
      input: {
        input_images: zipUrl,
        trigger_word: params.trigger_word,
        steps: params.steps,
        learning_rate: params.learning_rate,
        lora_rank: params.lora_rank,
        batch_size: params.batch_size,
        resolution: params.resolution,
        autocaption: false,
        caption_prefix: '',
      },
    }
  );

  console.log(`[LoRA Train] Training started: ${training.id}`);

  // Update DB with training ID
  await deps.supabase
    .from('character_loras')
    .update({
      training_id: training.id,
      training_params: params,
      training_attempts: attempt,
    })
    .eq('id', loraId);

  // Step 4: Poll until complete
  let status = await replicate.trainings.get(training.id);
  let pollCount = 0;
  const maxPolls = 120; // ~30 minutes at 15s intervals

  while (
    status.status !== 'succeeded' &&
    status.status !== 'failed' &&
    status.status !== 'canceled' &&
    pollCount < maxPolls
  ) {
    await sleep(PIPELINE_CONFIG.replicatePollingInterval);
    status = await replicate.trainings.get(training.id);
    pollCount++;

    if (pollCount % 4 === 0) {
      console.log(
        `[LoRA Train] Polling... status=${status.status} (${pollCount * 15}s elapsed)`
      );
    }
  }

  if (status.status === 'failed') {
    const errorMsg = status.error || 'Training failed with no error message';
    throw new Error(`Replicate training failed: ${errorMsg}`);
  }

  if (status.status === 'canceled') {
    throw new Error('Replicate training was canceled');
  }

  if (pollCount >= maxPolls) {
    throw new Error(
      `Training timed out after ${(maxPolls * 15) / 60} minutes (training ID: ${training.id})`
    );
  }

  // Step 5: Download the trained LoRA
  const loraOutputUrl = (status.output as any)?.weights;
  if (!loraOutputUrl) {
    throw new Error(
      `Training succeeded but no weights URL found. Output: ${JSON.stringify(status.output)}`
    );
  }

  console.log(`[LoRA Train] Training complete! Downloading weights from ${loraOutputUrl}`);

  const loraResponse = await fetch(loraOutputUrl);
  if (!loraResponse.ok) {
    throw new Error(`Failed to download LoRA weights: ${loraResponse.status}`);
  }
  const loraBuffer = Buffer.from(await loraResponse.arrayBuffer());

  console.log(
    `[LoRA Train] LoRA downloaded: ${(loraBuffer.length / 1024 / 1024).toFixed(1)}MB`
  );

  return {
    trainingId: training.id,
    loraUrl: loraOutputUrl,
    loraBuffer,
    attempt,
  };
}

/**
 * Suggest adjusted training parameters for a retry attempt.
 */
export function getRetryParams(attempt: number): Partial<TrainingParams> {
  switch (attempt) {
    case 2:
      // More steps + lower LR — may have been underfitting
      return { steps: 2000, learning_rate: 0.0002 };
    case 3:
      // Higher fidelity rank
      return { lora_rank: 32 };
    default:
      return {};
  }
}

// ── Internal helpers ────────────────────────────────────────────

async function createTrainingZip(
  images: CaptionResult['captionedImages']
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const passthrough = new PassThrough();

    passthrough.on('data', (chunk: Buffer) => chunks.push(chunk));
    passthrough.on('end', () => resolve(Buffer.concat(chunks)));
    passthrough.on('error', reject);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', reject);
    archive.pipe(passthrough);

    // Download + compress images (PNG → JPEG at quality 90 to keep ZIP under
    // Supabase Storage's 50MB file size limit while preserving training quality)
    const imagePromises = images.map(async (img, idx) => {
      const paddedIdx = String(idx).padStart(3, '0');
      const imageName = `${paddedIdx}.jpg`;
      const captionName = `${paddedIdx}.txt`;

      const response = await fetch(img.imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to download ${img.imageUrl}: ${response.status}`);
      }
      const rawBuffer = Buffer.from(await response.arrayBuffer());

      // Convert to JPEG — reduces ~8MB PNGs to ~500KB-1MB JPEGs
      const imageBuffer = await sharp(rawBuffer)
        .jpeg({ quality: 90 })
        .toBuffer();

      return { imageName, imageBuffer, captionName, caption: img.caption };
    });

    // Resolve all downloads, then add to archive sequentially
    Promise.all(imagePromises)
      .then((entries) => {
        for (const entry of entries) {
          archive.append(entry.imageBuffer, { name: entry.imageName });
          archive.append(entry.caption, { name: entry.captionName });
        }
        archive.finalize();
      })
      .catch(reject);
  });
}

export async function getReplicateUsername(replicate: Replicate): Promise<string> {
  const resp = await fetch('https://api.replicate.com/v1/account', {
    headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` },
  });
  if (!resp.ok) throw new Error(`Failed to get Replicate account: ${resp.status}`);
  const data = await resp.json();
  return data.username;
}

export async function ensureReplicateModel(
  replicate: Replicate,
  owner: string,
  modelName: string,
): Promise<void> {
  // Check if model exists
  try {
    await replicate.models.get(owner, modelName);
    console.log(`[LoRA Train] Destination model ${owner}/${modelName} exists`);
    return;
  } catch {
    // Model doesn't exist — create it
  }

  console.log(`[LoRA Train] Creating destination model ${owner}/${modelName}...`);
  await replicate.models.create(owner, modelName, {
    visibility: 'private',
    hardware: PIPELINE_CONFIG.replicateHardware,
    description: `Character LoRA: ${modelName}`,
  });
  console.log(`[LoRA Train] Model created`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
