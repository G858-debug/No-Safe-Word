import type { SceneClassification } from './scene-classifier';
import type { CharacterData } from '@no-safe-word/shared';

export interface ProgressiveAdjustments {
  /** Adjusted CFG scale */
  cfg: number;
  /** Sampler override (null = keep default) */
  samplerName: string | null;
  /** Seed strategy: 'nearby' uses prevSeed ± range, 'random' uses a fresh seed */
  seedStrategy: 'nearby' | 'random';
  /** Range for nearby seed computation */
  seedRange: number;
  /** Multiplier for skin LoRA strength (1.0 = no change) */
  skinLoraMultiplier: number;
  /** Dark skin emphasis boost (0 = no change, added to existing weights) */
  darkSkinBoost: number;
  /** Extra positive prompt suffix to append (empty string = nothing) */
  promptSuffix: string;
  /** Human-readable explanation of adjustments for logging */
  reason: string;
}

/**
 * Compute a nearby seed based on a previous seed and a range.
 * Offsets by ±range with uniform distribution, clamped to valid ComfyUI range.
 */
export function computeNearbySeed(prevSeed: number, range: number): number {
  const maxSeed = 2 ** 32 - 1;
  const offset = Math.floor(Math.random() * (range * 2 + 1)) - range;
  const newSeed = prevSeed + offset;
  // Clamp to valid range and avoid identical seed
  const clamped = Math.max(0, Math.min(maxSeed, newSeed));
  return clamped === prevSeed ? (prevSeed + range) % maxSeed : clamped;
}

/**
 * Boost dark skin emphasis weights in a prompt string.
 * Finds existing (very dark skin:X.X) and (deep rich dark brown skin:X.X) tags
 * and increases their weights by the specified boost amount.
 */
export function applyDarkSkinWeightBoost(prompt: string, boost: number): string {
  if (boost <= 0) return prompt;

  return prompt.replace(
    /\((very dark skin|deep rich dark brown skin|deep melanin complexion|African man):(\d+\.?\d*)\)/g,
    (_match, tag, weight) => {
      const boosted = Math.min(parseFloat(weight) + boost, 2.0);
      return `(${tag}:${boosted.toFixed(1)})`;
    }
  );
}

/**
 * Get progressive parameter adjustments based on how many times a portrait
 * has been regenerated. Each regeneration applies increasingly aggressive
 * changes to break out of repetitive failure patterns.
 *
 * Regen 0: No adjustments (first generation)
 * Regen 1: Slight CFG reduction (6.5), nearby seed for variation
 * Regen 2: Higher CFG (7.5), wider seed range, boost skin LoRA, boost dark skin if applicable
 * Regen 3+: Switch sampler, CFG 8, append photographic tag, max skin/dark-skin boosts
 */
export function getProgressiveAdjustments(
  regenCount: number,
  classification: SceneClassification,
  character: CharacterData,
): ProgressiveAdjustments {
  const isDarkSkinSubject =
    character.gender === 'male' &&
    /\b(?:Black|African)\b/i.test(character.ethnicity);

  // First generation — no adjustments
  if (regenCount <= 0) {
    return {
      cfg: 7,
      samplerName: null,
      seedStrategy: 'random',
      seedRange: 0,
      skinLoraMultiplier: 1.0,
      darkSkinBoost: 0,
      promptSuffix: '',
      reason: 'First generation — default parameters',
    };
  }

  // Regen 1: gentle variation
  if (regenCount === 1) {
    return {
      cfg: 6.5,
      samplerName: null,
      seedStrategy: 'nearby',
      seedRange: 100,
      skinLoraMultiplier: 1.0,
      darkSkinBoost: 0,
      promptSuffix: '',
      reason: 'Regen 1: CFG 6.5, nearby seed (±100)',
    };
  }

  // Regen 2: stronger push
  if (regenCount === 2) {
    return {
      cfg: 7.5,
      samplerName: null,
      seedStrategy: 'nearby',
      seedRange: 500,
      skinLoraMultiplier: 1.13,
      darkSkinBoost: isDarkSkinSubject ? 0.2 : 0,
      promptSuffix: '',
      reason: `Regen 2: CFG 7.5, wider seed (±500), skin LoRA ×1.13${isDarkSkinSubject ? ', dark skin +0.2' : ''}`,
    };
  }

  // Regen 3+: aggressive changes
  return {
    cfg: 8,
    samplerName: 'dpmpp_2m',
    seedStrategy: 'nearby',
    seedRange: 1000,
    skinLoraMultiplier: 1.2,
    darkSkinBoost: isDarkSkinSubject ? 0.3 : 0,
    promptSuffix: '(photographic:1.2)',
    reason: `Regen ${regenCount}: CFG 8, dpmpp_2m sampler, skin LoRA ×1.2${isDarkSkinSubject ? ', dark skin +0.3' : ''}, +photographic`,
  };
}
