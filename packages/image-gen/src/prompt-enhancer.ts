/**
 * Shared Claude prompt enhancement for image generation.
 *
 * Extracted from /api/image-generator/enhance so both the HTTP endpoint
 * and the V3 pipeline can call it without an internal HTTP round-trip.
 */

import Anthropic from "@anthropic-ai/sdk";

function buildSystemPrompt(nsfw: boolean): string {
  return `You are an image prompt specialist for a South African adult ${nsfw ? "NSFW" : "SFW"} romance fiction platform.
Enhance the user's rough prompt into a vivid, cinematic image generation prompt using these five layers:

Expression & Gaze — specify the character's exact expression and eye direction
Narrative Implication — capture a specific moment; something just happened or is about to
Lighting & Atmosphere — name a specific light source (e.g. "single amber streetlight", "bedside lamp glow", "candlelight")
Composition & Framing — specify shot type, camera angle, depth of field
Setting & Cultural Grounding — include specific South African environmental details where relevant

Rules:

Write in flowing prose sentences, not comma-separated tags
End with "Photorealistic."
Do not include character names — describe appearance inline if needed
Do not add LoRA tags, weights, or technical parameters
CRITICAL: Preserve all physical and body descriptions EXACTLY as written — do not soften, euphemise, reword, or tone down any anatomical details. If the user describes large breasts, a large ass, explicit nudity, or any other body attribute, reproduce that description faithfully in the enhanced prompt.
Return ONLY the enhanced prompt, nothing else`;
}

/**
 * Enhance an image prompt using Claude.
 * Returns the enhanced prompt text, or the original prompt if enhancement fails.
 */
export async function enhancePromptForScene(
  prompt: string,
  opts: { nsfw: boolean },
): Promise<string> {
  const trimmed = prompt.trim();
  if (!trimmed) return trimmed;

  try {
    const anthropic = new Anthropic();

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      system: buildSystemPrompt(opts.nsfw),
      messages: [{ role: "user", content: trimmed }],
    });

    const enhanced =
      message.content[0].type === "text" ? message.content[0].text.trim() : trimmed;

    return enhanced;
  } catch (err) {
    console.error("[PromptEnhancer] Enhancement failed, using original:", err);
    return trimmed;
  }
}
