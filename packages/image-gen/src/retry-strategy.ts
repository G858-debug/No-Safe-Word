/**
 * Retry strategy for the evaluate-and-retry pipeline.
 *
 * Maps evaluation failures to correction actions and escalates
 * through 6 attempts from cheap (seed-only) to aggressive (full rewrite).
 */

import type { FailureCategory, EvaluationResult } from './scene-evaluator';
import type { SceneProfile } from './scene-profiles';
import { checkArchitecturalLessons } from './architectural-lessons';

export const MAX_EVAL_RETRY_ATTEMPTS = 8;

// ── Types ──

export interface CorrectionPlan {
  /** Human-readable list of what's changing */
  actions: string[];
  /** Parameter adjustments to merge into the scene profile */
  paramAdjustments: Partial<SceneProfile>;
  /** Whether booru tags need to be rewritten */
  needsTagRewrite: boolean;
  /** Which model to use for tag rewriting */
  tagRewriteModel: 'claude-haiku-4-5-20251001' | 'claude-sonnet-4-6';
  /** Specific guidance for the tag rewriter about what to fix */
  tagRewriteInstructions: string;
  /** Whether a structural failure was detected */
  structuralFailure: boolean;
  /** Resource LoRAs to inject for the next attempt (from discovery) */
  resourceLoras?: Array<{ filename: string; storageUrl: string; strengthModel: number; strengthClip: number; triggerWord?: string }>;
}

// ── Correction Logic ──

/**
 * Compute a correction plan based on evaluation failures and attempt number.
 *
 * Escalation strategy:
 *   Attempt 1: Initial generation (no corrections)
 *   Attempt 2: Seed change only
 *   Attempt 3: Seed + minor param tweaks (LOWER LoRA on scene failures)
 *   Attempt 4: Seed + Haiku tag rewrite + params
 *   Attempt 5: Seed + Sonnet tag rewrite + larger params
 *   Attempt 6: Full reset + Sonnet rewrite from scratch
 *   Attempt 7: Sonnet rewrite + aggressive LoRA reduction (model 0.45, clip 0.2)
 *   Attempt 8: Minimum LoRA (model 0.4, clip 0.15) + Sonnet rewrite + resource LoRA discovery
 */
