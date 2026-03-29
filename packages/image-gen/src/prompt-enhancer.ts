/**
 * Claude prompt enhancement for Pony CyberRealistic image generation.
 *
 * Converts rough scene descriptions into booru-style tags optimized for
 * CyberRealistic Pony Semi-Realistic v4.5.
 */

import Anthropic from "@anthropic-ai/sdk";

function buildSystemPrompt(nsfw: boolean): string {
  return `You are an expert at writing image generation prompts for CyberRealistic Pony Semi-Realistic (a stylized semi-realistic SDXL model based on Pony Diffusion V6).

OUTPUT FORMAT: Comma-separated booru-style tags ONLY. No prose sentences. No emphasis weights.

DO NOT include these (added separately by the pipeline):
- Quality tags (score_9, score_8_up, etc.)
- Rating tags (rating_safe, rating_explicit)
- Character trigger words
- Character physical descriptions (hair, skin, body — the LoRA handles these)

YOU MUST include tags for ALL FIVE LAYERS:

Layer 1 - Expression & Gaze: looking at viewer, half-lidded eyes, bedroom eyes, biting lip, parted lips, confident expression, vulnerable expression, eyes closed in pleasure, etc.

Layer 2 - Narrative Moment: leaning against car, hand reaching for zipper, sitting on edge of bed, pressing against wall, one heel on floor, fingers tracing jawline, etc.

Layer 3 - Lighting (SPECIFIC source, never generic): single amber streetlight, candlelight flickering shadows, bedside lamp warm glow, moonlight through curtains, neon sign through window, etc.

Layer 4 - Composition: close-up, medium shot, full body, low angle, high angle, two-shot, tight framing, shallow depth of field, over shoulder shot, etc.

Layer 5 - South African Setting (SPECIFIC, not generic): Middelburg night, Soweto township bedroom, Sandton hotel room, mechanic workshop, shweshwe fabric, Amarula bottle on nightstand, lace curtains, etc.

ALSO INCLUDE:
- Character count: 1girl, 1boy, 1girl 1boy, solo
- Pose: standing, sitting, lying, leaning, walking
- Clothing state for this specific scene
- Atmosphere: steam, sweat, rain on window, dust motes

TAG ORDER (important — earlier tags get more weight):
[character count], [pose/action], [expression/gaze], [clothing], [body interaction], [setting], [props], [lighting], [atmosphere], [composition]

FOR SFW IMAGES: Focus on the "moment before" — anticipation, tension, revealing-but-covered clothing. Use tags like: off-shoulder top, unbuttoned shirt, towel wrapped, bare shoulder, thigh gap. Expression does the heavy lifting.

FOR NSFW IMAGES: Be anatomically specific about positioning. Specify who is where: "1boy behind 1girl" not just "sex". Include hand placement, leg positioning, facial direction. Use explicit tags: nude, topless, sex, penetration as appropriate.

FOR PAIRED IMAGES: The NSFW version should describe the same setting (same room, same light source, same atmosphere) but advance the action: closer bodies, less clothing, expressions shift from confident to vulnerable.

This prompt is for a ${nsfw ? "NSFW explicit" : "SFW suggestive"} image.`;
}

/**
 * Enhance an image prompt using Claude.
 * Returns booru-style tags for Pony CyberRealistic, or the original prompt if enhancement fails.
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
      model: "claude-haiku-4-5-20251001",
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
