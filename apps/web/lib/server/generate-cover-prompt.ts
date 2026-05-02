import type { BlurbCharacterInput } from "./generate-blurbs";
import {
  BRAND_PREFERENCE_NOTE,
  VISUAL_SIGNATURE,
  callMistral,
  endsWithVisualSignature,
  loadHunyuanKnowledge,
} from "./mistral-prompt-helpers";

// ============================================================
// Cover prompt generation service
// ============================================================
// Calls Mistral Large to produce a single cover-image prompt for a
// story. Used by POST /api/stories/[seriesId]/regenerate-cover-prompt.
//
// Model-aware: switches on the series' image_model so the prompt is
// tuned to the downstream generator's preferences.
//   flux2_dev  → Flux-friendly tag-style prose, full character physical
//                descriptions OK (PuLID also gets reference images, but
//                Flux still listens to text well).
//   hunyuan3   → Hunyuan-tuned long natural sentences. Identity flows
//                through both i2i reference images AND the verbatim
//                portrait_prompt_locked text injected at generation time
//                — so the rewriter is told NOT to redescribe characters'
//                bodies/faces. It writes ONLY the scene around them.
//
// The Hunyuan branch also loads `packages/image-gen/src/prompts/
// hunyuan-knowledge.md` at runtime and embeds it in the system prompt
// so the model has access to tested lighting vocab, composition
// language, and "what to avoid" rules.
//
// The model is instructed to return prose, not JSON. We verify the
// response ends with the Visual Signature — if it doesn't, the model
// drifted and we throw so the caller can retry rather than saving a
// broken prompt.
// ============================================================

export type CoverPromptImageModel = "flux2_dev" | "hunyuan3";

export interface GenerateCoverPromptInput {
  seriesId: string;
  title: string;
  fullStoryText: string;
  characters: BlurbCharacterInput[];
  imageModel: CoverPromptImageModel;
}

const FLUX_SYSTEM_PROMPT = `You write image generation prompts for No Safe Word book covers. Each cover is a two-character intimate composition depicting the protagonist and primary love interest, rendered photorealistically via Flux 2 Dev.

Required elements (every cover prompt must include all of these):
- Two-character intimate composition
- Physical descriptions of both characters (pulled from their prose descriptions in the input)
- Specific pose and physical contact between them
- Expression and gaze direction for each
- Lighting source named specifically (candlelight, amber lamp, window light, etc.)
- South African setting detail
- Subjects composed in the upper two-thirds of the frame (typography goes in the lower third)
- Suggestive, not explicit (covers display publicly)
- Ends with the Visual Signature: "${VISUAL_SIGNATURE}"

${BRAND_PREFERENCE_NOTE}

Capture the emotional core of the whole story in one image — the central tension, not a specific scene.

Return a single string: the cover prompt. No JSON wrapper, no preamble, no commentary. Just the prompt.`;

function buildHunyuanSystemPrompt(knowledgeDoc: string): string {
  return `You write image generation prompts for No Safe Word book covers. Each cover is a two-character intimate composition depicting the protagonist and primary love interest, rendered photorealistically via HunyuanImage 3.0 (Instruct, i2i variant).

CRITICAL — IDENTITY IS HANDLED BY THE GENERATOR, NOT BY YOU:
- The protagonist's and love interest's approved portraits are passed to the model as i2i reference images. Identity (faces, bodies, skin, hair, distinguishing features) flows ENTIRELY through these reference images — Siray's i2i conditioning is strong enough that text identity prompts are not needed.
- Therefore your prompt MUST NOT describe the characters' bodies, faces, hair, skin, or distinguishing features. Doing so competes against the reference image and degrades likeness.
- You MAY name the characters and reference their roles ("protagonist," "love interest").
- You MAY (and should) describe what they are wearing for THIS cover, what they are doing, where they are looking, and how they are positioned relative to each other and the camera. The reference images do not constrain wardrobe — clothing is the user's main editorial lever for distinguishing this cover from the original portrait, so be specific.

Required elements (every cover prompt must include all of these):
- Two-character intimate composition
- Specific pose and physical contact between them (no body descriptions — only the action)
- Expression and gaze direction for each (referencing emotion, not face shape)
- Lighting source named specifically using cinematic vocabulary (golden hour, rim light, soft box and hair light, practical bedside lamp, window light with soft falloff, neon rim light, chiaroscuro)
- Lens / aperture / framing language (e.g. "85mm portrait, f/1.8 shallow depth of field," "medium shot at eye level")
- South African setting detail (specific place: Soweto bedroom, Sandton apartment, Middelburg farmhouse, Umhlanga balcony — never generic "African")
- Subjects composed in the upper two-thirds of the frame (typography goes in the lower third)
- Suggestive, not explicit (covers display publicly)
- Ends with the Visual Signature: "${VISUAL_SIGNATURE}"

${BRAND_PREFERENCE_NOTE}
Important constraint specific to this model: brand colours must NEVER appear in the characters' permanent features (hair, eyes, skin). Only in wardrobe, set dressing, or lighting.

Capture the emotional core of the whole story in one image — the central tension, not a specific scene.

Return a single string: the cover prompt. No JSON wrapper, no preamble, no commentary. Just the prompt.

================================================================
Reference: HunyuanImage 3.0 prompting knowledge from the codebase.
Use this to choose lighting/composition/setting vocabulary that the
model is known to respond to. Do not echo the document; just internalise
its guidance.
================================================================
${knowledgeDoc}`;
}

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

export async function generateCoverPromptForStory(
  input: GenerateCoverPromptInput
): Promise<string> {
  if (!input.fullStoryText || input.fullStoryText.trim().length === 0) {
    throw new Error(
      "Cannot generate cover prompt: fullStoryText is empty. Caller must ensure the series has at least one post with website_content before invoking."
    );
  }

  const systemPrompt =
    input.imageModel === "hunyuan3"
      ? buildHunyuanSystemPrompt(loadHunyuanKnowledge())
      : FLUX_SYSTEM_PROMPT;

  const rawText = await callMistral(systemPrompt, buildUserPrompt(input));

  if (!endsWithVisualSignature(rawText)) {
    throw new Error(
      `Mistral cover prompt did not end with the Visual Signature (model drift). Raw response: ${rawText}`
    );
  }

  return rawText;
}