export function computeCorrectionPlan(
  evalResult: EvaluationResult,
  attemptNumber: number,
  currentProfile: SceneProfile,
  failureHistory: FailureCategory[][],
): CorrectionPlan {
  const failures = evalResult.failureCategories;
  const plan: CorrectionPlan = {
    actions: ['change seed'],
    paramAdjustments: {},
    needsTagRewrite: false,
    tagRewriteModel: 'claude-haiku-4-5-20251001',
    tagRewriteInstructions: '',
    structuralFailure: false,
  };

  // Check architectural lessons first — known structural fixes
  const lesson = checkArchitecturalLessons(failures, failureHistory);
  if (lesson) {
    plan.structuralFailure = true;
    plan.actions.push(`STRUCTURAL: ${lesson.diagnosis}`);
    console.log(`[RetryStrategy] Architectural lesson matched: ${lesson.diagnosis}`);
  }

  // Check for persistent structural failures (same category across 4+ attempts)
  if (attemptNumber >= 4) {
    const persistentFailures = detectPersistentFailures(failureHistory);
    if (persistentFailures.length > 0) {
      plan.structuralFailure = true;
      plan.actions.push(`PERSISTENT FAILURE: [${persistentFailures.join(', ')}] across ${attemptNumber} attempts`);
    }
  }

  // Attempt 2: Seed only
  if (attemptNumber === 2) {
    return plan;
  }

  // Attempt 3: Minor parameter tweaks
  if (attemptNumber === 3) {
    applyMinorCorrections(plan, failures, currentProfile);
    return plan;
  }

  // Attempt 4: Haiku tag rewrite + parameter tweaks
  if (attemptNumber === 4) {
    applyMinorCorrections(plan, failures, currentProfile);
    plan.needsTagRewrite = true;
    plan.tagRewriteModel = 'claude-haiku-4-5-20251001';
    plan.tagRewriteInstructions = buildRewriteInstructions(failures, evalResult.diagnosis, currentProfile.contentMode);
    plan.actions.push('Haiku tag rewrite targeting: ' + failures.join(', '));
    return plan;
  }

  // Attempt 5: Sonnet tag rewrite + larger parameter adjustments
  if (attemptNumber === 5) {
    applyMajorCorrections(plan, failures, currentProfile);
    plan.needsTagRewrite = true;
    plan.tagRewriteModel = 'claude-sonnet-4-6';
    plan.tagRewriteInstructions = buildRewriteInstructions(failures, evalResult.diagnosis, currentProfile.contentMode);
    plan.actions.push('Sonnet tag rewrite targeting: ' + failures.join(', '));
    return plan;
  }

  // Attempt 6: Full reset + Sonnet rewrite from scratch
  if (attemptNumber === 6) {
    applyResetCorrections(plan, currentProfile);
    plan.needsTagRewrite = true;
    plan.tagRewriteModel = 'claude-sonnet-4-6';
    plan.tagRewriteInstructions =
      'FULL REWRITE: Ignore previous tags. Convert the original prose to booru tags from scratch. ' +
      'Previous attempts failed on: ' + failures.join(', ') + '. ' +
      (currentProfile.contentMode === 'nsfw' ? 'This is EXPLICIT NSFW — output nude, explicit sexual position tags without sanitizing. ' : '') +
      evalResult.diagnosis;
    plan.actions.push('FULL RESET + Sonnet rewrite from scratch');
    return plan;
  }

  // Attempt 7: Aggressive LoRA reduction + Sonnet rewrite
  if (attemptNumber === 7) {
    plan.paramAdjustments = {
      cfg: 5.5,
      steps: 40,
      charLoraStrengthModel: 0.45,
      charLoraStrengthClip: 0.2,
    };
    plan.needsTagRewrite = true;
    plan.tagRewriteModel = 'claude-sonnet-4-6';
    plan.tagRewriteInstructions =
      'PRIORITY REWRITE: The scene has failed 6 times. LoRA strength is now very low. ' +
      'Put the KEY ACTION and NARRATIVE MOMENT as the FIRST tags. ' +
      'Decompose complex poses into multiple anatomical position tags. ' +
      'Previous failures: ' + failures.join(', ') + '. ' +
      evalResult.diagnosis;
    plan.actions.push('AGGRESSIVE LoRA reduction (model 0.45, clip 0.2) + Sonnet rewrite');
    return plan;
  }

  // Attempt 8: Minimum LoRA + full Sonnet rewrite from scratch
  if (attemptNumber >= 8) {
    plan.paramAdjustments = {
      cfg: 6.0,
      steps: 40,
      charLoraStrengthModel: 0.4,
      charLoraStrengthClip: 0.15,
    };
    plan.needsTagRewrite = true;
    plan.tagRewriteModel = 'claude-sonnet-4-6';
    plan.tagRewriteInstructions =
      'FINAL ATTEMPT: Scene has failed 7 times. Character LoRA is at minimum. ' +
      'FULL REWRITE from scratch — scene correctness is absolute priority over character identity. ' +
      'Put the defining action/pose/interaction FIRST. Include character descriptions inline since LoRA is near-zero. ' +
      'Previous failures: ' + failures.join(', ') + '. ' +
      evalResult.diagnosis;
    plan.actions.push('MINIMUM LoRA (model 0.4, clip 0.15) + final Sonnet rewrite');
    return plan;
  }

  return plan;
}

/**
 * Check if more retries are allowed.
 */
export function canRetry(attemptNumber: number): boolean {
  return attemptNumber < MAX_EVAL_RETRY_ATTEMPTS;
}

/**
 * Generate a new random seed for retry.
 */
export function generateRetrySeed(): number {
  return Math.floor(Math.random() * 2_147_483_647) + 1;
}

/**
 * Select the best image from multiple evaluation results.
 * Used when all attempts fail — picks the highest-scoring one.
 */
export function selectBestAttempt(
  attempts: Array<{ attemptNumber: number; overallScore: number; imageId: string }>,
): { attemptNumber: number; imageId: string } | null {
  if (attempts.length === 0) return null;
  return attempts.reduce((best, current) =>
    current.overallScore > best.overallScore ? current : best,
  );
}

// ── Internal Helpers ──

