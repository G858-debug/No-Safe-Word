import type { SceneClassification, ImageType } from './scene-classifier';

export interface DimensionPreset {
  name: string;
  width: number;
  height: number;
  description: string;
}

export const DIMENSION_PRESETS: Record<string, DimensionPreset> = {
  PORTRAIT_SOLO: {
    name: 'PORTRAIT_SOLO',
    width: 832,
    height: 1216,
    description: 'Single character, head/shoulders or medium shot — tall portrait orientation',
  },
  PORTRAIT_FULLBODY: {
    name: 'PORTRAIT_FULLBODY',
    width: 896,
    height: 1152,
    description: 'Single character full-body shot — slightly less tall to fit full figure',
  },
  TWO_SHOT_MEDIUM: {
    name: 'TWO_SHOT_MEDIUM',
    width: 1216,
    height: 832,
    description: 'Two characters, conversational/side-by-side — landscape for horizontal composition',
  },
  TWO_SHOT_INTIMATE: {
    name: 'TWO_SHOT_INTIMATE',
    width: 1024,
    height: 1024,
    description: 'Two characters, intimate/romantic — square for close framing',
  },
  ESTABLISHING_WIDE: {
    name: 'ESTABLISHING_WIDE',
    width: 1216,
    height: 832,
    description: 'Wide/establishing/panoramic shots — landscape for environmental scope',
  },
  DETAIL_CLOSEUP: {
    name: 'DETAIL_CLOSEUP',
    width: 1024,
    height: 1024,
    description: 'Detail shots, extreme close-ups, macro — square for focused subject',
  },
  ENVIRONMENTAL: {
    name: 'ENVIRONMENTAL',
    width: 1216,
    height: 832,
    description: 'No characters, environmental/scene-setting — landscape for spatial context',
  },
};

const FULLBODY_KEYWORDS = /\b(full body|full-body|head to toe|standing|walking|full length|full figure)\b/i;
const WIDE_KEYWORDS = /\b(wide|establishing|panoram|two-shot|two shot)\b/i;
const DETAIL_KEYWORDS = /\b(detail shot|extreme close|macro)\b/i;

/**
 * Select optimal image dimensions based on scene classification.
 *
 * Priority order:
 * 1. Detail/close-up → DETAIL_CLOSEUP (square)
 * 2. Wide/establishing keywords → ESTABLISHING_WIDE (landscape)
 * 3. Two characters — intimate interaction → TWO_SHOT_INTIMATE (square)
 * 4. Two characters — other interaction → TWO_SHOT_MEDIUM (landscape)
 * 5. Single character — full-body keywords → PORTRAIT_FULLBODY
 * 6. Single character — default → PORTRAIT_SOLO
 * 7. No characters — ENVIRONMENTAL (landscape)
 * 8. Fallback → PORTRAIT_SOLO
 */
export function selectDimensions(
  classification: SceneClassification,
  imageType: ImageType,
  hasSecondaryCharacter: boolean,
): DimensionPreset {
  const prompt = ''; // We use classification fields, not raw prompt here
  const isDualCharacter = hasSecondaryCharacter || classification.characterCount >= 2;

  // 1. Detail/close-up shots
  if (classification.shotType === 'detail') {
    return DIMENSION_PRESETS.DETAIL_CLOSEUP;
  }

  // 2. Wide/establishing shots (detected by shotType from classifier)
  if (classification.shotType === 'wide') {
    return DIMENSION_PRESETS.ESTABLISHING_WIDE;
  }

  // 3-4. Two-character scenes
  if (isDualCharacter) {
    const intimate = classification.interactionType === 'intimate' || classification.interactionType === 'romantic';
    return intimate ? DIMENSION_PRESETS.TWO_SHOT_INTIMATE : DIMENSION_PRESETS.TWO_SHOT_MEDIUM;
  }

  // 5-6. Single character
  if (classification.characterCount === 1) {
    // Full-body detection needs the raw prompt, but shotType 'wide' already covers
    // "full body" from the classifier's WIDE_KEYWORDS. Default to portrait solo.
    return DIMENSION_PRESETS.PORTRAIT_SOLO;
  }

  // 7. No characters detected
  if (classification.characterCount === 0) {
    return DIMENSION_PRESETS.ENVIRONMENTAL;
  }

  // 8. Fallback
  return DIMENSION_PRESETS.PORTRAIT_SOLO;
}

/**
 * Overload that also accepts the raw prompt for full-body keyword detection
 * that the classifier's shotType may not capture (e.g. "standing" is in
 * WIDE_KEYWORDS for the classifier but semantically is a full-body single shot).
 */
export function selectDimensionsFromPrompt(
  classification: SceneClassification,
  imageType: ImageType,
  hasSecondaryCharacter: boolean,
  prompt: string,
): DimensionPreset {
  const promptLower = prompt.toLowerCase();
  const isDualCharacter = hasSecondaryCharacter || classification.characterCount >= 2;

  // 1. Detail/close-up shots
  if (DETAIL_KEYWORDS.test(promptLower) || classification.shotType === 'detail') {
    return DIMENSION_PRESETS.DETAIL_CLOSEUP;
  }

  // 2. Wide/establishing shots
  if (WIDE_KEYWORDS.test(promptLower) || classification.shotType === 'wide') {
    return DIMENSION_PRESETS.ESTABLISHING_WIDE;
  }

  // 3-4. Two-character scenes
  if (isDualCharacter) {
    const intimate = classification.interactionType === 'intimate' || classification.interactionType === 'romantic';
    return intimate ? DIMENSION_PRESETS.TWO_SHOT_INTIMATE : DIMENSION_PRESETS.TWO_SHOT_MEDIUM;
  }

  // 5-6. Single character
  if (classification.characterCount === 1) {
    if (FULLBODY_KEYWORDS.test(promptLower)) {
      return DIMENSION_PRESETS.PORTRAIT_FULLBODY;
    }
    return DIMENSION_PRESETS.PORTRAIT_SOLO;
  }

  // 7. No characters detected
  if (classification.characterCount === 0) {
    return DIMENSION_PRESETS.ENVIRONMENTAL;
  }

  // 8. Fallback
  return DIMENSION_PRESETS.PORTRAIT_SOLO;
}
