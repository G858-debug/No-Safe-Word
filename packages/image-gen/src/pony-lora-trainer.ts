/**
 * Character LoRA training helpers for Pony V6 / CyberRealistic Pony.
 *
 * TRAINING PIPELINE (manual for now — automation is a follow-up):
 * 1. Generate 40-60 character images using CyberRealistic Pony with detailed booru tags
 * 2. Curate down to 15-20 best images (consistent face, build, skin tone)
 * 3. Auto-tag with WD Tagger 1.4
 * 4. Remove identity tags (hair color, body type, skin tone) — let trigger word carry these
 * 5. Train LoRA via Kohya SS on RunPod GPU pod (not serverless)
 *    - Base model: CyberRealisticPony_v17 or ponyDiffusionV6XL
 *    - Network dim: 8, alpha: 8
 *    - Optimizer: Prodigy or AdaFactor with cosine restarts
 *    - Noise offset: 0.03
 *    - Epochs: 10-15
 *    - Resolution: 1024x1024
 *    - Clip skip: 2
 * 6. Upload trained .safetensors to Supabase Storage
 * 7. Update character_loras table: storage_url, trigger_word, status = 'deployed'
 *
 * ALTERNATIVE TRAINING OPTIONS:
 * - Civitai on-site trainer (~500 Buzz, select Pony V6 XL as base)
 * - Replicate (if SDXL LoRA trainer available)
 */

export interface PonyLoraTrainingConfig {
  characterId: string;
  triggerWord: string;
  baseModel: 'ponyDiffusionV6XL' | 'CyberRealisticPony_v17';
  networkDim: number;
  networkAlpha: number;
  epochs: number;
  noiseOffset: number;
  resolution: number;
  clipSkip: number;
}

/**
 * Generate recommended training config for a character.
 * The trigger word is derived from the character name with a project suffix.
 */
export function getRecommendedTrainingConfig(characterName: string): PonyLoraTrainingConfig {
  const trigger = characterName.toLowerCase().replace(/\s+/g, '_') + '_nsw';

  return {
    characterId: '', // Set by caller
    triggerWord: trigger,
    baseModel: 'CyberRealisticPony_v17',
    networkDim: 8,
    networkAlpha: 8,
    epochs: 12,
    noiseOffset: 0.03,
    resolution: 1024,
    clipSkip: 2,
  };
}

/**
 * Tags to REMOVE from training dataset captions so the LoRA learns to
 * associate them with the trigger word instead of explicit tags.
 */
export function getIdentityTagsToRemove(characterData: {
  hairColor: string;
  hairStyle: string;
  eyeColor: string;
  skinTone: string;
  bodyType: string;
  ethnicity: string;
}): string[] {
  return [
    `${characterData.hairColor} hair`,
    characterData.hairStyle,
    `${characterData.eyeColor} eyes`,
    `${characterData.skinTone} skin`,
    'dark skin',
    'dark-skinned female',
    'dark-skinned male',
    'curvy',
    'wide hips',
    'thick thighs',
    'large breasts',
    'voluptuous',
    'african',
    'black',
    characterData.ethnicity.toLowerCase(),
  ].filter(Boolean);
}
