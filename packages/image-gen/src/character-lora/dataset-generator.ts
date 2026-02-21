// Stage 1: Dataset Generation using Nano Banana Pro via Replicate
// Generates 30 varied images of a character from a single approved portrait.

import Replicate from 'replicate';
import type {
  CharacterInput,
  DatasetGenerationResult,
  LoraDatasetImageRow,
  VariationType,
} from './types';
import { PIPELINE_CONFIG } from './types';
import { DATASET_PROMPTS, adaptPromptForGender } from './dataset-prompts';

const NANO_BANANA_MODEL = 'google/nano-banana-pro' as const;

interface DatasetGeneratorDeps {
  supabase: {
    from: (table: string) => any;
    storage: { from: (bucket: string) => any };
  };
}

/**
 * Generate a training dataset for a character LoRA.
 *
 * Sends the approved portrait as a reference image to Nano Banana Pro
 * with 30 diverse prompt templates. Uploads results to Supabase Storage
 * and creates tracking records in lora_dataset_images.
 */
export async function generateDataset(
  character: CharacterInput,
  loraId: string,
  deps: DatasetGeneratorDeps,
  /** Limit the number of prompts (for quick testing). Defaults to all 30. */
  promptLimit?: number,
): Promise<DatasetGenerationResult> {
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

  if (!process.env.REPLICATE_API_TOKEN) {
    throw new Error('Missing REPLICATE_API_TOKEN environment variable');
  }

  // Adapt prompts for character gender
  const allPrompts = DATASET_PROMPTS.map((p) => ({
    ...p,
    prompt: adaptPromptForGender(p.prompt, character.gender),
  }));
  const prompts = promptLimit ? allPrompts.slice(0, promptLimit) : allPrompts;

  console.log(`[LoRA Dataset] Generating ${prompts.length} images for ${character.characterName}...`);

  // Process in batches to respect concurrency limit
  const imageRecords: LoraDatasetImageRow[] = [];
  const batches = chunkArray(prompts, PIPELINE_CONFIG.generationConcurrency);

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    console.log(
      `[LoRA Dataset] Batch ${batchIdx + 1}/${batches.length} (${batch.length} images)...`
    );

    const results = await Promise.allSettled(
      batch.map((prompt) =>
        generateSingleImage(replicate, character, prompt, loraId, deps)
      )
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        imageRecords.push(result.value);
      } else {
        console.error(
          `[LoRA Dataset] Failed to generate ${batch[i].id}: ${result.reason}`
        );
      }
    }
  }

  console.log(
    `[LoRA Dataset] Generated ${imageRecords.length}/${prompts.length} images successfully`
  );

  return {
    totalGenerated: imageRecords.length,
    imageRecords,
  };
}

/**
 * Generate replacement images for failed evaluations.
 * Uses the same prompt templates as the failed images.
 */
export async function generateReplacements(
  character: CharacterInput,
  loraId: string,
  failedImages: Array<{ promptTemplate: string; variationType: VariationType }>,
  deps: DatasetGeneratorDeps,
): Promise<LoraDatasetImageRow[]> {
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

  if (!process.env.REPLICATE_API_TOKEN) {
    throw new Error('Missing REPLICATE_API_TOKEN environment variable');
  }

  console.log(
    `[LoRA Dataset] Generating ${failedImages.length} replacement images...`
  );

  // Find matching prompts and adapt for gender
  const promptsToRegenerate = failedImages.map((failed) => {
    const original = DATASET_PROMPTS.find((p) => p.id === failed.promptTemplate);
    if (!original) {
      // Fallback: use the first prompt of the same variation type
      const fallback = DATASET_PROMPTS.find(
        (p) => p.variationType === failed.variationType
      )!;
      return {
        ...fallback,
        id: `${fallback.id}_replacement`,
        prompt: adaptPromptForGender(fallback.prompt, character.gender),
      };
    }
    return {
      ...original,
      id: `${original.id}_replacement`,
      prompt: adaptPromptForGender(original.prompt, character.gender),
    };
  });

  const replacements: LoraDatasetImageRow[] = [];
  const batches = chunkArray(promptsToRegenerate, PIPELINE_CONFIG.generationConcurrency);

  for (const batch of batches) {
    const results = await Promise.allSettled(
      batch.map((prompt) =>
        generateSingleImage(replicate, character, prompt, loraId, deps)
      )
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        replacements.push(result.value);
      }
    }
  }

  console.log(
    `[LoRA Dataset] Generated ${replacements.length}/${failedImages.length} replacements`
  );

  return replacements;
}

// ── Internal helpers ────────────────────────────────────────────

async function generateSingleImage(
  replicate: Replicate,
  character: CharacterInput,
  prompt: { id: string; variationType: VariationType; prompt: string },
  loraId: string,
  deps: DatasetGeneratorDeps,
): Promise<LoraDatasetImageRow> {
  // Call Nano Banana Pro with the reference portrait
  const output = await replicate.run(NANO_BANANA_MODEL, {
    input: {
      prompt: prompt.prompt,
      image_input: [character.approvedImageUrl],
      aspect_ratio: '1:1',
      output_format: 'png',
      safety_tolerance: 6,
    },
  });

  // Output is a FileOutput or string URL
  const imageUrl = extractOutputUrl(output);

  // Download the generated image
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to download generated image: ${imageResponse.status}`);
  }
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

  // Upload to Supabase Storage
  const storagePath = `character-loras/datasets/${loraId}/${prompt.id}.png`;
  const { error: uploadError } = await deps.supabase.storage
    .from('story-images')
    .upload(storagePath, imageBuffer, {
      contentType: 'image/png',
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Supabase upload failed for ${prompt.id}: ${uploadError.message}`);
  }

  // Get public URL
  const { data: urlData } = deps.supabase.storage
    .from('story-images')
    .getPublicUrl(storagePath);

  const publicUrl = urlData.publicUrl;

  // Create database record
  const { data: record, error: insertError } = await deps.supabase
    .from('lora_dataset_images')
    .insert({
      lora_id: loraId,
      image_url: publicUrl,
      storage_path: storagePath,
      prompt_template: prompt.id,
      variation_type: prompt.variationType,
      eval_status: 'pending',
    })
    .select()
    .single();

  if (insertError) {
    throw new Error(`Failed to create dataset image record: ${insertError.message}`);
  }

  console.log(`[LoRA Dataset] ✓ ${prompt.id} (${prompt.variationType})`);

  return record as LoraDatasetImageRow;
}

function extractOutputUrl(output: unknown): string {
  // Replicate output can be a FileOutput, string, or array
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    const first = output[0];
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object' && 'url' in first) return (first as any).url;
  }
  if (output && typeof output === 'object') {
    if ('url' in output) return (output as any).url;
    // FileOutput objects are iterable and have a toString
    const str = String(output);
    if (str.startsWith('http')) return str;
  }
  throw new Error(`Unexpected Replicate output format: ${JSON.stringify(output)}`);
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
