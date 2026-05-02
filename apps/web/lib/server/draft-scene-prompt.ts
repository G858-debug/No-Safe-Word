import {
  BRAND_PREFERENCE_NOTE,
  VISUAL_SIGNATURE,
  callMistral,
  endsWithVisualSignature,
  loadHunyuanKnowledge,
} from "./mistral-prompt-helpers";
import {
  buildSceneCharacterBlock,
  type PortraitCharacterDescription,
} from "@no-safe-word/image-gen";

// ============================================================
// Scene image prompt drafting service (Hunyuan)
// ============================================================
// Calls Mistral Large to assemble a single final scene-image prompt,
// replacing the deterministic `assembleHunyuanPrompt()` string-concat
// path. Used by:
//   - POST /api/stories/images/[promptId]/draft-prompt    (manual re-draft)
//   - POST /api/stories/[seriesId]/generate-image         (auto-draft if final_prompt is null)
//
// Mistral receives:
//   - The structured/approved character descriptions (characters.description)
//     for each linked character — NOT portrait_prompt_locked, which carries
//     portrait framing language that has historically polluted scene prompts.
//   - Knowledge that approved portraits ARE being sent as i2i reference
//     images, so it can lean on the references for identity instead of
//     re-describing faces/skin/hair in text.
//   - The scene description (the editable narrative beat).
//   - Image type (SFW/NSFW), clothing, SFW constraint, visual signature.
//   - Brand colour preference (crimson/burgundy/amber/gold).
//   - The hunyuan-knowledge.md reference doc for composition/lighting vocab.
//
// Mistral returns a single string that is sent verbatim to Siray. If the
// user edits the returned text on the image card, the edited text wins.
// ============================================================

export type DraftSceneImageType =
  | "facebook_sfw"
  | "website_nsfw_paired"
  | "website_only"
  | "shared";

export interface DraftSceneCharacter {
  name: string;
  /** characters.description — structured/approved seed JSON. */
  description: PortraitCharacterDescription & { clothing?: string };
  /** True iff characters.approved_image_id is set (i2i reference will be sent). */
  hasApprovedPortrait: boolean;
}

export interface DraftScenePromptInput {
  imageType: DraftSceneImageType;
  aspectRatio: string;
  primaryCharacter?: DraftSceneCharacter;
  secondaryCharacter?: DraftSceneCharacter;
  scenePrompt: string;
  clothingOverride?: string | null;
  sfwConstraintOverride?: string | null;
  visualSignatureOverride?: string | null;
}

const DEFAULT_SFW_CONSTRAINT = "Both characters fully clothed. No nudity.";

function buildSystemPrompt(knowledgeDoc: string): string {
  return `You write final image generation prompts for No Safe Word romance fiction scene illustrations. Each prompt is rendered photorealistically by HunyuanImage 3.0 (Instruct, i2i variant) on Siray.ai.

Your job is to read structured inputs (character descriptions, scene description, clothing, image type, visual signature) and produce ONE single final prompt string that will be sent verbatim to the model. Return only the prompt — no JSON, no preamble, no commentary.

CRITICAL — THE i2i REFERENCE IS A FACE PORTRAIT ONLY:
- Each linked character's approved portrait is passed to the model as an i2i reference image. The user message will tell you which characters' portraits are being sent.
- That reference is a head-and-shoulders FACE PORTRAIT. It carries the character's face, skin, eyes, hair, and head/shoulders only — NOT their body proportions, NOT their wardrobe, NOT the setting.
- For characters WITH a reference image:
  - Do NOT redescribe their face, skin, eyes, hair, or distinguishing facial features. The reference handles those — competing text degrades likeness.
  - DO describe their BODY using the body type / silhouette / build supplied in the user message (e.g. "curvaceous, very large heavy breasts, deep cleavage, narrow waist, very wide hips, thick thighs, large round protruding butt"). The reference image is FACE-ONLY, so body proportions only land if you state them explicitly. Place this description near the start of the character's clause so it carries weight.
  - DO describe what they are WEARING for this scene, where they are LOOKING, and HOW they are positioned.
- For background figures or unnamed extras: describe them inline (no reference exists for them).

IMAGE-TYPE RULES:
- facebook_sfw / shared: characters MUST be fully clothed and clothing MUST be described specifically. No nudity. Use the "moment before" — anticipation, tension, revealing-but-covered clothing. Add the SFW constraint sentence verbatim near the end: "Both characters fully clothed. No nudity." (or the override the user has set).
- website_nsfw_paired / website_only: explicit. Use direct anatomical language. Do NOT euphemise. Do NOT describe clothing for nude scenes.

COMPOSITION:
- Match the shot type to what the scene needs. If the user's scene description says "two-shot, on their faces", the camera is at face level — body proportions cannot show. If the scene calls for body language or full-figure detail, use a 3/4 shot (mid-thigh up) or full-body framing. Do not default to face close-ups when the scene wants more.
- Name the lighting source specifically (candlelight, single amber pendant lamp, golden-hour through window, neon street light) — never "warm lighting".
- State the camera angle (eye-level, low angle, overhead).
- Specify the South African setting (Soweto bedroom, Sandton apartment, Middelburg, township kitchen) — never generic "African".

${BRAND_PREFERENCE_NOTE}

COMPOSITION ORDER (earlier tokens carry more weight):
[character names + what they're doing] → [setting + props] → [lighting source] → [camera angle / framing] → [atmosphere] → [SFW constraint if applicable] → [Visual Signature]

The Visual Signature MUST appear verbatim at the very end of the prompt:
"${VISUAL_SIGNATURE}"

Return only the final prompt as one block of natural-language prose. No JSON, no markdown, no labels, no preamble.

================================================================
Reference: HunyuanImage 3.0 prompting knowledge from the codebase.
Use this to choose lighting/composition vocabulary that the model is
known to respond to. Do not echo the document; just internalise its
guidance.
================================================================
${knowledgeDoc}`;
}

