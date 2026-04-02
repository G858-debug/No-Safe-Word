/**
 * Pony V6 / CyberRealistic Pony Semi-Realistic dataset generator for character LoRA training.
 *
 * Unlike the Flux pipeline (which splits between Nano Banana face + SDXL body),
 * the Pony pipeline generates ALL training images with CyberRealistic Pony Semi-Realistic v4.5
 * via RunPod/ComfyUI. This ensures the training data matches the inference model.
 *
 * Produces 20-25 images across categories:
 *   - 8 face close-ups (varied angles, expressions, clothing)
 *   - 6 head-and-shoulders (varied clothing, backgrounds)
 *   - 6 full-body shots (varied poses, outfits, settings)
 *   - 4 waist-up shots (varied poses, backgrounds)
 */

import { buildPonyWorkflow } from './pony-workflow-builder';
import { buildPonyQualityPrefix, buildPonyNegativePrompt } from './pony-prompt-builder';
import { submitRunPodJob, waitForRunPodResult } from './runpod';
import type {
  ImageCategory,
  CharacterInput,
  DatasetGenerationResult,
  LoraDatasetImageRow,
  VariationType,
} from './character-lora/types';

export interface PonyDatasetPrompt {
  id: string;
  category: ImageCategory;
  tags: string;
  description: string;
}

export interface PonyDatasetCharacter {
  name: string;
  gender: 'male' | 'female';
  ethnicity: string;
  skinTone: string;
  hairColor: string;
  hairStyle: string;
  eyeColor: string;
  bodyType: string;
  age: string;
  distinguishingFeatures: string;
}

/** Case-insensitive check for Black/African ethnicity */
function isBlackAfrican(ethnicity: string): boolean {
  const lower = ethnicity.toLowerCase();
  return lower.includes('black') || lower.includes('african') || lower.includes('dark');
}

function buildIdentityTags(char: PonyDatasetCharacter): string {
  const tags: string[] = [];
  const genderTag = char.gender === 'female' ? '1girl' : '1boy';
  tags.push(genderTag);

  if (char.skinTone) tags.push(`${char.skinTone} skin`);
  if (char.ethnicity && isBlackAfrican(char.ethnicity)) {
    tags.push(char.gender === 'female' ? 'dark-skinned female' : 'dark-skinned male', 'african');
  }
  if (char.hairColor) tags.push(`${char.hairColor.toLowerCase()} hair`);
  if (char.hairStyle) tags.push(char.hairStyle.toLowerCase());
  if (char.eyeColor) tags.push(`${char.eyeColor.toLowerCase()} eyes`);

  if (char.gender === 'female') {
    tags.push('curvy', 'wide hips', 'large breasts', 'thick thighs', 'narrow waist');
    if (char.bodyType) tags.push(char.bodyType.toLowerCase());
  } else {
    if (char.bodyType) tags.push(char.bodyType.toLowerCase());
  }

  if (char.age) tags.push(`${char.age} years old`);
  if (char.distinguishingFeatures) tags.push(char.distinguishingFeatures.toLowerCase());

  return tags.join(', ');
}

// ── Face Close-up Prompts ──

const FACE_CLOTHING = [
  'white fitted t-shirt',
  'black blazer over white blouse',
  'ankara-print off-shoulder top',
  'olive green tank top',
  'rust turtleneck',
  'denim jacket open over crop top',
  'floral summer dress',
  'grey hoodie',
];

const FACE_PROMPTS: Omit<PonyDatasetPrompt, 'id'>[] = [
  { category: 'face-closeup', tags: `looking at viewer, neutral expression, ${FACE_CLOTHING[0]}, portrait, face focus, soft studio lighting, clean background`, description: 'Front neutral' },
  { category: 'face-closeup', tags: `looking slightly right, warm smile, ${FACE_CLOTHING[1]}, portrait, face focus, golden hour side lighting`, description: '3/4 right smile' },
  { category: 'face-closeup', tags: `looking over shoulder, serious expression, ${FACE_CLOTHING[2]}, portrait, face focus, dramatic shadow lighting`, description: 'Over-shoulder contemplative' },
  { category: 'face-closeup', tags: `head tilt, laughing, ${FACE_CLOTHING[3]}, portrait, face focus, bright natural daylight`, description: 'Laughing candid' },
  { category: 'face-closeup', tags: `direct eye contact, confident smirk, ${FACE_CLOTHING[4]}, portrait, face focus, warm indoor ambient light`, description: 'Confident direct gaze' },
  { category: 'face-closeup', tags: `eyes downcast, thoughtful expression, ${FACE_CLOTHING[5]}, portrait, face focus, soft window light from side`, description: 'Vulnerable downcast' },
  { category: 'face-closeup', tags: `profile view, serene expression, ${FACE_CLOTHING[6]}, portrait, face focus, backlit rim lighting`, description: 'Left profile' },
  { category: 'face-closeup', tags: `looking slightly left, joyful expression, ${FACE_CLOTHING[7]}, portrait, face focus, outdoor natural light`, description: '3/4 left joy' },
];

