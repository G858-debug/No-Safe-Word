/**
 * Pose selection and dynamic generation fallback.
 *
 * 1. selectPose()           — fast, static catalog only (no API calls)
 * 2. selectOrGeneratePose() — tries static first, falls back to Claude
 *                             generation when no good match exists
 *
 * Mirrors the resource LoRA pattern: selectResourceLoras() for static,
 * searchAndDownloadLora() for dynamic.
 */

import type { SceneClassification, InteractionType } from '../scene-classifier';
import type { PoseDefinition, ContentLevel, PoseOrientation, PoseFraming } from './types';
import { POSE_CATALOG } from './pose-catalog';
import { generatePose } from './pose-generator';

// ---------------------------------------------------------------------------
// Scoring thresholds
// ---------------------------------------------------------------------------

/** Minimum score to return a static match */
const MIN_STATIC_SCORE = 2;

/** Score below which we fall back to dynamic generation */
const WEAK_MATCH_THRESHOLD = 4;

// ---------------------------------------------------------------------------
// Content-level mapping
// ---------------------------------------------------------------------------

function classifierContentLevel(c: SceneClassification): ContentLevel {
  if (c.contentLevel === 'nsfw') return 'explicit';
  if (c.contentLevel === 'suggestive') return 'intimate';
  return 'sfw';
}

// ---------------------------------------------------------------------------
// Orientation inference from classification
// ---------------------------------------------------------------------------

function inferOrientation(c: SceneClassification): PoseOrientation {
  const isIntimate = c.interactionType === 'intimate' || c.interactionType === 'romantic';
  if (c.shotType === 'wide') return 'landscape';
  if (isIntimate && c.contentLevel === 'nsfw') return 'square';
  if (c.characterCount === 2) return 'landscape';
  return 'portrait';
}

function inferFraming(c: SceneClassification): PoseFraming {
  if (c.shotType === 'close-up') return 'medium';
  if (c.shotType === 'wide') return 'full-body';
  if (c.contentLevel === 'nsfw') return 'full-body';
  return 'three-quarter';
}

// ---------------------------------------------------------------------------
// Static scoring
// ---------------------------------------------------------------------------

function scorePose(
  pose: PoseDefinition,
  classification: SceneClassification,
  promptLower: string,
): number {
  let score = 0;

  // +3 per keyword hit
  for (const kw of pose.keywords) {
    if (promptLower.includes(kw.toLowerCase())) score += 3;
  }

  // +2 if interaction type matches
  if (pose.interactionTypes.includes(classification.interactionType)) score += 2;

  // +1 content level compatibility (penalise mismatches)
  const sceneLevel = classifierContentLevel(classification);
  const order: ContentLevel[] = ['sfw', 'intimate', 'explicit'];
  if (order.indexOf(pose.category) <= order.indexOf(sceneLevel)) {
    score += 1;
  } else {
    score -= 5;
  }

  // +1 correct character count
  if (classification.characterCount === pose.characterCount) score += 1;

  return score;
}

// ---------------------------------------------------------------------------
// Public API — static only
// ---------------------------------------------------------------------------

/**
 * Fast, synchronous selection from the static catalog.
 * Returns null if no pose scores above MIN_STATIC_SCORE.
 */
export function selectPose(
  classification: SceneClassification,
  promptText: string,
): PoseDefinition | null {
  if (classification.characterCount !== 2) return null;

  const promptLower = promptText.toLowerCase();
  let best: PoseDefinition | null = null;
  let bestScore = -Infinity;

  for (const pose of POSE_CATALOG) {
    const s = scorePose(pose, classification, promptLower);
    if (s > bestScore) {
      bestScore = s;
      best = pose;
    }
  }

  return bestScore >= MIN_STATIC_SCORE ? best : null;
}

// ---------------------------------------------------------------------------
// Public API — static + dynamic fallback
// ---------------------------------------------------------------------------

/**
 * Select the best pose, generating a new one via Claude if the static
 * catalog has no strong match.
 *
 * Flow:
 * 1. Score all static poses
 * 2. If best score >= WEAK_MATCH_THRESHOLD → return static pose
 * 3. Otherwise → generate via Claude using the prompt as descriptor
 * 4. Generated pose is auto-registered for future static matches
 *
 * Costs ~$0.001 per dynamic generation (Haiku).
 */
export async function selectOrGeneratePose(
  classification: SceneClassification,
  promptText: string,
): Promise<PoseDefinition | null> {
  if (classification.characterCount !== 2) return null;

  const promptLower = promptText.toLowerCase();

  // Score static catalog
  let best: PoseDefinition | null = null;
  let bestScore = -Infinity;
  for (const pose of POSE_CATALOG) {
    const s = scorePose(pose, classification, promptLower);
    if (s > bestScore) {
      bestScore = s;
      best = pose;
    }
  }

  // Strong static match — use it
  if (best && bestScore >= WEAK_MATCH_THRESHOLD) return best;

  // Weak or no match — generate dynamically
  const contentLevel = classifierContentLevel(classification);
  const orientation = inferOrientation(classification);
  const framing = inferFraming(classification);

  // Build a concise descriptor from the prompt (truncate to avoid long prompts)
  const descriptor = promptText.length > 200
    ? promptText.slice(0, 200) + '...'
    : promptText;

  const generated = await generatePose({
    descriptor,
    category: contentLevel,
    orientation,
    framing,
    interactionTypes: [classification.interactionType],
    keywords: promptLower.split(/\s+/).filter((w) => w.length > 3).slice(0, 10),
  });

  // If generation failed, fall back to best static (even if weak)
  if (!generated) return bestScore >= MIN_STATIC_SCORE ? best : null;

  return generated;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

export function getPosesByCategory(category: ContentLevel): PoseDefinition[] {
  return POSE_CATALOG.filter((p) => p.category === category);
}
