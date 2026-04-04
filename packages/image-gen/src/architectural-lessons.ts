/**
 * Architectural knowledge base — curated structural solutions from past fixes.
 *
 * These lessons capture workflow-level problems (wrong ComfyUI nodes, missing
 * regional conditioning, etc.) that can't be fixed by parameter tuning alone.
 *
 * The retry engine checks these BEFORE burning through attempts — if a known
 * pattern matches, it can flag the issue proactively rather than exhausting retries.
 *
 * Add new lessons here when structural fixes are discovered through investigation.
 */

import type { FailureCategory } from './scene-evaluator';

export interface ArchitecturalLesson {
  /** The failure category that triggers this lesson */
  pattern: FailureCategory;
  /** How many consecutive attempts with this failure before triggering */
  persistenceThreshold: number;
  /** Human-readable diagnosis */
  diagnosis: string;
  /** What was done to fix it */
  solution: string;
  /** When this lesson was added (for auditing) */
  appliedSince: string;
}

export const ARCHITECTURAL_LESSONS: ArchitecturalLesson[] = [
  {
    pattern: 'characters_identical',
    persistenceThreshold: 3,
    diagnosis: 'Characters rendered identically despite different LoRAs — likely missing regional conditioning or body shape LoRAs overriding male character',
    solution: 'Enable ConditioningSetArea to separate character prompts into left/right regions. Skip female body shape LoRAs (hourglass, breasts) in mixed-gender scenes.',
    appliedSince: '2026-04-04',
  },
  {
    pattern: 'wrong_person_count',
    persistenceThreshold: 4,
    diagnosis: 'Consistently wrong person count — SDXL struggling with multi-character generation in flat prompt',
    solution: 'Check if regional conditioning is enabled for dual-character scenes. Verify both character LoRAs are loaded and trigger words are in separate regions.',
    appliedSince: '2026-04-04',
  },
];

/**
 * Check if any architectural lesson matches the current failure pattern.
 *
 * @param currentFailures - Failure categories from the latest evaluation
 * @param failureHistory - All failure categories from previous attempts (ordered)
 * @returns Matching lesson, or null if no match
 */
export function checkArchitecturalLessons(
  currentFailures: FailureCategory[],
  failureHistory: FailureCategory[][],
): ArchitecturalLesson | null {
  for (const lesson of ARCHITECTURAL_LESSONS) {
    // Count how many consecutive recent attempts had this failure
    let consecutiveCount = 0;
    for (let i = failureHistory.length - 1; i >= 0; i--) {
      if (failureHistory[i].includes(lesson.pattern)) {
        consecutiveCount++;
      } else {
        break;
      }
    }

    // Also count the current attempt
    if (currentFailures.includes(lesson.pattern)) {
      consecutiveCount++;
    }

    if (consecutiveCount >= lesson.persistenceThreshold) {
      return lesson;
    }
  }

  return null;
}

/**
 * Request a structural diagnosis from Sonnet when all retries are exhausted.
 * This is expensive (~$0.01) and only fires on total failure.
 */
export async function requestStructuralDiagnosis(
  failureHistory: FailureCategory[][],
  evalDiagnoses: string[],
  compositionType: string,
  contentMode: string,
): Promise<string> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return 'skipped — no API key';

  try {
    const anthropic = new Anthropic({ apiKey });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: `You are an expert in ComfyUI workflow design for Stable Diffusion XL image generation.
Analyze the persistent failure pattern and suggest what architectural changes to the ComfyUI workflow could fix it.

Consider these ComfyUI capabilities:
- ConditioningSetArea (regional prompting — separate character conditioning by area)
- ConditioningSetMask (mask-based conditioning)
- ControlNet (pose guidance via OpenPose, depth maps)
- IPAdapter (image-guided generation for character consistency)
- FaceDetailer (post-processing face refinement)
- Latent compositing (separate generation + compositing)
- Attention couple (paired attention for multi-character scenes)

Be specific about which nodes to add and how to wire them.`,
      messages: [{
        role: 'user',
        content:
          `Scene type: ${compositionType} / ${contentMode}\n\n` +
          `Failure pattern across ${failureHistory.length} attempts:\n` +
          failureHistory.map((f, i) => `  Attempt ${i + 1}: [${f.join(', ')}]`).join('\n') + '\n\n' +
          `Evaluation diagnoses:\n` +
          evalDiagnoses.map((d, i) => `  Attempt ${i + 1}: ${d}`).join('\n') + '\n\n' +
          `What architectural change to the ComfyUI workflow would fix this persistent failure?`,
      }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
    console.log(`[ArchitecturalLessons] Structural diagnosis from Sonnet:\n${text}`);
    return text;
  } catch (err) {
    console.error('[ArchitecturalLessons] Structural diagnosis failed:', err instanceof Error ? err.message : err);
    return 'structural diagnosis failed';
  }
}
