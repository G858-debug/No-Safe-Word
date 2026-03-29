/**
 * Training Image Evaluator for Pony V6 Character LoRAs.
 *
 * IMPORTANT: Read docs/skills/pony-lora-training/SKILL.md before modifying this file.
 *
 * This module provides evaluation criteria for curating character LoRA training datasets.
 * It is used during the dataset generation → curation pipeline to score and filter
 * candidate images.
 */

/** Evaluation dimensions for a single training image candidate */
export interface TrainingImageEvaluation {
  /** Unique ID or filename of the candidate image */
  imageId: string;

  /** Hard requirements — if any are false, the image is rejected */
  requirements: {
    faceVisible: boolean;         // Face is clearly visible and well-defined
    correctSkinTone: boolean;     // Skin tone matches character specification
    noAnatomyErrors: boolean;     // No extra fingers, distorted limbs, etc.
    correctBodyProportions: boolean; // Body shape matches character spec
    imageSharp: boolean;          // Not blurry, no compression artifacts
  };

  /** Soft quality scores (0-10 scale) */
  quality: {
    expressionNatural: number;    // Expression looks natural, not uncanny
    poseNatural: number;          // Pose feels relaxed and believable
    lightingQuality: number;      // Lighting is flattering and well-defined
    backgroundClean: number;      // Background is not distracting
    hairAccurate: number;         // Hair style and color match character spec
    overallAesthetic: number;     // General visual quality / appeal
  };

  /** Diversity tags — used to ensure the final set covers all required variations */
  diversityTags: {
    angle: 'front' | 'three-quarter' | 'side-profile' | 'over-shoulder' | 'high-angle' | 'low-angle';
    framing: 'close-up' | 'upper-body' | 'medium-shot' | 'full-body';
    expression: 'neutral' | 'smiling' | 'serious' | 'suggestive' | 'other';
    lighting: 'daylight' | 'warm-indoor' | 'dramatic-side' | 'low-light';
    clothingState: 'formal' | 'casual' | 'revealing' | 'intimate';
  };
}

/** Minimum diversity requirements for a complete training set */
export const MINIMUM_DIVERSITY: Record<keyof TrainingImageEvaluation['diversityTags'], number> = {
  angle: 4,        // At least 4 different angles
  framing: 3,      // At least 3 different framings
  expression: 3,   // At least 3 different expressions
  lighting: 2,     // At least 2 different lighting conditions
  clothingState: 2, // At least 2 different clothing states
};

/** Minimum SFW/NSFW balance */
export const MINIMUM_SFW_IMAGES = 10;
export const MINIMUM_NSFW_ADJACENT_IMAGES = 5;

/**
 * Check if a single image passes all hard requirements.
 */
export function passesRequirements(evaluation: TrainingImageEvaluation): boolean {
  return Object.values(evaluation.requirements).every(Boolean);
}

/**
 * Calculate an overall quality score for sorting candidates.
 */
export function calculateQualityScore(evaluation: TrainingImageEvaluation): number {
  const weights = {
    expressionNatural: 1.5,   // Expression matters most
    poseNatural: 1.2,
    lightingQuality: 1.0,
    backgroundClean: 0.8,
    hairAccurate: 1.3,
    overallAesthetic: 1.0,
  };

  let weightedSum = 0;
  let totalWeight = 0;

  for (const [key, weight] of Object.entries(weights)) {
    weightedSum += evaluation.quality[key as keyof typeof evaluation.quality] * weight;
    totalWeight += weight;
  }

  return weightedSum / totalWeight;
}

/**
 * Check if a set of selected images meets minimum diversity requirements.
 * Returns missing diversity categories that need more images.
 */
