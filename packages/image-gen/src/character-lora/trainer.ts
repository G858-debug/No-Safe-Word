// Stage 4: LoRA Training via Replicate API
// Creates a ZIP of images + captions, uploads to Supabase,
// then kicks off SDXL LoRA training on Replicate.

import Replicate from 'replicate';
import archiver from 'archiver';
import { PassThrough } from 'stream';
import type { CaptionResult, TrainingParams, TrainingResult } from './types';
import { DEFAULT_TRAINING_PARAMS, PIPELINE_CONFIG } from './types';

// Replicate's SDXL training model
const SDXL_TRAINING_OWNER = 'stability-ai';
const SDXL_TRAINING_MODEL = 'sdxl';
const SDXL_TRAINING_VERSION =
  '7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc';

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
): Promise<TrainingResult> {
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

  if (!process.env.REPLICATE_API_TOKEN) {
    throw new Error('Missing REPLICATE_API_TOKEN environment variable');
  }

  const params = { ...DEFAULT_TRAINING_PARAMS, ...paramsOverrides };

  console.log(
    `[LoRA Train] Starting training for ${characterSlug} (attempt ${attempt}, ${captionedImages.length} images)...`
  );

  // Step 1: Create ZIP of images + captions
  const zipBuffer = await createTrainingZip(captionedImages);
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
    throw new Error(`Failed to upload training ZIP: ${uploadError.message}`);
  }

  const { data: urlData } = deps.supabase.storage
    .from('story-images')
    .getPublicUrl(zipPath);

  const zipUrl = urlData.publicUrl;
  console.log(`[LoRA Train] ZIP uploaded to: ${zipPath}`);

  // Step 3: Start training on Replicate
  const training = await replicate.trainings.create(
    SDXL_TRAINING_OWNER,
    SDXL_TRAINING_MODEL,
    SDXL_TRAINING_VERSION,
    {
      destination: `no-safe-word/${characterSlug}` as `${string}/${string}`,
      input: {
        input_images: zipUrl,
        token_string: params.token_string,
        caption_prefix: '',
        is_lora: params.is_lora,
        lora_lr: params.lora_lr,
        unet_learning_rate: params.unet_learning_rate,
        text_encoder_lr: params.text_encoder_lr,
        max_train_steps: params.max_train_steps,
        resolution: params.resolution,
        batch_size: params.batch_size,
        use_face_detection_instead: params.use_face_detection_instead,
        lr_scheduler: params.lr_scheduler,
        seed: params.seed,
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
      // Lower learning rate — may have been overfitting
      return { lora_lr: 5e-5, max_train_steps: 1200 };
    case 3:
      // Higher learning rate — may have been underfitting
      return { lora_lr: 2e-4, max_train_steps: 800 };
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

    // Add images and captions in parallel-friendly order
    const imagePromises = images.map(async (img, idx) => {
      const paddedIdx = String(idx).padStart(3, '0');
      const imageName = `${paddedIdx}.png`;
      const captionName = `${paddedIdx}.txt`;

      // Download the image
      const response = await fetch(img.imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to download ${img.imageUrl}: ${response.status}`);
      }
      const imageBuffer = Buffer.from(await response.arrayBuffer());

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
