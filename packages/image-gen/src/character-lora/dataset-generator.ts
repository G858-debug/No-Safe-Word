// Stage 1: Hybrid Dataset Generation
// Nano Banana Pro (Replicate) → face close-ups + head-and-shoulders (SFW, best face consistency)
// ComfyUI/RunPod → waist-up, full body, body detail (no content restrictions, body-type fidelity)
//
// Images are generated SEQUENTIALLY (not concurrent) to respect API rate limits.

import Replicate from 'replicate';
import type {
  CharacterInput,
  DatasetGenerationResult,
  LoraDatasetImageRow,
  VariationType,
  ImageSource,
  ImageCategory,
} from './types';
import { PIPELINE_CONFIG } from './types';
import {
  getNanoBananaPrompts,
  getComfyUIPrompts,
  adaptPromptForGender,
  interpolateComfyUIPrompt,
} from './dataset-prompts';
import type { DatasetPrompt } from './dataset-prompts';
import {
  buildPortraitWorkflow,
  submitRunPodJob,
  waitForRunPodResult,
  imageUrlToBase64,
} from '../index';

const NANO_BANANA_MODEL = 'google/nano-banana-pro' as const;

interface DatasetGeneratorDeps {
  supabase: {
    from: (table: string) => any;
    storage: { from: (bucket: string) => any };
  };
}

/**
 * Generate a hybrid training dataset for a character LoRA.
 *
 * Phase 1: Nano Banana Pro for face/head shots (uses portrait as reference)
 * Phase 2: ComfyUI/RunPod for body shots (uses IPAdapter with portrait + body-type prompts)
 *
 * All images are generated sequentially with delays between requests.
 */
export async function generateDataset(
  character: CharacterInput,
  loraId: string,
  deps: DatasetGeneratorDeps,
  promptLimit?: number,
): Promise<DatasetGenerationResult> {
  const imageRecords: LoraDatasetImageRow[] = [];

  // ── Phase 1: Nano Banana Pro (face/head shots) ──────────────
  const nbPrompts = getNanoBananaPrompts().map((p) => ({
    ...p,
    prompt: adaptPromptForGender(p.prompt, character.gender),
  }));
  const nbLimited = promptLimit ? nbPrompts.slice(0, Math.ceil(promptLimit * 0.6)) : nbPrompts;

  console.log(`[LoRA Dataset] Phase 1: Generating ${nbLimited.length} face/head images via Nano Banana Pro...`);

  const nbRecords = await generateNanoBananaImages(character, loraId, nbLimited, deps);
  imageRecords.push(...nbRecords);

  // ── Phase 2: ComfyUI/RunPod (body shots) ────────────────────
  const cuPrompts = getComfyUIPrompts().map((p) => ({
    ...p,
    prompt: adaptPromptForGender(
      interpolateComfyUIPrompt(p.prompt, character.structuredData),
      character.gender,
    ),
  }));
  const cuLimited = promptLimit ? cuPrompts.slice(0, Math.ceil(promptLimit * 0.4)) : cuPrompts;

  console.log(`[LoRA Dataset] Phase 2: Generating ${cuLimited.length} body images via ComfyUI/RunPod...`);

  const cuRecords = await generateComfyUIImages(character, loraId, cuLimited, deps);
  imageRecords.push(...cuRecords);

  console.log(
    `[LoRA Dataset] Complete: ${imageRecords.length} images ` +
    `(${nbRecords.length} Nano Banana + ${cuRecords.length} ComfyUI)`
  );

  return {
    totalGenerated: imageRecords.length,
    imageRecords,
  };
}

/**
 * Generate replacement images for failed evaluations.
 * Routes to the correct pipeline based on the original source.
 */
export async function generateReplacements(
  character: CharacterInput,
  loraId: string,
  failedImages: Array<{ promptTemplate: string; variationType: VariationType }>,
  deps: DatasetGeneratorDeps,
): Promise<LoraDatasetImageRow[]> {
  const allPrompts = [
    ...getNanoBananaPrompts().map((p) => ({
      ...p,
      prompt: adaptPromptForGender(p.prompt, character.gender),
    })),
    ...getComfyUIPrompts().map((p) => ({
      ...p,
      prompt: adaptPromptForGender(
        interpolateComfyUIPrompt(p.prompt, character.structuredData),
        character.gender,
      ),
    })),
  ];

  console.log(`[LoRA Dataset] Generating ${failedImages.length} replacement images...`);

  const replacements: LoraDatasetImageRow[] = [];

  for (const failed of failedImages) {
    const original = allPrompts.find((p) => p.id === failed.promptTemplate);
    if (!original) continue;

    const replacementPrompt: DatasetPrompt = {
      ...original,
      id: `${original.id}_replacement`,
    };

    try {
      let record: LoraDatasetImageRow;
      if (original.source === 'nano-banana') {
        record = await generateSingleNanoBanana(character, replacementPrompt, loraId, deps);
      } else {
        record = await generateSingleComfyUI(character, replacementPrompt, loraId, deps);
      }
      replacements.push(record);
    } catch (error) {
      console.error(`[LoRA Dataset] Replacement failed for ${failed.promptTemplate}: ${error}`);
    }
  }

  console.log(
    `[LoRA Dataset] Generated ${replacements.length}/${failedImages.length} replacements`
  );

  return replacements;
}