export function checkDiversityCoverage(
  selected: TrainingImageEvaluation[]
): { met: boolean; missing: string[] } {
  const missing: string[] = [];

  for (const [dimension, minimum] of Object.entries(MINIMUM_DIVERSITY)) {
    const uniqueValues = new Set(
      selected.map(img => img.diversityTags[dimension as keyof TrainingImageEvaluation['diversityTags']])
    );
    if (uniqueValues.size < minimum) {
      missing.push(`${dimension}: need ${minimum} variations, have ${uniqueValues.size}`);
    }
  }

  // Check SFW/NSFW balance
  const sfwCount = selected.filter(img =>
    img.diversityTags.clothingState === 'formal' || img.diversityTags.clothingState === 'casual'
  ).length;
  const nsfwCount = selected.filter(img =>
    img.diversityTags.clothingState === 'revealing' || img.diversityTags.clothingState === 'intimate'
  ).length;

  if (sfwCount < MINIMUM_SFW_IMAGES) {
    missing.push(`SFW images: need ${MINIMUM_SFW_IMAGES}, have ${sfwCount}`);
  }
  if (nsfwCount < MINIMUM_NSFW_ADJACENT_IMAGES) {
    missing.push(`NSFW-adjacent images: need ${MINIMUM_NSFW_ADJACENT_IMAGES}, have ${nsfwCount}`);
  }

  return { met: missing.length === 0, missing };
}

/**
 * Given a list of evaluated candidates, select the optimal training set.
 *
 * Algorithm:
 * 1. Remove all images that fail hard requirements
 * 2. Sort remaining by quality score (descending)
 * 3. Greedily select images that add diversity until minimums are met
 * 4. Fill remaining slots (up to 20) with highest-quality remaining images
 * 5. Verify the "same person" visual consistency (flagged for human review)
 */
export function selectTrainingSet(
  candidates: TrainingImageEvaluation[],
  targetSize: number = 20
): {
  selected: TrainingImageEvaluation[];
  rejected: TrainingImageEvaluation[];
  diversityCoverage: ReturnType<typeof checkDiversityCoverage>;
  warnings: string[];
} {
  const warnings: string[] = [];

  // Step 1: Filter by hard requirements
  const passed = candidates.filter(passesRequirements);
  const failedRequirements = candidates.filter(c => !passesRequirements(c));

  if (passed.length < targetSize) {
    warnings.push(
      `Only ${passed.length} images pass requirements (need ${targetSize}). ` +
      `Generate more candidates or relax criteria.`
    );
  }

  // Step 2: Sort by quality
  const sorted = [...passed].sort((a, b) =>
    calculateQualityScore(b) - calculateQualityScore(a)
  );

  // Step 3: Greedy diversity-first selection
  const selected: TrainingImageEvaluation[] = [];
  const remaining = [...sorted];

  // First pass: ensure diversity minimums
  for (const [dimension, minimum] of Object.entries(MINIMUM_DIVERSITY)) {
    const currentValues = new Set(
      selected.map(img => img.diversityTags[dimension as keyof TrainingImageEvaluation['diversityTags']])
    );

    for (let i = remaining.length - 1; i >= 0; i--) {
      const candidate = remaining[i];
      const value = candidate.diversityTags[dimension as keyof TrainingImageEvaluation['diversityTags']];

      if (!currentValues.has(value) && selected.length < targetSize) {
        selected.push(candidate);
        remaining.splice(i, 1);
        currentValues.add(value);

        if (currentValues.size >= minimum) break;
      }
    }
  }

  // Step 4: Fill remaining slots with highest quality
  while (selected.length < targetSize && remaining.length > 0) {
    selected.push(remaining.shift()!);
  }

  const diversityCoverage = checkDiversityCoverage(selected);
  if (!diversityCoverage.met) {
    warnings.push(
      `Diversity gaps remain: ${diversityCoverage.missing.join('; ')}. ` +
      `Consider generating more candidates targeting these gaps.`
    );
  }

  return {
    selected,
    rejected: [...failedRequirements, ...remaining],
    diversityCoverage,
    warnings,
  };
}