// ── Head-and-Shoulders Prompts ──

const HEAD_PROMPTS: Omit<PonyDatasetPrompt, 'id'>[] = [
  { category: 'head-shoulders', tags: 'head and shoulders, professional blazer, composed expression, studio lighting, office background', description: 'Professional blazer' },
  { category: 'head-shoulders', tags: 'head and shoulders, casual fitted top, relaxed smile, natural daylight, cafe interior', description: 'Casual cafe' },
  { category: 'head-shoulders', tags: 'head and shoulders, off-shoulder top, elegant expression, warm golden light, evening setting', description: 'Off-shoulder elegant' },
  { category: 'head-shoulders', tags: 'head and shoulders, african print fabric top, confident look, bright outdoor light, garden background', description: 'African print outdoor' },
  { category: 'head-shoulders', tags: 'head and shoulders, white blouse, gentle smile, soft window light, home interior', description: 'White blouse home' },
  { category: 'head-shoulders', tags: 'head and shoulders, gold jewelry, necklace, earrings, poised expression, dramatic lighting, dark background', description: 'Jewelry dramatic' },
];

// ── Full-Body Prompts (Female) ──

const FEMALE_BODY_PROMPTS: Omit<PonyDatasetPrompt, 'id'>[] = [
  { category: 'full-body', tags: 'standing, confident pose, mini skirt, strappy crop top, high heels, full body, head to toe, warm studio lighting, clean background', description: 'Standing studio' },
  { category: 'full-body', tags: 'walking pose, bodycon dress, heels, full body, head to toe, outdoor street, golden hour lighting', description: 'Walking golden hour' },
  { category: 'full-body', tags: 'leaning against wall, jeans, fitted tank top, full body, head to toe, urban alley, dramatic lighting', description: 'Leaning urban' },
  { category: 'full-body', tags: 'standing, hand on hip, wrap dress, full body, head to toe, restaurant interior, warm ambient light', description: 'Wrap dress restaurant' },
  { category: 'full-body', tags: 'casual pose, leggings, crop top, sneakers, full body, head to toe, park outdoor, natural daylight', description: 'Casual park' },
  { category: 'full-body', tags: 'seated on stool, camisole, shorts, full body, indoor studio, soft diffused light', description: 'Seated studio' },
];

// ── Full-Body Prompts (Male) ──

const MALE_BODY_PROMPTS: Omit<PonyDatasetPrompt, 'id'>[] = [
  { category: 'full-body', tags: 'standing, confident pose, henley shirt, jeans, boots, full body, head to toe, warm studio lighting, clean background', description: 'Standing studio' },
  { category: 'full-body', tags: 'walking pose, chinos, polo shirt, full body, head to toe, outdoor street, golden hour lighting', description: 'Walking golden hour' },
  { category: 'full-body', tags: 'leaning against car, tank top, shorts, full body, head to toe, workshop exterior, natural light', description: 'Leaning workshop' },
  { category: 'full-body', tags: 'standing relaxed, compression shirt, joggers, full body, head to toe, gym interior, bright lighting', description: 'Gym casual' },
  { category: 'full-body', tags: 'seated on chair, v-neck shirt, trousers, full body, restaurant interior, warm ambient light', description: 'Seated restaurant' },
  { category: 'full-body', tags: 'casual stance, sleeveless top, cargo pants, full body, head to toe, outdoor park, natural daylight', description: 'Outdoor casual' },
];

// ── Waist-Up Prompts ──

