// Stage 1: Hybrid Dataset Generation
// Nano Banana 2 (Replicate) → face close-ups + head-and-shoulders (SFW, best face consistency)
// ComfyUI/RunPod → waist-up, full body, body detail (no content restrictions, body-type fidelity)
//
// Images are generated SEQUENTIALLY (not concurrent) to respect API rate limits.

import Replicate from 'replicate';
import type {
  CharacterInput,
  DatasetGenerationResult,
  ImageSource,
  LoraDatasetImageRow,
  VariationType,
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
  buildKontextWorkflow,
  buildSdxlWorkflow,
  submitRunPodJob,
  waitForRunPodResult,
  imageUrlToBase64,
} from '../index';
import { readReplicateOutput } from '../replicate-client';

const NANO_BANANA_MODEL = 'google/nano-banana-2' as const;
const SDXL_CHECKPOINT = 'bigasp_v20.safetensors';
const MAX_GENERATION_RETRIES = 3;
const RETRY_BASE_DELAY = 30_000; // 30s, 60s, 120s

const BODY_PROMPT_VARIANTS = [
  {
    pose: 'standing facing camera, hands on hips, confident pose, softly blurred warm studio background',
    clothing: 'wearing a tiny fitted mini skirt stopping mid-thigh and a strappy low-cut crop top, high heels, fully clothed',
  },
  {
    pose: 'body turned three-quarter angle showing hip curve, weight shifted onto one leg, warm indoor background with soft window light',
    clothing: 'wearing a form-fitting bodycon dress that shows her curves clearly, high heels, fully clothed',
  },
  {
    pose: 'turned showing profile and rear, looking over shoulder, outdoor South African street background, golden hour light',
    clothing: 'wearing high-waisted skinny jeans and a cropped fitted tank top, sneakers, fully clothed',
  },
  {
    pose: 'seated on chair or couch, legs crossed, torso upright, warm living room interior background',
    clothing: 'wearing a short wrap dress with plunging neckline, heeled sandals, fully clothed',
  },
  {
    pose: 'mid-stride walking pose, slight body twist, urban Johannesburg street background, natural daylight',
    clothing: 'wearing fitted leggings and a tight long-sleeve crop top, running shoes, fully clothed',
  },
  {
    pose: 'standing relaxed, arms at sides, near a window with natural soft light, home interior background',
    clothing: 'wearing a fitted camisole and short shorts, barefoot, fully clothed',
  },
];

interface DatasetGeneratorDeps {
  supabase: {
    from: (table: string) => any;
    storage: { from: (bucket: string) => any };
  };
}

/**
 * Generate a hybrid training dataset for a character LoRA.
 *
 * Phase 1: Nano Banana 2 for face/head shots (uses portrait as reference)
 * Phase 2: ComfyUI/RunPod for body shots (uses Kontext ReferenceLatent with portrait + body-type prompts)
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
  const failedPrompts: DatasetGenerationResult['failedPrompts'] = [];

  // ── Phase 1: Nano Banana 2 (face/head shots) ───────────────
  const nbPrompts = getNanoBananaPrompts().map((p) => ({
    ...p,
    prompt: adaptPromptForGender(p.prompt, character.gender),
  }));
  const nbLimited = promptLimit ? nbPrompts.slice(0, Math.ceil(promptLimit * 0.6)) : nbPrompts;

  console.log(`[LoRA Dataset] Phase 1: Generating ${nbLimited.length} face/head images via Nano Banana 2...`);

  const nbResult = await generateNanoBananaImages(character, loraId, nbLimited, deps);
  imageRecords.push(...nbResult.records);
  failedPrompts.push(...nbResult.failures);

  // ── Phase 2: Body shots ────────────────────────────────────────
  const cuPrompts = getComfyUIPrompts().map((p) => ({
    ...p,
    prompt: adaptPromptForGender(
      interpolateComfyUIPrompt(p.prompt, character.structuredData),
      character.gender,
    ),
  }));
  const cuLimited = promptLimit ? cuPrompts.slice(0, Math.ceil(promptLimit * 0.4)) : cuPrompts;

  let phase2Count: number;

  if (character.gender === 'female') {
    // Female: BigASP + Feminine Body Proportions + Curvy Body → Flux img2img for curvaceous body shots
    console.log(`[LoRA Dataset] Phase 2: Generating ${cuLimited.length} body images via SDXL→img2img...`);
    const sdxlResult = await generateSdxlBodyShots(character, loraId, cuLimited.length, deps);
    imageRecords.push(...sdxlResult.records);
    failedPrompts.push(...sdxlResult.failures);
    phase2Count = sdxlResult.records.length;
  } else {
    // Male: Nano Banana 2 with 3:4 portrait aspect for body shots
    console.log(`[LoRA Dataset] Phase 2: Generating ${cuLimited.length} body images via Nano Banana 2 (male)...`);
    const nbBodyResult = await generateNanoBananaMaleBodyShots(character, loraId, cuLimited.length, deps);
    imageRecords.push(...nbBodyResult.records);
    failedPrompts.push(...nbBodyResult.failures);
    phase2Count = nbBodyResult.records.length;
  }

  console.log(
    `[LoRA Dataset] Complete: ${imageRecords.length} images ` +
    `(${nbResult.records.length} Nano Banana + ${phase2Count} body)` +
    (failedPrompts.length > 0 ? `, ${failedPrompts.length} failed` : '')
  );

  return {
    totalGenerated: imageRecords.length,
    imageRecords,
    failedPrompts,
  };
}

/**
 * Generate replacement images for failed evaluations.
 * Routes to the correct pipeline based on the original source.
 */
