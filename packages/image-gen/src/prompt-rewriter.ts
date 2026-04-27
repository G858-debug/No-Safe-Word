/**
 * HunyuanImage 3.0 scene prompt rewriter.
 *
 * Uses Mistral Small to rewrite scene prompts to use one of the four
 * known-working composition patterns (A-D) documented in CLAUDE.md.
 * This is a server-only module — do not import in client components.
 */

import { HUNYUAN_REWRITER_SYSTEM } from "./prompts/hunyuan-rewriter-system";

export type ImageTypeHint = "sfw" | "explicit" | "atmospheric" | "cover";

export interface CharacterContext {
  primaryCharacter?: { name: string };
  secondaryCharacter?: { name: string };
}

export interface RewriteResult {
  rewrittenPrompt: string;
}

const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";

/**
 * Rewrite a scene prompt for HunyuanImage 3.0 using Mistral Small.
 *
 * For explicit scenes, enforces one of Patterns A-D. For SFW and
 * atmospheric scenes, returns a lightly cleaned-up version (or the
 * original unchanged if it is already well-formed).
 *
 * Throws if the API call fails or returns an empty result. Callers
 * are responsible for surfacing errors rather than silently falling back.
 */
export async function rewritePromptForHunyuan(
  originalPrompt: string,
  characterContext: CharacterContext = {},
  imageType: ImageTypeHint,
  options?: { model?: "small" | "large" }
): Promise<RewriteResult> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error("MISTRAL_API_KEY is not set");
  }

  const modelId =
    options?.model === "large"
      ? "mistral-large-latest"
      : "mistral-small-latest";

  const nameParts: string[] = [];
  if (characterContext.primaryCharacter?.name) {
    nameParts.push(characterContext.primaryCharacter.name);
  }
  if (characterContext.secondaryCharacter?.name) {
    nameParts.push(characterContext.secondaryCharacter.name);
  }

  const userMessage = [
    `IMAGE TYPE: ${imageType}`,
    nameParts.length > 0
      ? `CHARACTER NAMES: ${nameParts.join(", ")}`
      : null,
    "",
    `SCENE PROMPT:`,
    originalPrompt.trim(),
  ]
    .filter((l) => l !== null)
    .join("\n");

  const response = await fetch(MISTRAL_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: "system", content: HUNYUAN_REWRITER_SYSTEM },
        { role: "user", content: userMessage },
      ],
      max_tokens: 1024,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Mistral API error ${response.status}: ${body.slice(0, 200)}`
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rewrittenPrompt = data.choices?.[0]?.message?.content?.trim() ?? "";

  if (!rewrittenPrompt) {
    throw new Error("Mistral returned an empty rewrite");
  }

  return { rewrittenPrompt };
}