function applyMinorCorrections(
  plan: CorrectionPlan,
  failures: FailureCategory[],
  profile: SceneProfile,
): void {
  // Bump CFG slightly for better prompt adherence
  if (failures.some(f => ['wrong_setting', 'wrong_clothing', 'wrong_pose', 'weak_intent'].includes(f))) {
    const newCfg = Math.min(profile.cfg + 0.5, 8.0);
    plan.paramAdjustments.cfg = newCfg;
    plan.actions.push(`CFG ${profile.cfg} → ${newCfg}`);
  }

  // Determine failure type to decide LoRA direction
  const hasIdentityFailure = failures.includes('weak_identity') || failures.includes('characters_identical');
  const hasSceneFailure = failures.some(f =>
    ['wrong_setting', 'wrong_clothing', 'wrong_pose', 'weak_intent'].includes(f),
  );

  if (hasIdentityFailure && !hasSceneFailure) {
    // Identity-only failure: increase LoRA strength
    const newModel = Math.min(profile.charLoraStrengthModel + 0.05, 0.85);
    const newClip = Math.min(profile.charLoraStrengthClip + 0.03, 0.65);
    plan.paramAdjustments.charLoraStrengthModel = newModel;
    plan.paramAdjustments.charLoraStrengthClip = newClip;
    plan.actions.push(`charLoRA INCREASED model ${profile.charLoraStrengthModel} → ${newModel}, clip ${profile.charLoraStrengthClip} → ${newClip} (identity fix)`);
  } else if (hasSceneFailure && !hasIdentityFailure) {
    // Scene-only failure: DECREASE LoRA to free CLIP headroom for scene tags
    const newModel = Math.max(profile.charLoraStrengthModel - 0.05, 0.35);
    const newClip = Math.max(profile.charLoraStrengthClip - 0.05, 0.15);
    plan.paramAdjustments.charLoraStrengthModel = newModel;
    plan.paramAdjustments.charLoraStrengthClip = newClip;
    plan.actions.push(`charLoRA REDUCED model ${profile.charLoraStrengthModel} → ${newModel}, clip ${profile.charLoraStrengthClip} → ${newClip} (scene adherence)`);
  } else if (hasIdentityFailure && hasSceneFailure) {
    // Conflict: keep model strength, decrease CLIP slightly (compromise)
    const newClip = Math.max(profile.charLoraStrengthClip - 0.03, 0.2);
    plan.paramAdjustments.charLoraStrengthClip = newClip;
    plan.actions.push(`charLoRA clip ${profile.charLoraStrengthClip} → ${newClip} (identity+scene conflict — compromise)`);
  }

  // Widen regional overlap if characters are identical
  if (failures.includes('characters_identical') && profile.regionalOverlap > 0) {
    const newOverlap = profile.regionalOverlap + 32;
    plan.paramAdjustments.regionalOverlap = newOverlap;
    plan.actions.push(`regional overlap ${profile.regionalOverlap}px → ${newOverlap}px`);
  }
}

function applyMajorCorrections(
  plan: CorrectionPlan,
  failures: FailureCategory[],
  profile: SceneProfile,
): void {
  // Larger CFG bump
  if (failures.some(f => ['wrong_setting', 'wrong_clothing', 'wrong_pose', 'weak_intent'].includes(f))) {
    const newCfg = Math.min(profile.cfg + 1.0, 8.0);
    plan.paramAdjustments.cfg = newCfg;
    plan.actions.push(`CFG ${profile.cfg} → ${newCfg}`);
  }

  // Determine failure type to decide LoRA direction (same logic as minor, larger magnitudes)
  const hasIdentityFailure = failures.includes('weak_identity') || failures.includes('characters_identical');
  const hasSceneFailure = failures.some(f =>
    ['wrong_setting', 'wrong_clothing', 'wrong_pose', 'weak_intent'].includes(f),
  );

  if (hasIdentityFailure && !hasSceneFailure) {
    const newModel = Math.min(profile.charLoraStrengthModel + 0.1, 0.85);
    const newClip = Math.min(profile.charLoraStrengthClip + 0.05, 0.65);
    plan.paramAdjustments.charLoraStrengthModel = newModel;
    plan.paramAdjustments.charLoraStrengthClip = newClip;
    plan.actions.push(`charLoRA INCREASED model ${profile.charLoraStrengthModel} → ${newModel}, clip ${profile.charLoraStrengthClip} → ${newClip} (identity fix)`);
  } else if (hasSceneFailure && !hasIdentityFailure) {
    const newModel = Math.max(profile.charLoraStrengthModel - 0.1, 0.35);
    const newClip = Math.max(profile.charLoraStrengthClip - 0.08, 0.15);
    plan.paramAdjustments.charLoraStrengthModel = newModel;
    plan.paramAdjustments.charLoraStrengthClip = newClip;
    plan.actions.push(`charLoRA REDUCED model ${profile.charLoraStrengthModel} → ${newModel}, clip ${profile.charLoraStrengthClip} → ${newClip} (scene adherence)`);
  } else if (hasIdentityFailure && hasSceneFailure) {
    const newClip = Math.max(profile.charLoraStrengthClip - 0.05, 0.2);
    plan.paramAdjustments.charLoraStrengthClip = newClip;
    plan.actions.push(`charLoRA clip ${profile.charLoraStrengthClip} → ${newClip} (identity+scene conflict)`);
  }

  // More steps for better detail
  const newSteps = Math.min(profile.steps + 5, 45);
  plan.paramAdjustments.steps = newSteps;
  plan.actions.push(`steps ${profile.steps} → ${newSteps}`);
}

