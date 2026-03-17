// Retry wrapper for Anthropic API calls with exponential backoff.
// Retries on 500 (internal server error), 502, 503, and 529 (overloaded).
// Logs each retry attempt with request context for debugging.

import Anthropic from '@anthropic-ai/sdk';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000; // 2s, 4s, 8s

interface RetryOptions {
  /** Descriptive label for log messages (e.g. 'eval body_shot_3') */
  label?: string;
}

/**
 * Call anthropic.messages.create with retry on transient server errors.
 * Retries up to 3 times with exponential backoff (2s → 4s → 8s).
 * On final failure, logs the full request payload (minus API key) and re-throws.
 */
export async function anthropicCreateWithRetry(
  client: Anthropic,
  params: Anthropic.Messages.MessageCreateParamsNonStreaming,
  options?: RetryOptions,
): Promise<Anthropic.Messages.Message> {
  const label = options?.label ?? params.model;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await client.messages.create(params);
    } catch (error) {
      if (!isRetryableError(error) || attempt === MAX_RETRIES) {
        // Final attempt or non-retryable — log payload and re-throw
        if (attempt === MAX_RETRIES) {
          console.error(
            `[Anthropic Retry] ${label}: all ${MAX_RETRIES} attempts failed. ` +
            `Request payload: ${sanitizePayload(params)}`
          );
        }
        throw error;
      }

      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(
        `[Anthropic Retry] ${label}: attempt ${attempt}/${MAX_RETRIES} failed with ${getErrorStatus(error)}, ` +
        `retrying in ${delay / 1000}s...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Unreachable, but TypeScript needs it
  throw new Error('Retry loop exited unexpectedly');
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Anthropic.APIError) {
    return [500, 502, 503, 529].includes(error.status);
  }
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('Internal server error');
}

function getErrorStatus(error: unknown): string {
  if (error instanceof Anthropic.APIError) {
    return `${error.status} ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Log request params without image data (which would be huge). */
function sanitizePayload(params: Anthropic.Messages.MessageCreateParamsNonStreaming): string {
  const safe = {
    model: params.model,
    max_tokens: params.max_tokens,
    system: typeof params.system === 'string'
      ? params.system.slice(0, 200) + (params.system.length > 200 ? '...' : '')
      : '[system blocks]',
    message_content_types: Array.isArray(params.messages?.[0]?.content)
      ? (params.messages[0].content as any[]).map((b: any) => b.type)
      : typeof params.messages?.[0]?.content,
  };
  return JSON.stringify(safe);
}