export async function generateReplacements(
  character: CharacterInput,
  loraId: string,
  failedImages: Array<{ promptTemplate: string; variationType: VariationType; source?: ImageSource }>,
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
    try {
      // SDXL→img2img replacements don't use prompt templates — generate a fresh body shot
      if (failed.source === 'sdxl-img2img') {
        const result = await generateSdxlBodyShots(character, loraId, 1, deps);
        replacements.push(...result.records);
        continue;
      }

      const original = allPrompts.find((p) => p.id === failed.promptTemplate);
      if (!original) continue;

      const replacementPrompt: DatasetPrompt = {
        ...original,
        id: `${original.id}_replacement`,
      };

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

// ── Nano Banana 2 Pipeline ───────────────────────────────────────

interface GenerationBatchResult {
  records: LoraDatasetImageRow[];
  failures: DatasetGenerationResult['failedPrompts'];
}

async function generateNanoBananaImages(
  character: CharacterInput,
  loraId: string,
  prompts: DatasetPrompt[],
  deps: DatasetGeneratorDeps,
): Promise<GenerationBatchResult> {
  const records: LoraDatasetImageRow[] = [];
  const failures: DatasetGenerationResult['failedPrompts'] = [];

  for (let i = 0; i < prompts.length; i++) {
    let succeeded = false;

    for (let attempt = 1; attempt <= MAX_GENERATION_RETRIES && !succeeded; attempt++) {
      try {
        const record = await generateSingleNanoBanana(character, prompts[i], loraId, deps);
        records.push(record);
        succeeded = true;
      } catch (error) {
        const isTransient = isTransientError(error);
        if (attempt < MAX_GENERATION_RETRIES && isTransient) {
          const delay = RETRY_BASE_DELAY * attempt;
          console.warn(
            `[LoRA Dataset] NB ${prompts[i].id} attempt ${attempt}/${MAX_GENERATION_RETRIES} failed (transient), retrying in ${delay / 1000}s: ${error}`
          );
          await sleep(delay);
        } else {
          console.error(`[LoRA Dataset] NB failed ${prompts[i].id} after ${attempt} attempt(s): ${error}`);
        }
      }
    }

    if (!succeeded) {
      failures.push({
        promptTemplate: prompts[i].id,
        variationType: prompts[i].variationType,
        source: 'nano-banana',
      });
    }

    // Rate limit delay between requests
    if (i < prompts.length - 1) {
      await sleep(PIPELINE_CONFIG.nanoBananaDelay);
    }
  }

  return { records, failures };
}

async function generateSingleNanoBanana(
  character: CharacterInput,
  prompt: DatasetPrompt,
  loraId: string,
  deps: DatasetGeneratorDeps,
  aspectRatio: string = '1:1',
): Promise<LoraDatasetImageRow> {
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

  if (!process.env.REPLICATE_API_TOKEN) {
    throw new Error('Missing REPLICATE_API_TOKEN environment variable');
  }

  const output = await replicate.run(NANO_BANANA_MODEL, {
    input: {
      prompt: prompt.prompt,
      image_input: [character.approvedImageUrl],
      aspect_ratio: aspectRatio,
      output_format: 'png',
      safety_tolerance: 6,
    },
  });

  const imageBuffer = await readReplicateOutput(output);

  return saveDatasetImage(imageBuffer, prompt, loraId, deps);
}

// ── ComfyUI/RunPod Pipeline ──────────────────────────────────────

async function generateComfyUIImages(
  character: CharacterInput,
  loraId: string,
  prompts: DatasetPrompt[],
  deps: DatasetGeneratorDeps,
): Promise<GenerationBatchResult> {
  // Pre-fetch the portrait image as base64 for Kontext ReferenceLatent conditioning
  const portraitBase64 = await imageUrlToBase64(character.approvedImageUrl);

  const records: LoraDatasetImageRow[] = [];
  const failures: DatasetGenerationResult['failedPrompts'] = [];

  for (let i = 0; i < prompts.length; i++) {
    let succeeded = false;

    for (let attempt = 1; attempt <= MAX_GENERATION_RETRIES && !succeeded; attempt++) {
      try {
        const record = await generateSingleComfyUI(character, prompts[i], loraId, deps, portraitBase64);
        records.push(record);
        succeeded = true;
      } catch (error) {
        const isTransient = isTransientError(error);
        if (attempt < MAX_GENERATION_RETRIES && isTransient) {
          const delay = RETRY_BASE_DELAY * attempt;
          console.warn(
            `[LoRA Dataset] CU ${prompts[i].id} attempt ${attempt}/${MAX_GENERATION_RETRIES} failed (transient), retrying in ${delay / 1000}s: ${error}`
          );
          await sleep(delay);
        } else {
          console.error(`[LoRA Dataset] CU failed ${prompts[i].id} after ${attempt} attempt(s): ${error}`);
        }
      }
    }

    if (!succeeded) {
      failures.push({
        promptTemplate: prompts[i].id,
        variationType: prompts[i].variationType,
        source: 'comfyui',
      });
    }

    // Rate limit delay between requests
    if (i < prompts.length - 1) {
      await sleep(PIPELINE_CONFIG.comfyuiDelay);
    }
  }

  return { records, failures };
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

  // Build a Kontext single-character workflow with the portrait as reference image.
  // For dataset generation, we use the reference image for face consistency.
  const workflow = buildKontextWorkflow({
    type: 'single',
    positivePrompt: prompt.prompt,
    width: 1024,
    height: 1024,
    seed: character.portraitSeed + hashCode(prompt.id),
    filenamePrefix: `dataset_${loraId}`,
    primaryRefImageName: 'ref_portrait.png',
    loras: [
      { filename: 'flux_realism_lora.safetensors', strengthModel: 0.8, strengthClip: 0.8 },
      { filename: 'flux-add-details.safetensors', strengthModel: 0.6, strengthClip: 0.6 },
    ],
  });

  // Submit to RunPod with the portrait reference image
  const { jobId } = await submitRunPodJob(workflow, [
    { name: 'ref_portrait.png', image: refBase64 },
  ]);

  const { imageBase64 } = await waitForRunPodResult(jobId, 300000, 3000);
  const imageBuffer = Buffer.from(imageBase64, 'base64');

  return saveDatasetImage(imageBuffer, prompt, loraId, deps);
}

// ── Nano Banana 2 Body Pipeline (Male — 3:4 portrait) ─────────────

const MALE_BODY_PROMPTS: DatasetPrompt[] = [
  {
    id: 'nb_male_body_front_studio',
    variationType: 'angle',
    source: 'nano-banana',
    category: 'full-body',
    prompt: 'Full body photo, standing facing camera with arms at sides, wearing fitted henley shirt and dark jeans, warm studio background with soft lighting',
    description: 'Front standing, henley + jeans, studio',
  },
  {
    id: 'nb_male_body_34_indoor',
    variationType: 'angle',
    source: 'nano-banana',
    category: 'full-body',
    prompt: 'Full body photo, body turned three-quarter angle, hands in pockets, wearing tailored chinos and fitted polo shirt, warm indoor background with soft window light',
    description: '3/4 angle, chinos + polo, indoor',
  },
  {
    id: 'nb_male_body_walking_outdoor',
    variationType: 'framing',
    source: 'nano-banana',
    category: 'full-body',
    prompt: 'Full body photo, mid-stride walking with confident posture, wearing bomber jacket over t-shirt and slim jeans, outdoor South African street background, golden hour light',
    description: 'Walking, bomber jacket, outdoor SA',
  },
  {
    id: 'nb_male_body_seated_interior',
    variationType: 'lighting',
    source: 'nano-banana',
    category: 'full-body',
    prompt: 'Full body photo, seated on chair leaning forward with elbows on knees, wearing button-up shirt with rolled sleeves and chinos, warm living room interior background',
    description: 'Seated, button-up, interior',
  },
  {
    id: 'nb_male_body_urban_casual',
    variationType: 'clothing',
    source: 'nano-banana',
    category: 'full-body',
    prompt: 'Full body photo, standing with arms crossed, wearing fitted crew neck sweater and dark trousers, urban Johannesburg street background, natural daylight',
    description: 'Arms crossed, sweater, urban JHB',
  },
  {
    id: 'nb_male_body_window_relaxed',
    variationType: 'lighting',
    source: 'nano-banana',
    category: 'full-body',
    prompt: 'Full body photo, standing relaxed leaning against wall, wearing v-neck t-shirt and joggers, near a window with natural soft light, home interior background',
    description: 'Leaning, v-neck + joggers, window light',
  },
];

export async function generateNanoBananaMaleBodyShots(
  character: CharacterInput,
  loraId: string,
  count: number,
  deps: DatasetGeneratorDeps,
): Promise<GenerationBatchResult> {
  const records: LoraDatasetImageRow[] = [];
  const failures: DatasetGenerationResult['failedPrompts'] = [];

  for (let i = 0; i < count; i++) {
    const promptTemplate = MALE_BODY_PROMPTS[i % MALE_BODY_PROMPTS.length];
    const prompt: DatasetPrompt = {
      ...promptTemplate,
      id: `${promptTemplate.id}_${i}_${Date.now()}`,
    };

    let succeeded = false;
    for (let attempt = 1; attempt <= MAX_GENERATION_RETRIES && !succeeded; attempt++) {
      try {
        const record = await generateSingleNanoBanana(character, prompt, loraId, deps, '3:4');
        records.push(record);
        succeeded = true;
      } catch (error) {
        const isTransient = isTransientError(error);
        if (attempt < MAX_GENERATION_RETRIES && isTransient) {
          const delay = RETRY_BASE_DELAY * attempt;
          console.warn(
            `[LoRA Dataset] NB male body ${prompt.id} attempt ${attempt}/${MAX_GENERATION_RETRIES} failed (transient), retrying in ${delay / 1000}s: ${error}`
          );
          await sleep(delay);
        } else {
          console.error(`[LoRA Dataset] NB male body failed ${prompt.id} after ${attempt} attempt(s): ${error}`);
        }
      }
    }

    if (!succeeded) {
      failures.push({
        promptTemplate: prompt.id,
        variationType: prompt.variationType,
        source: 'nano-banana',
      });
    }

    // Rate limit delay between requests
    if (i < count - 1) {
      await sleep(PIPELINE_CONFIG.nanoBananaDelay);
    }
  }

  return { records, failures };
}

// ── SDXL + Curvy Body LoRA → Flux img2img Pipeline (Female) ───────

/** Case-insensitive check for Black/African ethnicity */
function isBlackAfrican(ethnicity: string): boolean {
  const lower = ethnicity.toLowerCase();
  return lower.includes('black') || lower.includes('african') || lower.includes('dark');
}

export async function generateSdxlBodyShots(
  character: CharacterInput,
  loraId: string,
  count: number,
  deps: DatasetGeneratorDeps,
): Promise<GenerationBatchResult> {
  const { skinTone, ethnicity, hairStyle, hairColor } = character.structuredData;
  const useMelanin = isBlackAfrican(ethnicity);
  const hairDesc = hairStyle && hairColor ? `${hairStyle} ${hairColor} hair, ` : '';

  const melaninPrefix = useMelanin ? 'melanin, ' : '';
  const skinTonePrefix = useMelanin ? 'dark chocolate skin tone style, ' : '';
  const skinRealismPrefix = useMelanin ? 'Detailed natural skin and blemishes without-makeup and acne, ' : '';

  const basePositive =
    `${melaninPrefix}${skinTonePrefix}${skinRealismPrefix}${hairDesc}` +
    `extremely voluptuous figure, very large natural breasts, very wide hips, very large round ass, narrow defined waist, full thighs, ` +
    `${ethnicity} woman, ${skinTone} skin, curvaceous figure, ` +
    `large breasts, wide hips, thick thighs, small waist, hourglass body, ` +
    `full body from head to feet`;
  const negative =
    'nude, naked, topless, bare breasts, exposed chest, nsfw, lingerie, underwear, ' +
    'skinny, thin, flat chest, small breasts, narrow hips, deformed, ' +
    'bad anatomy, extra limbs, (worst quality:2), (low quality:2), ' +
    'white skin, pale skin, asian features, european features, ' +
    'cropped head, cut off head, forehead cropped, head out of frame, headless, partial face, face not visible';

  const img2imgPrompt =
    `Photorealistic photograph, extremely wide hips, very large round bubble butt, thick heavy thighs, narrow waist, pear-shaped bottom-heavy figure, ` +
    `${hairDesc}${ethnicity} woman, ${skinTone} skin, curvaceous figure with large breasts wide hips ` +
    `and thick thighs, wearing a fitted outfit, fully clothed, ` +
    `face and head clearly visible, full body, ` +
    `natural skin texture, soft lighting, high detail`;

  // Build LoRA stack matching generate-character-image.ts female body pipeline
  const loras: Array<{ filename: string; strengthModel: number; strengthClip: number }> = [
    { filename: 'feminine-body-proportions-sdxl.safetensors', strengthModel: 0.80, strengthClip: 0.80 },
    { filename: 'curvy-body-sdxl.safetensors', strengthModel: 0.70, strengthClip: 0.70 },
  ];
  if (useMelanin) {
    loras.push({ filename: 'melanin-XL.safetensors', strengthModel: 0.5, strengthClip: 0.5 });
    loras.push({ filename: 'sdxl-skin-tone-xl.safetensors', strengthModel: 0.6, strengthClip: 0.6 });
    loras.push({ filename: 'sdxl-skin-realism.safetensors', strengthModel: 0.4, strengthClip: 0.4 });
  }

  const records: LoraDatasetImageRow[] = [];
  const failures: DatasetGenerationResult['failedPrompts'] = [];

  for (let i = 0; i < count; i++) {
    const variant = BODY_PROMPT_VARIANTS[i % BODY_PROMPT_VARIANTS.length];
    const prompt = `${basePositive}, ${variant.clothing}, ${variant.pose}`;
    const promptId = `sdxl_body_${i}_${Date.now()}`;
    let succeeded = false;

    for (let attempt = 1; attempt <= MAX_GENERATION_RETRIES && !succeeded; attempt++) {
      try {
        // Step 1: Generate SDXL body shot via ComfyUI on RunPod
        const sdxlSeed = Math.floor(Math.random() * 2_147_483_647);
        const sdxlWorkflow = buildSdxlWorkflow({
          positivePrompt: prompt,
          negativePrompt: negative,
          width: 768,
          height: 1152,
          seed: sdxlSeed,
          steps: 40,
          cfg: 4.0,
          samplerName: 'dpmpp_2m_sde',
          checkpointName: SDXL_CHECKPOINT,
          loras,
          filenamePrefix: `sdxl_body_${loraId}`,
        });

        const { jobId: sdxlJobId } = await submitRunPodJob(sdxlWorkflow);
        const { imageBase64: sdxlBase64 } = await waitForRunPodResult(sdxlJobId, 300000, 3000);

        // Step 2: Convert to photorealistic via Flux Kontext img2img
        const fluxWorkflow = buildKontextWorkflow({
          type: 'img2img',
          positivePrompt: img2imgPrompt,
          width: 1024,
          height: 1024,
          seed: character.portraitSeed + hashCode(promptId),
          denoiseStrength: 0.55,
          filenamePrefix: `dataset_${loraId}`,
        });

        const { jobId } = await submitRunPodJob(fluxWorkflow, [
          { name: 'input.jpg', image: sdxlBase64 },
        ]);

        const { imageBase64 } = await waitForRunPodResult(jobId, 300000, 3000);
        const imageBuffer = Buffer.from(imageBase64, 'base64');

        // Step 3: Save the img2img result
        const category = i % 2 === 0 ? 'full-body' : 'waist-up';
        const variationType: VariationType = i % 3 === 0 ? 'clothing' : i % 3 === 1 ? 'framing' : 'lighting';
        const storagePath = `character-loras/datasets/${loraId}/${promptId}.png`;

        const { error: uploadError } = await deps.supabase.storage
          .from('story-images')
          .upload(storagePath, imageBuffer, {
            contentType: 'image/png',
            upsert: true,
          });

        if (uploadError) {
          throw new Error(`Supabase upload failed for ${promptId}: ${uploadError.message}`);
        }

        const { data: urlData } = deps.supabase.storage
          .from('story-images')
          .getPublicUrl(storagePath);

        const { data: record, error: insertError } = await deps.supabase
          .from('lora_dataset_images')
          .insert({
            lora_id: loraId,
            image_url: urlData.publicUrl,
            storage_path: storagePath,
            prompt_template: promptId,
            variation_type: variationType,
            source: 'sdxl-img2img',
            category,
            eval_status: 'pending',
          })
          .select()
          .single();

        if (insertError) {
          throw new Error(`Failed to create dataset image record: ${insertError.message}`);
        }

        console.log(`[LoRA Dataset] ✓ ${promptId} (sdxl-img2img/${category})`);
        records.push(record as LoraDatasetImageRow);
        succeeded = true;
      } catch (error) {
        const isTransient = isTransientError(error);
        if (attempt < MAX_GENERATION_RETRIES && isTransient) {
          const delay = RETRY_BASE_DELAY * attempt;
          console.warn(
            `[LoRA Dataset] SDXL body ${promptId} attempt ${attempt}/${MAX_GENERATION_RETRIES} failed (transient), retrying in ${delay / 1000}s: ${error}`
          );
          await sleep(delay);
        } else {
          console.error(`[LoRA Dataset] SDXL body failed ${promptId} after ${attempt} attempt(s): ${error}`);
        }
      }
    }

    if (!succeeded) {
      failures.push({
        promptTemplate: promptId,
        variationType: 'framing',
        source: 'sdxl-img2img',
      });
    }

    // Rate limit delay between requests
    if (i < count - 1) {
      await sleep(PIPELINE_CONFIG.nanoBananaDelay);
    }
  }

  return { records, failures };
}

// ── Single Image Regeneration ─────────────────────────────────────

/**
 * Regenerate a single dataset image, routing to the correct pipeline based on source.
 * Optionally accepts a custom prompt override (for nano-banana and comfyui sources).
 */
export async function regenerateSingleImage(
  character: CharacterInput,
  loraId: string,
  original: {
    source: ImageSource;
    category: string;
    variationType: VariationType;
    promptTemplate: string;
  },
  customPrompt: string | undefined,
  deps: DatasetGeneratorDeps,
): Promise<LoraDatasetImageRow> {
  if (original.source === 'sdxl-img2img') {
    // SDXL body shots use variant cycling — custom prompt not applicable
    const result = await generateSdxlBodyShots(character, loraId, 1, deps);
    if (result.records.length === 0) {
      throw new Error('SDXL body shot regeneration produced no images');
    }
    return result.records[0];
  }

  // For nano-banana and comfyui: build a DatasetPrompt, optionally with custom prompt text
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

  const templateMatch = allPrompts.find((p) => p.id === original.promptTemplate);
  const promptId = `${original.promptTemplate}_regen_${Date.now()}`;

  const datasetPrompt: DatasetPrompt = {
    id: promptId,
    variationType: original.variationType,
    source: original.source,
    category: original.category as DatasetPrompt['category'],
    prompt: customPrompt || templateMatch?.prompt || customPrompt || '',
    description: templateMatch?.description || 'Regenerated image',
  };

  if (!datasetPrompt.prompt) {
    throw new Error(`No prompt available for template ${original.promptTemplate} and no custom prompt provided`);
  }

  if (original.source === 'nano-banana') {
    return generateSingleNanoBanana(character, datasetPrompt, loraId, deps);
  } else {
    return generateSingleComfyUI(character, datasetPrompt, loraId, deps);
  }
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

/** Check if an error is transient and worth retrying (API overload, timeouts, network errors). */
function isTransientError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes('currently unavailable') ||
    msg.includes('high demand') ||
    msg.includes('Timed out') ||
    msg.includes('timeout') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('fetch failed') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('429')
  );
}