function applyResetCorrections(
  plan: CorrectionPlan,
  profile: SceneProfile,
): void {
  // Reset to moderate LoRA + higher CFG for maximum prompt adherence.
  // Previous bug: this INCREASED LoRA strength, which made scene failures worse.
  // Now uses fixed moderate values that balance identity and scene accuracy.
  plan.paramAdjustments = {
    cfg: 6.0,
    steps: 40,
    charLoraStrengthModel: 0.5,
    charLoraStrengthClip: 0.25,
    regionalOverlap: profile.regionalOverlap > 0 ? profile.regionalOverlap + 48 : 0,
    regionalStrength: profile.regionalStrength,
  };
  plan.actions.push('full parameter reset (moderate LoRA 0.5/0.25, CFG 6.0, 40 steps)');
}

function buildRewriteInstructions(
  failures: FailureCategory[],
  diagnosis: string,
  contentMode: 'sfw' | 'nsfw',
): string {
  const parts: string[] = [];

  if (failures.includes('wrong_setting')) {
    parts.push('SETTING: Add explicit, detailed setting tags. Include objects/furniture that make the setting obvious.');
  }
  if (failures.includes('wrong_clothing')) {
    if (contentMode === 'nsfw') {
      parts.push(
        'NUDITY: Characters must be completely nude — this is an explicit scene. ' +
        'REMOVE all clothing tags. ADD: nude, naked, topless, bare breasts, no clothes, exposed skin, undressed. ' +
        'Do NOT add any garment tags. The failure is that the model generated clothed characters.',
      );
    } else {
      parts.push('CLOTHING: Add specific garment tags. Be explicit about each clothing item.');
    }
  }
  if (failures.includes('wrong_pose')) {
    if (contentMode === 'nsfw') {
      parts.push(
        'EXPLICIT POSE: Decompose the sex act into individual anatomical position tags — do NOT just repeat the act name. ' +
        'Specify: who is on top vs bottom, exact leg positions, torso angle, body weight distribution, penetration direction. ' +
        'Examples: "lying on back, legs spread, man between legs, missionary position, bodies pressed together, face to face" ' +
        'or "bent over, doggy style, rear entry, hands on hips". ' +
        'Use multiple overlapping tags describing the same position from different angles.',
      );
    } else {
      parts.push('POSE: Add explicit body position and hand placement tags. Specify who is doing what.');
    }
  }
  if (failures.includes('wrong_lighting')) {
    parts.push('LIGHTING: Name the specific light source. Add shadow direction tags.');
  }
  if (failures.includes('wrong_composition')) {
    parts.push('COMPOSITION: Specify exact shot type, camera angle, and framing.');
  }
  if (failures.includes('weak_intent')) {
    parts.push(
      'INTENT: The image does not convey the narrative intent of the scene. ' +
      'Restructure tags to prioritize the KEY ACTION and EMOTIONAL BEAT. ' +
      'Place the most scene-critical tag FIRST in the prompt. ' +
      'For interaction scenes: emphasize physical contact, body positioning, and emotional state. ' +
      'For sex scenes: decompose the position into anatomical tags (who on top, leg positions, penetration direction).',
    );
  }

  parts.push(`Previous evaluation: ${diagnosis}`);
  return parts.join('\n');
}

function detectPersistentFailures(history: FailureCategory[][]): FailureCategory[] {
  if (history.length < 3) return [];

  // Find categories that appear in 75%+ of attempts
  const counts = new Map<FailureCategory, number>();
  for (const attempt of history) {
    for (const cat of attempt) {
      counts.set(cat, (counts.get(cat) || 0) + 1);
    }
  }

  const threshold = Math.ceil(history.length * 0.75);
  return Array.from(counts.entries())
    .filter(([, count]) => count >= threshold)
    .map(([cat]) => cat);
}
