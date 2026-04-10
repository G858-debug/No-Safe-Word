/**
 * Scene type profiles for the image generation pipeline.
 *
 * Different scene types (solo portrait, dual-character interaction, etc.) need
 * different generation defaults. This module replaces hardcoded values with
 * composition-aware profiles that can be adjusted per-retry by the evaluation pipeline.
 */

// ── Types ──

export type CompositionType = 'solo' | '1boy_1girl' | '1girl_1girl' | '1boy_1boy' | 'group';

export interface SceneProfile {
  compositionType: CompositionType;
  contentMode: 'sfw' | 'nsfw';
  /** LoRA strength applied to the U-Net model weights (controls visual identity) */
  charLoraStrengthModel: number;
  /** LoRA strength applied to the CLIP text encoder (lower = better prompt adherence) */
  charLoraStrengthClip: number;
  cfg: number;
  steps: number;
  /** Regional conditioning overlap in pixels (dual-character only) */
  regionalOverlap: number;
  /** Regional conditioning strength (dual-character only) */
  regionalStrength: number;
  /** Override specific style LoRA strengths by filename */
  loraOverrides: Record<string, number>;
}

// ── Default Profiles ──

const SOLO_DEFAULTS: Omit<SceneProfile, 'compositionType' | 'contentMode'> = {
  charLoraStrengthModel: 0.8,
  charLoraStrengthClip: 0.55,
  cfg: 5.0,
  steps: 30,
  regionalOverlap: 0,
  regionalStrength: 0,
  loraOverrides: {},
};

const DUAL_DEFAULTS: Omit<SceneProfile, 'compositionType' | 'contentMode'> = {
  charLoraStrengthModel: 0.75,
  charLoraStrengthClip: 0.5,
  cfg: 5.0,
  steps: 35,
  regionalOverlap: 64,
  regionalStrength: 1.0,
  // Style LoRA overrides removed — Juggernaut Ragnarok uses no style LoRAs.
  // Only character LoRAs are injected at inference time.
  loraOverrides: {},
};

// ── Profile Resolution ──

/**
 * Get the default scene profile for a given composition type and content mode.
 */
export function getDefaultProfile(
  compositionType: CompositionType,
  contentMode: 'sfw' | 'nsfw',
): SceneProfile {
  const isDual = compositionType !== 'solo';
  const base = isDual ? DUAL_DEFAULTS : SOLO_DEFAULTS;
  const profile = { ...base, compositionType, contentMode };

  // NSFW dual-character scenes need a much larger regional overlap so characters
  // can physically interact/overlap while still having spatial identity guidance.
  if (isDual && contentMode === 'nsfw') {
    profile.regionalOverlap = 200;
  }

  return profile;
}

/**
 * Derive the composition type from character genders.
 */
export function deriveCompositionType(
  primaryGender: 'male' | 'female',
  secondaryGender?: 'male' | 'female',
): CompositionType {
  if (!secondaryGender) return 'solo';
  const sorted = [primaryGender, secondaryGender].sort();
  if (sorted[0] === 'female' && sorted[1] === 'male') return '1boy_1girl';
  if (sorted[0] === 'female' && sorted[1] === 'female') return '1girl_1girl';
  if (sorted[0] === 'male' && sorted[1] === 'male') return '1boy_1boy';
  return 'solo';
}

/**
 * Derive content mode from the image_type field in story_image_prompts.
 */
export function deriveContentMode(imageType: string): 'sfw' | 'nsfw' {
  // facebook_sfw is the only SFW type — all website content is NSFW
  return imageType === 'facebook_sfw' ? 'sfw' : 'nsfw';
}

/**
 * Apply partial overrides to a scene profile (used by retry strategy).
 * Returns a new profile with the overrides merged.
 */
export function applyProfileOverrides(
  base: SceneProfile,
  overrides: Partial<Omit<SceneProfile, 'compositionType' | 'contentMode'>>,
): SceneProfile {
  return {
    ...base,
    ...overrides,
    loraOverrides: {
      ...base.loraOverrides,
      ...overrides.loraOverrides,
    },
  };
}
