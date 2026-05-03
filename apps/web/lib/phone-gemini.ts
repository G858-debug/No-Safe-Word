// Gemini-backed fallback parser, called only when the deterministic
// parsePhone() returns an ambiguous error. Designed to be cheap-to-skip:
// every result is cached (LRU + 1h TTL) and the call has a hard 5-second
// timeout so a slow Gemini doesn't hold the request handler open.
//
// Reads GEMINI_API_KEY from the environment. If the key is missing, the
// function does NOT throw — it returns the same generic fallback error
// the user would see on a Gemini timeout, so the form still renders a
// usable message.

import { parsePhone, type PhoneParseResult } from "./phone";

const GEMINI_MODEL = "gemini-3-flash-preview";
const GEMINI_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_MAX_SIZE = 100;

const GENERIC_FALLBACK_ERROR =
  "We couldn't validate that number. Try the format +27 82 123 4567.";

interface CacheEntry {
  result: PhoneParseResult;
  expiresAt: number;
}

// Insertion-ordered Map → cheap LRU. cacheGet promotes on hit by
// re-inserting; oldest entry is evicted when size exceeds CACHE_MAX_SIZE.
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): PhoneParseResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.result;
}

function cacheSet(key: string, result: PhoneParseResult): PhoneParseResult {
  if (cache.size >= CACHE_MAX_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

export async function geminiParsePhone(
  input: string
): Promise<PhoneParseResult> {
  const cacheKey = input.trim();
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[phone-gemini] GEMINI_API_KEY not set — falling back");
    return cacheSet(cacheKey, { ok: false, error: GENERIC_FALLBACK_ERROR });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildPrompt(input) }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          // Skip extended thinking for a structured one-shot answer.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(`[phone-gemini] HTTP ${res.status}`);
      return cacheSet(cacheKey, { ok: false, error: GENERIC_FALLBACK_ERROR });
    }

    const json = (await res.json()) as unknown;
    const text = extractText(json);

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.warn(
        `[phone-gemini] non-JSON response: ${text.slice(0, 200)}`
      );
      return cacheSet(cacheKey, { ok: false, error: GENERIC_FALLBACK_ERROR });
    }

    return cacheSet(cacheKey, interpretGeminiResponse(parsed));
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.warn("[phone-gemini] timeout");
    } else {
      console.warn("[phone-gemini] error:", err);
    }
    return cacheSet(cacheKey, { ok: false, error: GENERIC_FALLBACK_ERROR });
  } finally {
    clearTimeout(timeout);
  }
}

function buildPrompt(input: string): string {
  return [
    "You will be given a string the user typed as a phone number. Your job is to figure out what international E.164 number it represents.",
    "",
    "Return STRICT JSON with one of these two shapes:",
    '  { "valid": true,  "e164": "+27821234567" }',
    '  { "valid": false, "error": "<short user-facing reason>" }',
    "",
    "Rules:",
    "- e164 must start with + followed by 8 to 15 digits.",
    "- The country code cannot start with 0.",
    "- If the input is genuinely ambiguous (too few digits, missing country code, plausibly multiple countries), return valid=false with a one-sentence error suitable for end users.",
    "- Do NOT include any other keys, prose, or markdown — only the JSON object.",
    "- Trim whitespace, hyphens, parentheses, and dots before reasoning.",
    "",
    `Input: ${JSON.stringify(input)}`,
  ].join("\n");
}

function extractText(json: unknown): string {
  if (
    typeof json === "object" &&
    json !== null &&
    "candidates" in json &&
    Array.isArray((json as { candidates: unknown }).candidates)
  ) {
    const cand = (json as { candidates: unknown[] }).candidates[0];
    const parts =
      typeof cand === "object" && cand !== null && "content" in cand
        ? (cand as { content?: { parts?: unknown[] } }).content?.parts
        : undefined;
    if (Array.isArray(parts)) {
      const firstText = parts.find(
        (p): p is { text: string } =>
          typeof p === "object" &&
          p !== null &&
          "text" in p &&
          typeof (p as { text: unknown }).text === "string"
      );
      if (firstText) return firstText.text;
    }
  }
  return "";
}

function interpretGeminiResponse(parsed: unknown): PhoneParseResult {
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: GENERIC_FALLBACK_ERROR };
  }
  const obj = parsed as Record<string, unknown>;

  if (obj.valid === true && typeof obj.e164 === "string") {
    // Re-validate Gemini's claim with parsePhone — never trust an LLM
    // for the canonical form. If it hallucinated something invalid we
    // surface the generic error rather than store garbage.
    const reparsed = parsePhone(obj.e164);
    if (reparsed.ok) return reparsed;
    return { ok: false, error: GENERIC_FALLBACK_ERROR };
  }

  if (obj.valid === false) {
    const error =
      typeof obj.error === "string" && obj.error.trim().length > 0
        ? obj.error
        : GENERIC_FALLBACK_ERROR;
    return { ok: false, error };
  }

  return { ok: false, error: GENERIC_FALLBACK_ERROR };
}
