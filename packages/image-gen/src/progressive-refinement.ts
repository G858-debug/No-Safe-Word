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
 * Returns fixed generation parameters based on the best-performing settings
 * found during testing (originally "Regen 2" from the progressive system).
 *
 * CFG 7.5, skin LoRA ×1.13, dark skin boost +0.2 for Black/African males.
 * No escalation across regenerations — users adjust prompts directly.
 */
export function getProgressiveAdjustments(
  _regenCount: number,
  _classification: SceneClassification,
  character: CharacterData,
): ProgressiveAdjustments {
  const isDarkSkinSubject =
    character.gender === 'male' &&
    /\b(?:Black|African)\b/i.test(character.ethnicity);

  return {
    cfg: 7.5,
    samplerName: null,
    seedStrategy: 'random',
    seedRange: 0,
    skinLoraMultiplier: 1.13,
    darkSkinBoost: isDarkSkinSubject ? 0.2 : 0,
    promptSuffix: '',
    reason: `Fixed baseline: CFG 7.5, skin LoRA ×1.13${isDarkSkinSubject ? ', dark skin +0.2' : ''}`,
  };
}
