import fs from "node:fs";
import path from "node:path";

// ============================================================
// Shared Mistral Large helpers used by BOTH:
//   - apps/web/lib/server/generate-cover-prompt.ts  (covers)
//   - apps/web/lib/server/draft-scene-prompt.ts     (scene images)
//
// Both call Mistral Large with a system prompt that embeds
// `packages/image-gen/src/prompts/hunyuan-knowledge.md`, then
// validate that the returned prompt ends with the Visual Signature.
// ============================================================

const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";
const MISTRAL_MODEL = "mistral-large-latest";

export const VISUAL_SIGNATURE =
  "Cinematic shallow depth of field. Rich shadows with luminous highlights. Soft skin glow. Intimate framing. Editorial photography quality. Photorealistic.";

export const BRAND_PREFERENCE_NOTE = `BRAND PREFERENCE — apply where it fits the scene, do not force it:
No Safe Word's visual identity favours crimson, burgundy, amber, and gold. Try to weave at least one of these into the image naturally — through wardrobe (a burgundy slip dress, an amber silk shirt), practical lighting (candlelight, a warm amber lamp, golden-hour wash), or set dressing (a crimson throw on the bed, gold jewellery, a brass lamp). Do not force a brand colour into a scene where it would look implausible — but if there's a natural opportunity, take it. The reader should feel the brand without seeing a logo. Brand colours must NEVER appear in the characters' permanent features (hair, eyes, skin) — only in wardrobe, set dressing, or lighting.`;

let cachedHunyuanKnowledge: string | null = null;

/**
 * Load `packages/image-gen/src/prompts/hunyuan-knowledge.md` from disk
 * once and cache. Resolves relative to `process.cwd()` (which is
 * `apps/web` at runtime in both dev and the Railway production build,
 * since Next.js runs from the app directory).
 *
 * Returns an empty string with a warning if the file isn't found —
 * Mistral calls will still work, just without embedded composition
 * vocabulary.
 */
export function loadHunyuanKnowledge(): string {
  if (cachedHunyuanKnowledge !== null) return cachedHunyuanKnowledge;
  const candidates = [
    path.join(process.cwd(), "..", "..", "packages", "image-gen", "src", "prompts", "hunyuan-knowledge.md"),
    path.join(process.cwd(), "packages", "image-gen", "src", "prompts", "hunyuan-knowledge.md"),
  ];
  for (const p of candidates) {
    try {
      const text = fs.readFileSync(p, "utf-8");
      cachedHunyuanKnowledge = text;
      return text;
    } catch {
      // try next candidate
    }
  }
  console.warn(
    "[mistral-prompt-helpers] hunyuan-knowledge.md not found at any candidate path; Mistral calls will run without embedded knowledge"
  );
  cachedHunyuanKnowledge = "";
  return "";
}

/**
 * Loose-match check that the prompt ends with the Visual Signature.
 * The model occasionally paraphrases or adds trailing punctuation;
 * this normalises by checking the final ~400 chars contain the three
 * identifying phrases.
 */
export function endsWithVisualSignature(prompt: string): boolean {
  const tail = prompt.slice(-400).toLowerCase();
  return (
    tail.includes("cinematic shallow depth of field") &&
    tail.includes("editorial photography quality") &&
    tail.includes("photorealistic")
  );
}

interface MistralChoice {
  message?: { content?: string };
}
interface MistralResponse {
  choices?: MistralChoice[];
}

/**
 * Call Mistral Large with the given system + user messages. Returns the
 * assistant text content. Throws on auth failure, HTTP error, or empty
 * response.
 *
 * Automatically retries on 429 (rate limit) and 5xx errors with
 * exponential backoff. Batch scene-prompt drafting can fire ~1 request
 * every 1.5 seconds, which can trip Mistral's per-second rate limit on
 * mistral-large-latest — without retries, the user sees random failures
 * scattered through a batch run.
 */
export async function callMistral(
  systemPrompt: string,
  userPrompt: string,
  opts?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error("MISTRAL_API_KEY is not set");
  }

  const maxAttempts = 4;
  const baseDelayMs = 750;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(MISTRAL_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MISTRAL_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: opts?.maxTokens ?? 2048,
          temperature: opts?.temperature ?? 0.7,
        }),
      });
    } catch (networkErr) {
      lastError =
        networkErr instanceof Error
          ? networkErr
          : new Error(`Mistral fetch failed: ${String(networkErr)}`);
      console.error(
        `[mistral] network error on attempt ${attempt}/${maxAttempts}: ${lastError.message}`
      );
      if (attempt < maxAttempts) {
        await sleep(baseDelayMs * 2 ** (attempt - 1));
        continue;
      }
      throw lastError;
    }

    if (response.ok) {
      const data = (await response.json()) as MistralResponse;
      const text = data.choices?.[0]?.message?.content?.trim() ?? "";
      if (!text) {
        throw new Error(
          `Mistral response had no text content. Raw: ${JSON.stringify(data)}`
        );
      }
      return text;
    }

    const body = await response.text().catch(() => "");
    const status = response.status;
    const isRetryable = status === 429 || status === 503 || status === 504 || status >= 500;
    lastError = new Error(
      `Mistral API ${status}: ${body || response.statusText}`
    );

    if (!isRetryable || attempt === maxAttempts) {
      console.error(
        `[mistral] giving up after ${attempt} attempt(s): ${lastError.message}`
      );
      throw lastError;
    }

    // Honour Retry-After header if present, otherwise exponential backoff
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterSec = retryAfterHeader ? parseFloat(retryAfterHeader) : NaN;
    const delay = Number.isFinite(retryAfterSec) && retryAfterSec > 0
      ? retryAfterSec * 1000
      : baseDelayMs * 2 ** (attempt - 1);

    console.warn(
      `[mistral] ${status} on attempt ${attempt}/${maxAttempts}; retrying in ${Math.round(delay)}ms`
    );
    await sleep(delay);
  }

  // Unreachable — the loop either returns or throws
  throw lastError ?? new Error("Mistral call failed for unknown reason");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
