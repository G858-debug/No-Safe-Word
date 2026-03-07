/**
 * Flux Prompt Rewriter
 *
 * Uses Claude Sonnet to rewrite SDXL-style image prompts into natural-language
 * prompts optimised for Flux's T5 text encoder. Strips SDXL quality tags,
 * weighted syntax, and comma-separated tag lists — converts everything into
 * flowing descriptive prose while preserving scene content and character details.
 *
 * Falls back to the original prompt on any API failure.
 */

import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `You are an expert image prompt engineer specialising in Flux image generation models.
Flux uses a T5 text encoder that processes natural language differently from SDXL's CLIP encoder.

Your job: rewrite image prompts from SDXL format into optimal Flux format.

FLUX PROMPT RULES:
- Write in natural, descriptive sentences — not comma-separated tag lists
- REMOVE all SDXL quality tags: masterpiece, best quality, ultra detailed, 8k, photorealistic, RAW photo, (((text))), ((text)), (text:1.2), etc.
- REMOVE negative prompt indicators — Flux has no negative prompt
- PRESERVE: character descriptions, scene setting, lighting details, composition instructions, emotional atmosphere, action/pose
- PRESERVE: South African location and cultural details exactly as written
- CONVERT tag lists into flowing descriptive prose
- Keep the scene narrative intact — do not add or invent new scene elements
- Output ONLY the rewritten prompt. No preamble, no explanation, no quotes.`;

let anthropicClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY environment variable is not set");
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

/**
 * Rewrite an image prompt from SDXL tag format into Flux natural-language format.
 *
 * @param rawPrompt - The assembled prompt (identity prefix + scene prompt)
 * @param isSfw - Whether this is an SFW scene (affects the label sent to Claude)
 * @returns The rewritten prompt, or the original rawPrompt on failure
 */
export async function rewritePromptForFlux(
  rawPrompt: string,
  isSfw: boolean,
): Promise<string> {
  const startMs = Date.now();
  try {
    const client = getClient();
    const label = isSfw ? "SFW" : "NSFW";

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Rewrite this ${label} image prompt for Flux:\n\n${rawPrompt}`,
        },
      ],
    });

    const text =
      response.content[0]?.type === "text" ? response.content[0].text : null;

    if (!text || text.trim().length === 0) {
      console.warn(
        `[FluxRewriter] Claude returned empty response, falling back to original prompt`,
      );
      return rawPrompt;
    }

    const rewritten = text.trim();
    const durationMs = Date.now() - startMs;
    console.log(
      `[FluxRewriter] Rewrite complete (${durationMs}ms): ${rewritten.substring(0, 150)}...`,
    );
    return rewritten;
  } catch (err) {
    const durationMs = Date.now() - startMs;
    console.warn(
      `[FluxRewriter] Claude API call failed (${durationMs}ms), falling back to original prompt:`,
      err instanceof Error ? err.message : err,
    );
    return rawPrompt;
  }
}