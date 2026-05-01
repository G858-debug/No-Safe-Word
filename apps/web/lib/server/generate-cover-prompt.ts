import fs from "node:fs";
import path from "node:path";
import type { BlurbCharacterInput } from "./generate-blurbs";

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

const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";
const MISTRAL_MODEL = "mistral-large-latest";

export type CoverPromptImageModel = "flux2_dev" | "hunyuan3";

export interface GenerateCoverPromptInput {
  seriesId: string;
  title: string;
  fullStoryText: string;
  characters: BlurbCharacterInput[];
  imageModel: CoverPromptImageModel;
}

const VISUAL_SIGNATURE =
  "Cinematic shallow depth of field. Rich shadows with luminous highlights. Soft skin glow. Intimate framing. Editorial photography quality. Photorealistic.";

const BRAND_PREFERENCE_NOTE = `BRAND PREFERENCE — apply where it fits the scene, do not force it:
No Safe Word's visual identity favours crimson, burgundy, amber, and gold. Try to weave at least one of these into the cover naturally — through wardrobe (a burgundy slip dress, an amber silk shirt), practical lighting (candlelight, a warm amber lamp, golden-hour wash), or set dressing (a crimson throw on the bed, gold jewellery, a brass lamp). Do not force a brand colour into a scene where it would look implausible — but if there's a natural opportunity, take it. The reader should feel the brand without seeing a logo.`;

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

let cachedHunyuanKnowledge: string | null = null;

/**
 * Load `packages/image-gen/src/prompts/hunyuan-knowledge.md` from disk
 * once and cache. Resolves relative to the monorepo root via
 * `process.cwd()` (which is `apps/web` at runtime in both dev and the
 * Railway production build, since Next.js runs from the app directory).
 *
 * Falls back to an empty string if the file isn't found — the Hunyuan
 * branch will still work, just without the embedded knowledge. Logs a
 * warning so the drift is visible.
 */
function loadHunyuanKnowledge(): string {
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
    "[generate-cover-prompt] hunyuan-knowledge.md not found at any candidate path; Hunyuan rewrites will run without embedded knowledge"
  );
  cachedHunyuanKnowledge = "";
  return "";
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

interface MistralChoice {
  message?: { content?: string };
}
interface MistralResponse {
  choices?: MistralChoice[];
}

async function callMistral(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error("MISTRAL_API_KEY is not set");
  }

  const response = await fetch(MISTRAL_API_URL, {
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
      max_tokens: 2048,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Mistral API ${response.status}: ${body || response.statusText}`);
  }

  const data = (await response.json()) as MistralResponse;
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) {
    throw new Error(
      `Mistral response had no text content. Raw: ${JSON.stringify(data)}`
    );
  }
  return text;
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