const WAIST_UP_PROMPTS: Omit<PonyDatasetPrompt, 'id'>[] = [
  { category: 'waist-up', tags: 'upper body, arms crossed, fitted top, indoor, warm lighting, medium shot', description: 'Arms crossed indoor' },
  { category: 'waist-up', tags: 'upper body, hand on chin, thoughtful, outdoor cafe, natural light, medium shot', description: 'Thoughtful cafe' },
  { category: 'waist-up', tags: 'upper body, slight lean forward, engaging expression, office setting, professional lighting, medium shot', description: 'Office engaging' },
  { category: 'waist-up', tags: 'upper body, relaxed pose, casual clothing, bedroom setting, soft lamp light, medium shot', description: 'Relaxed bedroom' },
];

/**
 * Build the full set of dataset prompts for a character.
 */
export function buildPonyDatasetPrompts(char: PonyDatasetCharacter): PonyDatasetPrompt[] {
  const bodyPrompts = char.gender === 'female' ? FEMALE_BODY_PROMPTS : MALE_BODY_PROMPTS;

  const allPromptDefs = [
    ...FACE_PROMPTS,
    ...HEAD_PROMPTS,
    ...bodyPrompts,
    ...WAIST_UP_PROMPTS,
  ];

  return allPromptDefs.map((def, i) => ({
    ...def,
    id: `pony_${def.category}_${i}`,
  }));
}

/**
 * Build a ComfyUI workflow for a single dataset training image.
 */
export function buildPonyDatasetWorkflow(opts: {
  character: PonyDatasetCharacter;
  prompt: PonyDatasetPrompt;
  seed: number;
}): { workflow: Record<string, any>; positivePrompt: string; negativePrompt: string } {
  const identityTags = buildIdentityTags(opts.character);
  const qualityPrefix = buildPonyQualityPrefix('sfw');
  const positivePrompt = `${qualityPrefix}, ${identityTags}, ${opts.prompt.tags}`;
  const negativePrompt = buildPonyNegativePrompt('sfw');

  // Dimensions based on category
  let width: number;
  let height: number;
  switch (opts.prompt.category) {
    case 'face-closeup':
      width = 1024;
      height = 1024; // Square for faces
      break;
    case 'head-shoulders':
      width = 832;
      height = 1216; // Portrait
      break;
    case 'full-body':
      width = 832;
      height = 1216; // Portrait
      break;
    case 'waist-up':
      width = 832;
      height = 1216; // Portrait
      break;
    default:
      width = 1024;
      height = 1024;
  }

  const workflow = buildPonyWorkflow({
    positivePrompt,
    negativePrompt,
    width,
    height,
    seed: opts.seed,
    filenamePrefix: `dataset_${opts.prompt.id}`,
  });

  return { workflow, positivePrompt, negativePrompt };
}

// ── Orchestration ──

interface PonyDatasetDeps {
  supabase: {
    from: (table: string) => any;
    storage: { from: (bucket: string) => any };
  };
}

/**
 * Generate a full training dataset using CyberRealistic Pony Semi-Realistic.
 * Produces 24 images across face, head-shoulders, full-body, and waist-up categories.
 * Returns the same DatasetGenerationResult shape as the Flux generator.
 */
