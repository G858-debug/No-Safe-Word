/**
 * Pony V6 / CyberRealistic Pony LoRA registry for the V4 (pony_cyberreal) pipeline.
 *
 * These LoRAs are SDXL-compatible and loaded by CyberRealistic Pony v17.
 * Unlike Flux LoRAs (which use prose prompts), Pony LoRAs use booru-style tags.
 *
 * Character LoRAs are managed via the existing `character_loras` table and
 * `buildCharacterLoraEntry()` from lora-registry.ts (model-agnostic).
 */

import type { LoraEntry, ContentMode, LoraCategory } from './lora-registry';

// ---- Pony/SDXL style LoRAs — loaded from /runpod-volume/models/loras/ ----
// Populate after verifying filenames exist in the Pony Docker image.
export const PONY_LORA_REGISTRY: LoraEntry[] = [
  // Placeholder — add verified SDXL/Pony LoRAs here after testing.
  // Example entries (DO NOT enable until filenames are confirmed on the endpoint):
  //
  // {
  //   name: 'Pony Detail Enhancer',
  //   filename: 'pony-detail-enhancer.safetensors',
  //   category: 'detail',
  //   defaultStrength: 0.5,
  //   clipStrength: 0.5,
  //   description: 'Detail enhancement for CyberRealistic Pony',
  //   compatibleWith: ['sfw', 'nsfw'],
  //   installed: false,
  //   genderCategory: 'neutral',
  // },
];

/** Filter registry by gender */
export function getPonyLoras(gender?: 'male' | 'female' | 'neutral'): LoraEntry[] {
  if (!gender) return PONY_LORA_REGISTRY.filter((l) => l.installed);
  return PONY_LORA_REGISTRY.filter(
    (l) => l.installed && (!l.genderCategory || l.genderCategory === gender || l.genderCategory === 'neutral'),
  );
}

export interface PonyResourceSelection {
  loras: Array<{ filename: string; strengthModel: number; strengthClip: number }>;
  triggerWords: string[];
}

/**
 * Select style LoRAs for a Pony scene.
 *
 * Currently returns an empty selection since no Pony style LoRAs are verified yet.
 * Character LoRAs are handled separately by the scene generation function.
 */
export function selectPonyResources(opts: {
  gender: 'male' | 'female';
  secondaryGender?: 'male' | 'female';
  isSfw: boolean;
  imageType: string;
  prompt: string;
  hasDualCharacter: boolean;
  primaryEthnicity?: string;
}): PonyResourceSelection {
  const loras: PonyResourceSelection['loras'] = [];
  const triggerWords: string[] = [];

  const mode: ContentMode = opts.isSfw ? 'sfw' : 'nsfw';

  // Select installed LoRAs compatible with current mode and gender
  const available = PONY_LORA_REGISTRY.filter(
    (l) =>
      l.installed &&
      l.compatibleWith.includes(mode) &&
      (!l.genderCategory || l.genderCategory === opts.gender || l.genderCategory === 'neutral'),
  );

  for (const lora of available) {
    loras.push({
      filename: lora.filename,
      strengthModel: lora.defaultStrength,
      strengthClip: lora.clipStrength,
    });
    if (lora.triggerWord) {
      triggerWords.push(lora.triggerWord);
    }
  }

  return { loras, triggerWords };
}
