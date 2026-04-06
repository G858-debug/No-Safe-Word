/**
 * Claude prompt enhancement for Juggernaut Ragnarok image generation.
 *
 * Converts rough scene descriptions into optimized prompts:
 * - SFW: natural language with explicit clothing descriptions
 * - NSFW: natural language scene + Booru tags for anatomical precision
 *
 * See docs/skills/juggernaut-ragnarok/SKILL.md for prompt structure.
 */

import Anthropic from "@anthropic-ai/sdk";

function buildSystemPrompt(nsfw: boolean): string {
  const base = `You are a prompt engineer for Juggernaut XL Ragnarok, a photorealistic SDXL image generation model.

Convert the scene description into a concise image generation prompt UNDER 75 TOKENS.

PROMPT COMPONENT ORDER (earlier = more weight):
[subject], [action/pose], [clothing], [expression/gaze], [setting], [props], [lighting source], [atmosphere], [composition]

RULES:
- Use concise natural language, not booru/danbooru tag syntax
- Include specific lighting SOURCE (never "warm lighting" — name it: "candlelight", "single amber streetlight", "golden hour through window")
- Include camera angle and composition (medium shot, close-up, low angle, etc.)
- Do NOT include: quality tags, character identity (hair, skin, body — handled by LoRA), character count tags (1girl, 1boy)
- Output ONLY the prompt text. No explanations, no formatting.`;

  if (nsfw) {
    return `${base}

THIS IS AN NSFW EXPLICIT SCENE.
- Be anatomically specific about positioning and body parts
- Use natural language for scene context but include explicit positional tags
- Specify who is where: "woman lying on back, man above her" not vague euphemisms
- Include hand placement, leg positioning, expressions
- Do NOT sanitize or euphemize — the model requires specific content descriptors`;
  }

  return `${base}

THIS IS A SFW SCENE.
CRITICAL: Always include specific clothing descriptions — the model DEFAULTS TOWARD NUDITY without them.
- Focus on the "moment before" — anticipation, tension, revealing-but-covered clothing
- Add "fully clothed" if the scene should not show any skin
- Expression and body language do the heavy lifting for intimacy
- Include atmosphere tags: steam, dust motes, rain on window`;
}

/**
 * Enhance an image prompt using Claude.
 * Returns an optimized prompt for Juggernaut Ragnarok, or the original if enhancement fails.
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