// ── Nano Banana Pro Pipeline ──────────────────────────────────────

async function generateNanoBananaImages(
  character: CharacterInput,
  loraId: string,
  prompts: DatasetPrompt[],
  deps: DatasetGeneratorDeps,
): Promise<LoraDatasetImageRow[]> {
  const records: LoraDatasetImageRow[] = [];

  for (let i = 0; i < prompts.length; i++) {
    try {
      const record = await generateSingleNanoBanana(character, prompts[i], loraId, deps);
      records.push(record);
    } catch (error) {
      console.error(`[LoRA Dataset] NB failed ${prompts[i].id}: ${error}`);
    }

    // Rate limit delay between requests
    if (i < prompts.length - 1) {
      await sleep(PIPELINE_CONFIG.nanoBananaDelay);
    }
  }

  return records;
}

async function generateSingleNanoBanana(
  character: CharacterInput,
  prompt: DatasetPrompt,
  loraId: string,
  deps: DatasetGeneratorDeps,
): Promise<LoraDatasetImageRow> {
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

  if (!process.env.REPLICATE_API_TOKEN) {
    throw new Error('Missing REPLICATE_API_TOKEN environment variable');
  }

  const output = await replicate.run(NANO_BANANA_MODEL, {
    input: {
      prompt: prompt.prompt,
      image_input: [character.approvedImageUrl],
      aspect_ratio: '1:1',
      output_format: 'png',
      safety_tolerance: 6,
    },
  });

  const imageUrl = extractReplicateUrl(output);
  const imageBuffer = await downloadImage(imageUrl);

  return saveDatasetImage(imageBuffer, prompt, loraId, deps);
}

// ── ComfyUI/RunPod Pipeline ──────────────────────────────────────

async function generateComfyUIImages(
  character: CharacterInput,
  loraId: string,
  prompts: DatasetPrompt[],
  deps: DatasetGeneratorDeps,
): Promise<LoraDatasetImageRow[]> {
  // Pre-fetch the portrait image as base64 for IPAdapter reference
  const portraitBase64 = await imageUrlToBase64(character.approvedImageUrl);

  const records: LoraDatasetImageRow[] = [];

  for (let i = 0; i < prompts.length; i++) {
    try {
      const record = await generateSingleComfyUI(character, prompts[i], loraId, deps, portraitBase64);
      records.push(record);
    } catch (error) {
      console.error(`[LoRA Dataset] CU failed ${prompts[i].id}: ${error}`);
    }

    // Rate limit delay between requests
    if (i < prompts.length - 1) {
      await sleep(PIPELINE_CONFIG.comfyuiDelay);
    }
  }

  return records;
}

