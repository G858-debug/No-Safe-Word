import Anthropic from '@anthropic-ai/sdk';

export interface PersonValidationResult {
  personCountDetected: number;
  validationPassed: boolean;
  attempts: number;
  seedsUsed: number[];
}

const MAX_RETRY_ATTEMPTS = 3;

/**
 * Count the number of distinct people visible in an image using Claude Vision.
 *
 * Uses Claude Haiku for fast, cheap person counting (~$0.001 per call, <2s).
 * This is used for post-hoc validation of dual-character image generations
 * to detect single-person failures before storing results.
 *
 * @param imageBase64 - Base64-encoded image data (no data URI prefix)
 * @param expectedCount - Number of people expected in the image
 * @returns detected count and whether it meets expectations
 */
export async function validatePersonCount(
  imageBase64: string,
  expectedCount: number,
): Promise<{ detected: number; passed: boolean }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[PersonValidator] Missing ANTHROPIC_API_KEY — skipping validation');
    return { detected: -1, passed: true };
  }

  try {
    const anthropic = new Anthropic({ apiKey });

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: 'How many distinct people (full or partial bodies) are visible in this image? Reply with ONLY a single integer.',
            },
          ],
        },
      ],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
    const detected = parseInt(text, 10);

    if (isNaN(detected)) {
      console.warn(`[PersonValidator] Could not parse person count from response: "${text}"`);
      return { detected: -1, passed: true };
    }

    console.log(`[PersonValidator] Detected ${detected} person(s), expected ${expectedCount}`);
    return { detected, passed: detected >= expectedCount };
  } catch (err) {
    // Don't block pipeline on validation errors
    console.error('[PersonValidator] Validation error:', err instanceof Error ? err.message : err);
    return { detected: -1, passed: true };
  }
}

/**
 * Check if a dual-character validation should trigger a retry.
 *
 * @param settings - The images.settings JSONB object
 * @returns whether a retry is allowed (under max attempts)
 */
export function canRetryValidation(settings: Record<string, unknown>): boolean {
  const validation = settings.validation as Record<string, unknown> | undefined;
  const attempts = (validation?.attempts as number) ?? 0;
  return attempts < MAX_RETRY_ATTEMPTS;
}

/**
 * Build updated settings JSONB for a validation retry.
 *
 * @param currentSettings - The current images.settings JSONB
 * @param newSeed - The new seed to use for the retry
 * @param detectedCount - The person count detected in the failed attempt
 * @returns updated settings object with validation tracking
 */
export function buildRetrySettings(
  currentSettings: Record<string, unknown>,
  newSeed: number,
  detectedCount: number,
): Record<string, unknown> {
  const validation = (currentSettings.validation as Record<string, unknown>) ?? {};
  const previousSeeds = (validation.seedsUsed as number[]) ?? [];
  const currentSeed = currentSettings.seed as number;

  return {
    ...currentSettings,
    seed: newSeed,
    validation: {
      attempts: (previousSeeds.length || 0) + 1,
      seedsUsed: [...previousSeeds, currentSeed],
      lastDetectedCount: detectedCount,
      maxAttempts: MAX_RETRY_ATTEMPTS,
    },
  };
}

/**
 * Generate a new random seed for a retry attempt.
 */
export function generateRetrySeed(): number {
  return Math.floor(Math.random() * 2_147_483_647) + 1;
}
