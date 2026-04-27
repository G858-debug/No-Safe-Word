/**
 * HunyuanImage 3.0 scene prompt rewriter.
 *
 * Uses Mistral Small to rewrite scene prompts to use one of the four
 * known-working composition patterns (A-D) documented in CLAUDE.md.
 * Mistral receives the full character context (gender, stripped portrait
 * description, clothing) and produces the complete final prompt that goes
 * to Replicate — no mechanical assembly step needed after this.
 *
 * This is a server-only module — do not import in client components.
 */

import { HUNYUAN_REWRITER_SYSTEM } from "./prompts/hunyuan-rewriter-system";

export type ImageTypeHint = "sfw" | "explicit" | "atmospheric" | "cover";

export interface CharacterInfo {
  name: string;
  gender?: string;
  /** Pre-stripped scene block: output of buildSceneCharacterBlockFromLocked */
  portraitBlock?: string;
  /** Clothing sentence for SFW images, e.g. "Lindiwe is wearing a fitted blazer." */
  clothing?: string;
}

export interface CharacterContext {
  primaryCharacter?: CharacterInfo;
  secondaryCharacter?: CharacterInfo;
  /** True when image_type is facebook_sfw — tells Mistral to include clothing + SFW constraint */
  isSfw?: boolean;
}

export interface RewriteResult {
  rewrittenPrompt: string;
}

const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";

function formatCharacterBlock(label: string, char: CharacterInfo, isSfw: boolean): string {
  const lines = [`${label}:`];
  lines.push(`Name: ${char.name}`);
  if (char.gender) lines.push(`Gender: ${char.gender}`);
  if (char.portraitBlock) lines.push(`Description: ${char.portraitBlock}`);
  if (isSfw && char.clothing) lines.push(`Clothing: ${char.clothing}`);
  return lines.join("\n");
}

/**
 * Rewrite a scene prompt for HunyuanImage 3.0 using Mistral Small.
 *
 * Mistral receives the full character context and produces the COMPLETE
 * final prompt (character description(s) + scene + SFW constraint if
 * needed). The only thing added by the assembler after this is the visual
 * signature, which Mistral is instructed not to include.
 *
 * For explicit scenes, enforces one of Patterns A–D, intelligently
 * omitting character description blocks that don't belong in frame.
 * For SFW/atmospheric, returns a cleaned-up self-contained prompt.
 *
 * Throws on API failure. Callers surface errors rather than silently
 * falling back.
 */
export async function rewritePromptForHunyuan(
  originalPrompt: string,
  characterContext: CharacterContext = {},
  imageType: ImageTypeHint,
  options?: { model?: "small" | "large"; knowledge?: string }
): Promise<RewriteResult> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error("MISTRAL_API_KEY is not set");
  }

  const modelId =
    options?.model === "large"
      ? "mistral-large-latest"
      : "mistral-small-latest";

  const isSfw = characterContext.isSfw ?? false;

  const messageParts: string[] = [`IMAGE TYPE: ${imageType}`];

  if (characterContext.primaryCharacter) {
    messageParts.push("");
    messageParts.push(
      formatCharacterBlock("PRIMARY CHARACTER", characterContext.primaryCharacter, isSfw)
    );
  }
  if (characterContext.secondaryCharacter) {
    messageParts.push("");
    messageParts.push(
      formatCharacterBlock("SECONDARY CHARACTER", characterContext.secondaryCharacter, isSfw)
    );
  }

  messageParts.push("");
  messageParts.push("SCENE PROMPT:");
  messageParts.push(originalPrompt.trim());

  const userMessage = messageParts.join("\n");

  // Inject knowledge into the system prompt. If no knowledge was loaded
  // (e.g. file not found), the placeholder is removed and Mistral falls
  // back to its own general knowledge — still useful, just less tuned.
  const knowledge = options?.knowledge?.trim() ?? "";
  const systemPrompt = HUNYUAN_REWRITER_SYSTEM.replace(
    "{KNOWLEDGE}",
    knowledge || "(No test knowledge loaded — apply general best practices.)"
  );

  const response = await fetch(MISTRAL_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: 1200,
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
