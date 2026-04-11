/**
 * Haiku-based pose classifier.
 *
 * Takes a scene prompt and determines whether ControlNet pose conditioning
 * would improve the generation, and if so, which pose from the catalog
 * best matches the scene.
 *
 * Returns null when no pose applies:
 *  - Solo character portraits
 *  - SFW atmospheric / establishing shots
 *  - Scenes where the pose catalog has no relevant match
 */

import Anthropic from '@anthropic-ai/sdk';
import type { SceneClassification } from '../scene-classifier';
import type { PoseDefinition } from './types';
import { POSE_CATALOG, getPoseById } from './pose-catalog';

// ---------------------------------------------------------------------------
// Build the catalog summary sent to Haiku (IDs + descriptors only)
// ---------------------------------------------------------------------------

function buildCatalogSummary(): string {
  return POSE_CATALOG.map(
    (p) => `- ${p.id}: ${p.descriptor} [${p.category}]`,
  ).join('\n');
}

const SYSTEM_PROMPT = `You classify scene descriptions to select OpenPose skeleton poses for ControlNet conditioning in image generation.

Given a scene description and a pose catalog, respond with ONLY the pose ID that best matches, or "none".

Rules:
- Return "none" for: solo character scenes, atmospheric/environmental shots, scenes with 0 or 1 character, or when no catalog pose fits the described body arrangement.
- Return a pose ID ONLY for two-character scenes where body positioning matters.
- Match the PHYSICAL ARRANGEMENT, not the emotion. "Tense confrontation face-to-face" is still "face-to-face-close" even though the mood differs.
- For explicit scenes, match the sex position precisely — "cowgirl" and "missionary" are different poses.
- Prefer the most specific match. "Kissing while seated" → "kissing-seated" over "kissing-standing".
- If the scene describes a position not in the catalog, return "none" — the dynamic generator will handle it.

Respond with a single line: either a pose ID or "none". No explanation.`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify a scene prompt and return the best matching pose, or null.
 *
 * Cost: ~$0.0005 per call (Haiku).
 * Latency: ~200-400ms.
 */
export async function classifyPose(
  scenePrompt: string,
  classification: SceneClassification,
): Promise<PoseDefinition | null> {
  // Fast-path: skip Haiku for scenes that never need pose conditioning
  if (classification.characterCount < 2) return null;

  const catalogSummary = buildCatalogSummary();
  const anthropic = new Anthropic();

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 50,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `SCENE: ${scenePrompt}\n\nCHARACTER COUNT: ${classification.characterCount}\nINTERACTION TYPE: ${classification.interactionType}\nCONTENT LEVEL: ${classification.contentLevel}\n\nPOSE CATALOG:\n${catalogSummary}`,
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
      .toLowerCase();

    if (text === 'none' || !text) return null;

    // Strip any quotes or extra whitespace Haiku might add
    const poseId = text.replace(/['"]/g, '').trim();
    const pose = getPoseById(poseId);

    if (!pose) {
      console.warn(`[PoseClassifier] Haiku returned unknown pose ID: "${poseId}"`);
      return null;
    }

    console.log(`[PoseClassifier] Matched pose: ${pose.id} (${pose.name})`);
    return pose;
  } catch (err) {
    console.error('[PoseClassifier] Haiku call failed, skipping pose conditioning:', err);
    return null;
  }
}
