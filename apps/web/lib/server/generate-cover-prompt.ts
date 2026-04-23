import { getClaudeClient, CLAUDE_CREATIVE_MODEL } from "./claude-client";
import type { BlurbCharacterInput } from "./generate-blurbs";

// ============================================================
// Cover prompt generation service
// ============================================================
// Calls claude-opus-4-7 to produce a single cover-image prompt for a
// story. Used by POST /api/stories/[seriesId]/regenerate-cover-prompt.
//
// The model is instructed to return prose, not JSON. We verify the
// response ends with the Visual Signature — if it doesn't, the model
// drifted and we throw so the caller can retry rather than saving a
// broken prompt.
// ============================================================

export interface GenerateCoverPromptInput {
  seriesId: string;
  title: string;
  fullStoryText: string;
  characters: BlurbCharacterInput[];
}

const VISUAL_SIGNATURE =
  "Cinematic shallow depth of field. Rich shadows with luminous highlights. Soft skin glow. Intimate framing. Editorial photography quality. Photorealistic.";

const SYSTEM_PROMPT = `You write image generation prompts for No Safe Word book covers. Each cover is a two-character intimate composition depicting the protagonist and primary love interest, rendered photorealistically via Flux 2 Dev.

Cover prompt requirements (all must be present):
- Two-character intimate composition
- Physical descriptions of both characters (pulled from their prose descriptions in the input)
- Specific pose and physical contact between them
- Expression and gaze direction for each
- Lighting source named specifically (candlelight, amber lamp, window light, etc.)
- South African setting detail
- Brand colour motif woven naturally: crimson, burgundy, amber, or gold (in wardrobe, lighting, or set dressing)
- Subjects composed in the upper two-thirds of the frame (typography goes in the lower third)
- Suggestive, not explicit (covers display publicly)
- Ends with the Visual Signature: "${VISUAL_SIGNATURE}"

Capture the emotional core of the whole story in one image — the central tension, not a specific scene.

Return a single string: the cover prompt. No JSON wrapper, no preamble, no commentary. Just the prompt.`;

function buildUserPrompt(input: GenerateCoverPromptInput): string {
  const characterLines = input.characters
    .map((c) => {
      const prose = c.proseDescription ?? "(no prose description)";
      return `- ${c.name} (${c.role}): ${prose}`;
    })
    .join("\n");

  return `Title: ${input.title}

Characters:
${characterLines || "(none)"}

Full story text:
${input.fullStoryText}

Write the cover prompt.`;
}

/**
 * Loose-match check that the prompt ends with the Visual Signature.
 * The model occasionally paraphrases or adds trailing punctuation;
 * we normalise whitespace/punctuation before comparing. Matches on
 * the final sentence starting with "Cinematic shallow depth of field"
 * through "Photorealistic" — if that exact cadence is present
 * anywhere in the last ~400 chars, accept.
 */
function endsWithVisualSignature(prompt: string): boolean {
  const tail = prompt.slice(-400).toLowerCase();
  return (
    tail.includes("cinematic shallow depth of field") &&
    tail.includes("editorial photography quality") &&
    tail.includes("photorealistic")
  );
}

export async function generateCoverPromptForStory(
  input: GenerateCoverPromptInput
): Promise<string> {
  if (!input.fullStoryText || input.fullStoryText.trim().length === 0) {
    throw new Error(
      "Cannot generate cover prompt: fullStoryText is empty. Caller must ensure the series has at least one post with website_content before invoking."
    );
  }

  const client = getClaudeClient();

  const message = await client.messages.create({
    model: CLAUDE_CREATIVE_MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(input) }],
  });

  const rawText = message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();

  if (!rawText) {
    throw new Error(
      `Claude response had no text content. Raw message: ${JSON.stringify(message)}`
    );
  }

  if (!endsWithVisualSignature(rawText)) {
    throw new Error(
      `Claude cover prompt did not end with the Visual Signature (model drift). Raw response: ${rawText}`
    );
  }

  return rawText;
}