function describeCharacter(c: DraftSceneCharacter): string {
  const prose = buildSceneCharacterBlock(c.name, c.description);
  const bodyType = c.description.bodyType?.trim();
  const clothing = c.description.clothing?.trim();
  const refNote = c.hasApprovedPortrait
    ? "    (FACE-ONLY i2i reference image will be sent — do not redescribe face/skin/eyes/hair, but DO describe body/silhouette/build because the reference does not carry those)"
    : "    (no i2i reference — describe the character inline including face)";
  const bodyLine = bodyType
    ? `    Body type / silhouette to render in this image (REQUIRED in your prompt): ${bodyType}`
    : "";
  const clothingLine = clothing
    ? `    Default wardrobe (use unless the scene needs different clothing): ${clothing}`
    : "";
  return [`  - ${c.name}: ${prose}`, refNote, bodyLine, clothingLine]
    .filter(Boolean)
    .join("\n");
}

function buildUserPrompt(input: DraftScenePromptInput): string {
  const lines: string[] = [];
  lines.push(`Image type: ${input.imageType}`);
  lines.push(`Aspect ratio: ${input.aspectRatio}`);
  lines.push("");
  lines.push("Linked characters (approved canonical descriptions):");
  if (input.primaryCharacter) {
    lines.push(describeCharacter(input.primaryCharacter));
  }
  if (input.secondaryCharacter) {
    lines.push(describeCharacter(input.secondaryCharacter));
  }
  if (!input.primaryCharacter && !input.secondaryCharacter) {
    lines.push("  (no linked characters — purely environmental/background scene)");
  }
  lines.push("");
  lines.push("Scene description (the narrative beat):");
  lines.push(input.scenePrompt.trim());
  lines.push("");

  const isSfw = input.imageType === "facebook_sfw" || input.imageType === "shared";
  if (isSfw) {
    if (input.clothingOverride && input.clothingOverride.trim()) {
      lines.push(`Clothing override (use this verbatim, ignore default wardrobes): ${input.clothingOverride.trim()}`);
    }
    const sfwConstraint = input.sfwConstraintOverride?.trim() || DEFAULT_SFW_CONSTRAINT;
    lines.push(`SFW constraint (must appear in the final prompt): ${sfwConstraint}`);
  }

  const signature = input.visualSignatureOverride?.trim() || VISUAL_SIGNATURE;
  lines.push("");
  lines.push(`Visual Signature (must appear VERBATIM at the very end): ${signature}`);
  lines.push("");
  lines.push("Write the final image generation prompt now. One block of natural-language prose. No JSON, no labels, no preamble.");

  return lines.join("\n");
}

/**
 * Draft a final scene-image prompt with Mistral Large. Returns the raw
 * prompt text (already trimmed). Throws if Mistral fails or the response
 * doesn't end with the Visual Signature.
 */
export async function draftScenePrompt(
  input: DraftScenePromptInput
): Promise<string> {
  if (!input.scenePrompt || !input.scenePrompt.trim()) {
    throw new Error("Cannot draft scene prompt: scenePrompt is empty");
  }

  const systemPrompt = buildSystemPrompt(loadHunyuanKnowledge());
  const userPrompt = buildUserPrompt(input);

  const rawText = await callMistral(systemPrompt, userPrompt);

  if (!endsWithVisualSignature(rawText)) {
    throw new Error(
      `Mistral scene prompt did not end with the Visual Signature (model drift). Raw response: ${rawText}`
    );
  }

  return rawText;
}