async function generateSingleComfyUI(
  character: CharacterInput,
  prompt: DatasetPrompt,
  loraId: string,
  deps: DatasetGeneratorDeps,
  portraitBase64?: string,
): Promise<LoraDatasetImageRow> {
  // Fetch portrait base64 if not pre-fetched
  const refBase64 = portraitBase64 || await imageUrlToBase64(character.approvedImageUrl);

  // Select checkpoint based on prompt configuration
  const checkpointMap: Record<string, string> = {
    realvis: 'realvisxl-v5.safetensors',
    lustify: 'lustify-v5-endgame.safetensors',
  };
  const checkpointName = checkpointMap[prompt.checkpoint || 'realvis'];

  // Build a portrait workflow with IPAdapter for face reference.
  // We use buildPortraitWorkflow for dataset generation (no FaceDetailer needed —
  // the LoRA training doesn't require refined faces, just consistent ones).
  // For body shots we include the standard LoRA stack for quality.
  const workflow = buildPortraitWorkflow({
    positivePrompt: prompt.prompt,
    width: 1024,
    height: 1024,
    seed: character.portraitSeed + hashCode(prompt.id),
    checkpointName,
    cfg: prompt.checkpoint === 'lustify' ? 3.5 : 7.5,
    loras: [
      { filename: 'detail-tweaker-xl.safetensors', strengthModel: 0.5, strengthClip: 0.5 },
      { filename: 'realistic-skin-xl.safetensors', strengthModel: 0.75, strengthClip: 0.75 },
      { filename: 'melanin-mix-xl.safetensors', strengthModel: 0.5, strengthClip: 0.5 },
    ],
    skipFaceDetailer: true, // Faster generation, training doesn't need ultra-refined faces
  });

  // Add IPAdapter FaceID nodes for face consistency.
  // We inject these directly into the workflow since buildPortraitWorkflow
  // doesn't include IPAdapter (it's designed for initial generation without a reference).
  const lastLoraNode = findLastLoraNode(workflow);
  injectIPAdapter(workflow, lastLoraNode, refBase64);

  // Submit to RunPod with the portrait reference image
  const { jobId } = await submitRunPodJob(workflow, [
    { name: 'ref_portrait.png', image: refBase64 },
  ]);

  const { imageBase64 } = await waitForRunPodResult(jobId, 300000, 3000);
  const imageBuffer = Buffer.from(imageBase64, 'base64');

  return saveDatasetImage(imageBuffer, prompt, loraId, deps);
}

/**
 * Inject IPAdapter FaceID nodes into an existing workflow.
 * Modifies the KSampler to use the IPAdapter model output.
 */
function injectIPAdapter(
  workflow: Record<string, any>,
  lastLoraNode: string,
  _refBase64: string,
): void {
  // Node 30: IPAdapter Unified Loader FaceID
  workflow['30'] = {
    class_type: 'IPAdapterUnifiedLoaderFaceID',
    inputs: {
      model: [lastLoraNode, 0],
      preset: 'FACEID PLUS V2',
      lora_strength: 0.6,
      provider: 'CUDA',
    },
  };

  // Node 31: Load the reference portrait image
  workflow['31'] = {
    class_type: 'LoadImage',
    inputs: { image: 'ref_portrait.png' },
  };

  // Node 32: IPAdapter FaceID application
  workflow['32'] = {
    class_type: 'IPAdapterFaceID',
    inputs: {
      model: ['30', 0],
      ipadapter: ['30', 1],
      image: ['31', 0],
      weight: 0.8,
      weight_faceidv2: 0.8,
      weight_type: 'linear',
      combine_embeds: 'concat',
      start_at: 0.0,
      end_at: 1.0,
      embeds_scaling: 'V only',
    },
  };

  // Rewire KSampler (node 6) to use IPAdapter output instead of LoRA output
  if (workflow['6']) {
    workflow['6'].inputs.model = ['32', 0];
  }
}

/**
 * Find the last LoRA loader node in the workflow chain.
 * Falls back to the checkpoint loader if no LoRAs.
 */
function findLastLoraNode(workflow: Record<string, any>): string {
  const loraIds = ['2e', '2d', '2c', '2b', '2a', '2'];
  for (const id of loraIds) {
    if (workflow[id]) return id;
  }
  return '1'; // Checkpoint loader
}

// ── Shared Helpers ────────────────────────────────────────────────

async function saveDatasetImage(
  imageBuffer: Buffer,
  prompt: DatasetPrompt,
  loraId: string,
  deps: DatasetGeneratorDeps,
): Promise<LoraDatasetImageRow> {
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

  const { data: urlData } = deps.supabase.storage
    .from('story-images')
    .getPublicUrl(storagePath);

  const publicUrl = urlData.publicUrl;

  const { data: record, error: insertError } = await deps.supabase
    .from('lora_dataset_images')
    .insert({
      lora_id: loraId,
      image_url: publicUrl,
      storage_path: storagePath,
      prompt_template: prompt.id,
      variation_type: prompt.variationType,
      source: prompt.source,
      category: prompt.category,
      eval_status: 'pending',
    })
    .select()
    .single();

  if (insertError) {
    throw new Error(`Failed to create dataset image record: ${insertError.message}`);
  }

  console.log(`[LoRA Dataset] ✓ ${prompt.id} (${prompt.source}/${prompt.category})`);

  return record as LoraDatasetImageRow;
}

async function downloadImage(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function extractReplicateUrl(output: unknown): string {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    const first = output[0];
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object' && 'url' in first) return (first as any).url;
  }
  if (output && typeof output === 'object') {
    if ('url' in output) return (output as any).url;
    const str = String(output);
    if (str.startsWith('http')) return str;
  }
  throw new Error(`Unexpected Replicate output format: ${JSON.stringify(output)}`);
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash) % 10000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