export async function generatePonyDataset(
  character: CharacterInput,
  loraId: string,
  deps: PonyDatasetDeps,
): Promise<DatasetGenerationResult> {
  const ponyEndpointId = process.env.RUNPOD_PONY_ENDPOINT_ID;
  if (!ponyEndpointId) {
    throw new Error('Missing RUNPOD_PONY_ENDPOINT_ID — required for Pony dataset generation');
  }

  const ponyChar: PonyDatasetCharacter = {
    name: character.characterName,
    gender: character.structuredData.gender as 'male' | 'female',
    ethnicity: character.structuredData.ethnicity,
    skinTone: character.structuredData.skinTone,
    hairColor: character.structuredData.hairColor,
    hairStyle: character.structuredData.hairStyle,
    eyeColor: character.structuredData.eyeColor,
    bodyType: character.structuredData.bodyType,
    age: character.structuredData.age,
    distinguishingFeatures: character.structuredData.distinguishingFeatures || '',
  };

  const prompts = buildPonyDatasetPrompts(ponyChar);
  const imageRecords: LoraDatasetImageRow[] = [];
  const failedPrompts: DatasetGenerationResult['failedPrompts'] = [];

  // Resumability: check which prompts already have images in the DB
  const { data: existingImages } = await deps.supabase
    .from('lora_dataset_images')
    .select('prompt_template')
    .eq('lora_id', loraId);
  const existingPromptIds = new Set((existingImages || []).map((r: any) => r.prompt_template));

  const remaining = prompts.filter(p => !existingPromptIds.has(p.id));
  console.log(`[Pony Dataset] ${prompts.length} total prompts, ${existingPromptIds.size} already generated, ${remaining.length} remaining for ${character.characterName}`);

  for (let i = 0; i < remaining.length; i++) {
    const prompt = remaining[i];
    const originalIndex = prompts.indexOf(prompt);
    const seed = (character.portraitSeed || 42) + originalIndex;

    try {
      console.log(`[Pony Dataset] ${existingPromptIds.size + i + 1}/${prompts.length}: ${prompt.description} (${prompt.category})`);

      const { workflow, positivePrompt } = buildPonyDatasetWorkflow({
        character: ponyChar,
        prompt,
        seed,
      });

      const { jobId } = await submitRunPodJob(workflow, undefined, undefined, ponyEndpointId);
      const { imageBase64 } = await waitForRunPodResult(jobId, 300000, 3000, ponyEndpointId);

      // Upload to Supabase storage
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      const storagePath = `lora-datasets/${loraId}/${prompt.id}.png`;

      const { error: uploadError } = await deps.supabase.storage
        .from('story-images')
        .upload(storagePath, imageBuffer, {
          contentType: 'image/png',
          upsert: true,
        });

      if (uploadError) {
        throw new Error(`Upload failed for ${prompt.id}: ${uploadError.message}`);
      }

      const { data: urlData } = deps.supabase.storage
        .from('story-images')
        .getPublicUrl(storagePath);

      // Insert DB record
      const { data: record, error: insertError } = await deps.supabase
        .from('lora_dataset_images')
        .insert({
          lora_id: loraId,
          image_url: urlData.publicUrl,
          storage_path: storagePath,
          prompt_template: prompt.id,
          variation_type: inferVariationType(prompt),
          source: 'comfyui' as const,
          category: prompt.category,
          eval_status: 'pending',
        })
        .select()
        .single();

      if (insertError) {
        throw new Error(`Failed to create dataset record: ${insertError.message}`);
      }

      imageRecords.push(record as LoraDatasetImageRow);

      // Heartbeat: update the LoRA record so stale detection knows we're alive
      // Also stores progress so the UI can show "X/Y images generated"
      if (i % 3 === 2 || i === remaining.length - 1) {
        await deps.supabase
          .from('character_loras')
          .update({
            updated_at: new Date().toISOString(),
            dataset_size: imageRecords.length,
          })
          .eq('id', loraId);
      }

      // Small delay between requests
      if (i < remaining.length - 1) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (err) {
      console.error(`[Pony Dataset] Failed ${prompt.id}: ${err}`);
      failedPrompts.push({
        promptTemplate: prompt.id,
        variationType: inferVariationType(prompt),
        source: 'comfyui' as const,
      });
    }
  }

  const totalGenerated = existingPromptIds.size + imageRecords.length;
  console.log(
    `[Pony Dataset] Complete: ${totalGenerated} total images (${existingPromptIds.size} existing + ${imageRecords.length} new), ${failedPrompts.length} failed`,
  );

  return {
    totalGenerated,
    imageRecords,
    failedPrompts,
  };
}

function inferVariationType(prompt: PonyDatasetPrompt): VariationType {
  const desc = prompt.description.toLowerCase();
  if (desc.includes('angle') || desc.includes('profile') || desc.includes('3/4')) return 'angle';
  if (desc.includes('laugh') || desc.includes('smile') || desc.includes('confident') || desc.includes('vulnerable') || desc.includes('joy')) return 'expression';
  if (desc.includes('blazer') || desc.includes('casual') || desc.includes('dress') || desc.includes('print')) return 'clothing';
  if (desc.includes('studio') || desc.includes('golden') || desc.includes('dramatic') || desc.includes('outdoor')) return 'lighting';
  return 'framing';
}
