import Anthropic from "@anthropic-ai/sdk";

// Memoized Anthropic client. The SDK is already in use from
// packages/image-gen (scene evaluation, character-lora validator) —
// they construct ad-hoc clients at each call site. The Story Publisher
// regenerate endpoints call Claude less frequently than the evaluator
// but still benefit from a shared factory so any future config
// additions (timeouts, retries, custom headers) land in one place.

let client: Anthropic | null = null;

/**
 * Returns a memoized Anthropic client. Throws if ANTHROPIC_API_KEY is
 * not set — the error surfaces to the caller rather than silently
 * returning a broken client.
 */
export function getClaudeClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured — required for Claude API calls. " +
        "Set it in .env.local (local dev) or the Railway environment (prod)."
    );
  }
  client = new Anthropic({ apiKey });
  return client;
}

/**
 * Canonical model identifier for creative writing tasks (blurbs, cover
 * prompts). Centralised so future migrations to a newer model can be a
 * single-line change. Do not use Haiku for these tasks — creative
 * quality matters more than the latency/cost savings on one-off regen
 * actions.
 */
export const CLAUDE_CREATIVE_MODEL = "claude-opus-4-7";
