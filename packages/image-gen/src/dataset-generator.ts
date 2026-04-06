/**
 * SDXL Character LoRA dataset generator.
 *
 * Generates training images via RunPod/ComfyUI using Juggernaut Ragnarok.
 * See docs/skills/sdxl-character-lora-training/SKILL.md for dataset requirements.
 *
 * Produces 34 images across categories (female) or 30 (male):
 *   - 10 face close-ups (varied angles, expressions, lighting)
 *   - 8 head-and-shoulders (varied clothing, backgrounds)
 *   - 10 full-body shots (varied poses, outfits, settings)
 *   - 6 waist-up shots (varied poses, backgrounds)
 */

import { buildWorkflow } from './workflow-builder';
import { buildQualityPrefix, buildNegativePrompt } from './prompt-builder';
import { submitRunPodJob, waitForRunPodResult } from './runpod';
import type {
  ImageCategory,
  CharacterInput,
  DatasetGenerationResult,
  LoraDatasetImageRow,
  VariationType,
} from './character-lora/types';

export interface DatasetPrompt {
  id: string;
  category: ImageCategory;
  tags: string;
  description: string;
}

export interface DatasetCharacter {
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

/**
 * Build natural language identity description for dataset training images.
 * Dataset generation NEEDS the full physical description since we're generating
 * images to TRAIN the LoRA — the trigger word doesn't exist yet.
 */
function buildIdentityDescription(char: DatasetCharacter): string {
  const parts: string[] = [];

  const genderWord = char.gender === 'female' ? 'woman' : 'man';
  if (char.age) {
    parts.push(`a ${char.age} year old ${char.ethnicity} ${genderWord}`);
  } else {
    parts.push(`a young ${char.ethnicity} ${genderWord}`);
  }

  if (char.skinTone) parts.push(`${char.skinTone} skin`);

  if (char.hairColor && char.hairStyle) {
    parts.push(`${char.hairColor} ${char.hairStyle}`);
  } else if (char.hairStyle) {
    parts.push(char.hairStyle);
  }

  if (char.eyeColor) parts.push(`${char.eyeColor} eyes`);
  if (char.bodyType) parts.push(char.bodyType);
  if (char.distinguishingFeatures) parts.push(char.distinguishingFeatures);

  return parts.join(', ');
}

// ── Face Close-up Prompts (natural language for Juggernaut Ragnarok) ──

const FACE_PROMPTS: Omit<DatasetPrompt, 'id'>[] = [
  { category: 'face-closeup', tags: 'close-up portrait, looking directly at camera, soft natural smile, white fitted t-shirt, warm indoor lighting from window, neutral blurred background', description: 'Front-facing smile indoor' },
  { category: 'face-closeup', tags: 'close-up portrait, three-quarter view facing left, serious composed expression, black blazer over white blouse, soft studio lighting, clean background', description: '3/4 left serious' },
  { category: 'face-closeup', tags: 'close-up portrait, three-quarter view facing right, genuine laugh with teeth showing, ankara-print off-shoulder top, golden hour sunlight, outdoor park background blurred', description: '3/4 right laughing' },
  { category: 'face-closeup', tags: 'close-up portrait, slight upward angle, contemplative expression looking away, olive green tank top, dramatic side lighting, dark background', description: 'Low angle contemplative' },
  { category: 'face-closeup', tags: 'close-up portrait, looking down with a private smile, rust turtleneck, soft diffused lighting, cafe interior blurred background', description: 'Downward gaze cafe' },
  { category: 'face-closeup', tags: 'close-up portrait, intense eye contact with camera, confident expression, denim jacket, warm amber lamp light, evening atmosphere', description: 'Intense evening' },
  { category: 'face-closeup', tags: 'close-up portrait, head slightly tilted, relaxed genuine smile, floral summer dress, bright natural daylight, white wall background', description: 'Tilted daylight' },
  { category: 'face-closeup', tags: 'close-up portrait, looking over shoulder toward camera, enigmatic expression, grey hoodie, cool blue-toned lighting, modern interior', description: 'Over shoulder cool light' },
  { category: 'face-closeup', tags: 'close-up portrait, front-facing, neutral resting expression, casual t-shirt, overcast outdoor lighting, urban street background blurred', description: 'Neutral overcast urban' },
  { category: 'face-closeup', tags: 'close-up portrait, slight profile view, joyful expression, off-shoulder knit sweater, warm sunset backlighting creating rim light on hair, outdoor', description: 'Profile sunset rim light' },
];

// ── Head-and-Shoulders Prompts ──

const HEAD_PROMPTS: Omit<DatasetPrompt, 'id'>[] = [
  { category: 'head-shoulders', tags: 'head and shoulders portrait, white button-up blouse, composed expression, soft window light from left, home interior', description: 'Blouse window light' },
  { category: 'head-shoulders', tags: 'head and shoulders portrait, casual t-shirt, warm genuine smile, bright natural daylight, outdoor garden background', description: 'Casual outdoor smile' },
  { category: 'head-shoulders', tags: 'head and shoulders portrait, fitted blazer over dark top, professional confident expression, office lighting, modern workspace', description: 'Professional blazer' },
  { category: 'head-shoulders', tags: 'head and shoulders portrait, off-shoulder knit sweater, relaxed expression, warm lamplight, cozy living room evening', description: 'Off-shoulder evening' },
  { category: 'head-shoulders', tags: 'head and shoulders portrait, gold necklace and earrings, poised expression, dramatic single-source lighting, dark background', description: 'Jewelry dramatic light' },
  { category: 'head-shoulders', tags: 'head and shoulders portrait, denim jacket, laughing with head tilted back, golden hour outdoor lighting, street background', description: 'Denim jacket golden hour' },
  { category: 'head-shoulders', tags: 'head and shoulders portrait, elegant dress with thin straps, looking to the side, candle-like warm lighting, restaurant interior', description: 'Elegant restaurant' },
  { category: 'head-shoulders', tags: 'head and shoulders portrait, sporty tank top, determined focused expression, bright gym lighting, gym interior', description: 'Sporty gym' },
];

// ── Full-Body Prompts (Female) ──

const FEMALE_BODY_PROMPTS: Omit<DatasetPrompt, 'id'>[] = [
  { category: 'full-body', tags: 'full body portrait head to toe, standing confidently, fitted mini dress and heels, hand on hip, warm studio lighting, clean background', description: 'Standing studio dress' },
  { category: 'full-body', tags: 'full body portrait head to toe, walking pose, high-waisted jeans and crop top, sneakers, golden hour street lighting, urban sidewalk', description: 'Walking urban golden hour' },
  { category: 'full-body', tags: 'full body portrait head to toe, leaning against wall, bodycon skirt and fitted top, arms crossed, dramatic side lighting, alley with warm light', description: 'Leaning dramatic light' },
  { category: 'full-body', tags: 'full body portrait head to toe, seated on wooden chair, wrap dress, legs crossed, warm restaurant ambient light, restaurant interior', description: 'Seated restaurant wrap dress' },
  { category: 'full-body', tags: 'full body portrait head to toe, casual standing pose, leggings and oversized hoodie, natural daylight, park with trees background', description: 'Casual park daylight' },
  { category: 'full-body', tags: 'full body portrait head to toe, standing with weight on one leg, pencil skirt and blouse, heels, bright office lighting, modern office', description: 'Office professional' },
  { category: 'full-body', tags: 'full body portrait head to toe, sitting on edge of bed, silk camisole and shorts, soft bedside lamp light, bedroom interior', description: 'Seated bedroom intimate' },
  { category: 'full-body', tags: 'full body portrait head to toe, standing confidently, summer dress and sandals, bright midday sun, outdoor garden setting', description: 'Summer dress garden' },
  { category: 'full-body', tags: 'full body portrait head to toe, posed against car, jeans and tank top, evening amber streetlight, parking lot at dusk', description: 'Car pose dusk' },
  { category: 'full-body', tags: 'full body portrait head to toe, dancing pose with arms raised, cocktail dress, club-style colored lighting, nightlife interior', description: 'Dancing nightlife' },
];

// ── Full-Body Prompts (Male) ──

const MALE_BODY_PROMPTS: Omit<DatasetPrompt, 'id'>[] = [
  { category: 'full-body', tags: 'full body portrait head to toe, standing tall, fitted henley shirt and jeans, boots, warm studio lighting, clean background', description: 'Standing studio casual' },
  { category: 'full-body', tags: 'full body portrait head to toe, walking confidently, chinos and polo shirt, bright golden hour street lighting, urban sidewalk', description: 'Walking golden hour' },
  { category: 'full-body', tags: 'full body portrait head to toe, leaning against car, white t-shirt and work overalls at waist, amber streetlight, workshop exterior evening', description: 'Leaning car workshop' },
  { category: 'full-body', tags: 'full body portrait head to toe, seated relaxed, v-neck shirt and trousers, warm ambient light, restaurant interior', description: 'Seated restaurant' },
  { category: 'full-body', tags: 'full body portrait head to toe, standing with arms crossed, compression shirt and joggers, bright gym lighting, gym interior', description: 'Gym athletic' },
  { category: 'full-body', tags: 'full body portrait head to toe, casual stance, button-up shirt sleeves rolled and jeans, natural daylight, outdoor park', description: 'Casual park daylight' },
  { category: 'full-body', tags: 'full body portrait head to toe, standing confidently, fitted suit no tie top button open, dramatic office lighting, modern office', description: 'Suit office' },
  { category: 'full-body', tags: 'full body portrait head to toe, seated on porch step, tank top and shorts, warm afternoon light, residential exterior', description: 'Porch afternoon' },
  { category: 'full-body', tags: 'full body portrait head to toe, standing at workbench, work shirt and jeans, fluorescent workshop lighting, garage workshop interior', description: 'Workshop working' },
  { category: 'full-body', tags: 'full body portrait head to toe, walking pose, leather jacket and dark jeans, cool evening blue-hour lighting, city street', description: 'Leather jacket evening' },
];

// ── Waist-Up Prompts ──

const WAIST_UP_PROMPTS: Omit<DatasetPrompt, 'id'>[] = [
  { category: 'waist-up', tags: 'waist-up medium shot, arms crossed, fitted top, indoor warm lighting, living room background', description: 'Arms crossed living room' },
  { category: 'waist-up', tags: 'waist-up medium shot, hand on chin thoughtful pose, casual shirt, natural outdoor cafe light, cafe terrace', description: 'Thoughtful cafe' },
  { category: 'waist-up', tags: 'waist-up medium shot, leaning forward engaged, professional attire, bright office lighting, modern workspace', description: 'Office engaged' },
  { category: 'waist-up', tags: 'waist-up medium shot, relaxed seated pose, casual loungewear, soft bedside lamp, bedroom evening', description: 'Relaxed bedroom evening' },
  { category: 'waist-up', tags: 'waist-up medium shot, holding coffee cup, sweater, warm morning light from window, kitchen interior', description: 'Morning coffee kitchen' },
  { category: 'waist-up', tags: 'waist-up medium shot, gesturing while talking, stylish blouse, restaurant pendant lighting, dinner setting', description: 'Animated restaurant' },
];

/**
 * Build the full set of dataset prompts for a character.
 */
export function buildDatasetPrompts(char: DatasetCharacter): DatasetPrompt[] {
  const bodyPrompts = char.gender === 'female' ? FEMALE_BODY_PROMPTS : MALE_BODY_PROMPTS;

  const allPromptDefs = [
    ...FACE_PROMPTS,
    ...HEAD_PROMPTS,
    ...bodyPrompts,
    ...WAIST_UP_PROMPTS,
  ];

  return allPromptDefs.map((def, i) => ({
    ...def,
    id: `ds_${def.category}_${i}`,
  }));
}

/**
 * Build a ComfyUI workflow for a single dataset training image.
 */
export function buildDatasetWorkflow(opts: {
  character: DatasetCharacter;
  prompt: DatasetPrompt;
  seed: number;
}): { workflow: Record<string, any>; positivePrompt: string; negativePrompt: string } {
  const identityDesc = buildIdentityDescription(opts.character);
  const qualityPrefix = buildQualityPrefix('sfw');

  // Add hourglass trigger word for female body/waist shots to activate the LoRA
  const needsBodyLoRA = opts.character.gender === 'female' &&
    (opts.prompt.category === 'full-body' || opts.prompt.category === 'waist-up');
  const bodyTrigger = '';
  const positivePrompt = `${qualityPrefix}, ${identityDesc}, ${bodyTrigger}${opts.prompt.tags}`;
  let negativePrompt = buildNegativePrompt('sfw');

  // Add gender-specific negative tags to prevent gender confusion
  if (opts.character.gender === 'male') {
    negativePrompt += ', 1girl, female, feminine, breasts, lipstick, long eyelashes';
  } else {
    negativePrompt += ', 1boy, masculine, beard, stubble, flat chest';
  }

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

  // Body shape LoRA stack for female body/waist shots — trains curves into the character LoRA.
  const loras = needsBodyLoRA ? [
    // { filename: 'Body_weight_slider_ILXL.safetensors', strengthModel: 1.7, strengthClip: 1.0 },
    { filename: 'Bubble Butt_alpha1.0_rank4_noxattn_last.safetensors', strengthModel: 1.4, strengthClip: 1.0 },
    { filename: 'Breast Slider - SDXL_alpha1.0_rank4_noxattn_last.safetensors', strengthModel: 1.2, strengthClip: 1.0 },
  ] : undefined;

  const workflow = buildWorkflow({
    positivePrompt,
    negativePrompt,
    width,
    height,
    seed: opts.seed,
    filenamePrefix: `dataset_${opts.prompt.id}`,
    loras,
  });

  return { workflow, positivePrompt, negativePrompt };
}

// ── Orchestration ──

interface DatasetDeps {
  supabase: {
    from: (table: string) => any;
    storage: { from: (bucket: string) => any };
  };
}

/**
 * Generate a full training dataset using Juggernaut Ragnarok via RunPod/ComfyUI.
 * Produces 24 images across face, head-shoulders, full-body, and waist-up categories.
 * Returns the same DatasetGenerationResult shape as the Flux generator.
 */
export async function generateDataset(
  character: CharacterInput,
  loraId: string,
  deps: DatasetDeps,
): Promise<DatasetGenerationResult> {
  const endpointId = process.env.RUNPOD_ENDPOINT_ID;
  if (!endpointId) {
    throw new Error('Missing RUNPOD_ENDPOINT_ID — required for dataset generation');
  }

  const datasetChar: DatasetCharacter = {
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

  const prompts = buildDatasetPrompts(datasetChar);
  const imageRecords: LoraDatasetImageRow[] = [];
  const failedPrompts: DatasetGenerationResult['failedPrompts'] = [];

  // Resumability: check which prompts already have images in the DB
  const { data: existingImages } = await deps.supabase
    .from('lora_dataset_images')
    .select('prompt_template')
    .eq('lora_id', loraId);
  const existingPromptIds = new Set((existingImages || []).map((r: any) => r.prompt_template));

  const remaining = prompts.filter(p => !existingPromptIds.has(p.id));
  console.log(`[Dataset] ${prompts.length} total prompts, ${existingPromptIds.size} already generated, ${remaining.length} remaining for ${character.characterName}`);

  for (let i = 0; i < remaining.length; i++) {
    const prompt = remaining[i];
    const originalIndex = prompts.indexOf(prompt);
    const seed = (character.portraitSeed || 42) + originalIndex;

    try {
      console.log(`[Dataset] ${existingPromptIds.size + i + 1}/${prompts.length}: ${prompt.description} (${prompt.category})`);

      const { workflow, positivePrompt } = buildDatasetWorkflow({
        character: datasetChar,
        prompt,
        seed,
      });

      const { jobId } = await submitRunPodJob(workflow, undefined, undefined, endpointId);
      const { imageBase64 } = await waitForRunPodResult(jobId, 300000, 3000, endpointId);

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
      console.error(`[Dataset] Failed ${prompt.id}: ${err}`);
      failedPrompts.push({
        promptTemplate: prompt.id,
        variationType: inferVariationType(prompt),
        source: 'comfyui' as const,
      });
    }
  }

  const totalGenerated = existingPromptIds.size + imageRecords.length;
  console.log(
    `[Dataset] Complete: ${totalGenerated} total images (${existingPromptIds.size} existing + ${imageRecords.length} new), ${failedPrompts.length} failed`,
  );

  return {
    totalGenerated,
    imageRecords,
    failedPrompts,
  };
}

function inferVariationType(prompt: DatasetPrompt): VariationType {
  const desc = prompt.description.toLowerCase();
  if (desc.includes('angle') || desc.includes('profile') || desc.includes('3/4')) return 'angle';
  if (desc.includes('laugh') || desc.includes('smile') || desc.includes('confident') || desc.includes('vulnerable') || desc.includes('joy')) return 'expression';
  if (desc.includes('blazer') || desc.includes('casual') || desc.includes('dress') || desc.includes('print')) return 'clothing';
  if (desc.includes('studio') || desc.includes('golden') || desc.includes('dramatic') || desc.includes('outdoor')) return 'lighting';
  return 'framing';
}
