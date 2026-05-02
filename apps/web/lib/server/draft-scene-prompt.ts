import {
  BRAND_PREFERENCE_NOTE,
  VISUAL_SIGNATURE,
  callMistral,
  endsWithVisualSignature,
  loadHunyuanKnowledge,
} from "./mistral-prompt-helpers";

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
  /**
   * characters.portrait_prompt_locked — the exact text behind the
   * approved portrait. This is the canonical character description and
   * captures any edits the user made at portrait-approval time. It also
   * includes portrait framing/lighting language at the end which Mistral
   * is instructed to ignore.
   */
  lockedPromptText: string | null;
  /** characters.description.bodyType — structured body-type field, used as a fallback when lockedPromptText is missing. */
  fallbackBodyType?: string;
  /** characters.description.clothing — default wardrobe across the story. */
  defaultClothing?: string;
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
  /**
   * If a previous image was generated and an AI critique exists,
   * passing both lets Mistral iteratively improve — the previous prompt
   * is what was sent, the critique is what Pixtral 12B said went wrong.
   * Both must be present for the critique block to be sent.
   */
  previousFinalPrompt?: string | null;
  previousCritique?: string | null;
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
  - DO describe their BODY using the body type / silhouette / build / proportions in the canonical character text supplied in the user message (e.g. "curvaceous, very large heavy breasts, deep cleavage, narrow waist, very wide hips, thick thighs, large round protruding backside"). The reference image is FACE-ONLY, so body proportions only land if you state them explicitly. Place this description near the start of the character's clause so it carries weight.
  - DO describe what they are WEARING for this scene, where they are LOOKING, and HOW they are positioned.
- For background figures or unnamed extras: describe them inline (no reference exists for them).

CHARACTER TEXT SOURCE:
- For each linked character the user message includes a "Canonical character text" — this is the EXACT prompt the user approved when generating that character's portrait. It captures any edits the user made at approval time, so it is the source of truth for body type, build, hair colour/style, distinguishing features, and any other identity beats.
- That canonical text usually ends with portrait framing/lighting language ("Full body shot, standing upright, plain dark background, looking directly at the camera, warm side-lighting"). IGNORE that framing language — it belongs to the original portrait, not to this scene. Use the scene's own composition (from the scene description) and lighting (from the scene description) instead.
- Use the wardrobe in the canonical text only if the scene description doesn't specify what the character is wearing. If the user message includes a separate "Default wardrobe" line, prefer that. If a clothing override is present, prefer the override.

IMAGE-TYPE RULES:
- facebook_sfw / shared: characters MUST be fully clothed and clothing MUST be described specifically. No nudity. Use the "moment before" — anticipation, tension, revealing-but-covered clothing. Add the SFW constraint sentence verbatim near the end: "Both characters fully clothed. No nudity." (or the override the user has set).
- website_nsfw_paired / website_only: explicit. Use direct anatomical language. Do NOT euphemise. Do NOT describe clothing for nude scenes.

COMPOSITION:
- Match the shot type to what the scene needs. If the user's scene description says "two-shot, on their faces", the camera is at face level — body proportions cannot show. If the scene calls for body language or full-figure detail, use a 3/4 shot (mid-thigh up) or full-body framing. Do not default to face close-ups when the scene wants more.
- Name the lighting source specifically (candlelight, single amber pendant lamp, golden-hour through window, neon street light) — never "warm lighting".
- State the camera angle (eye-level, low angle, overhead).
- Specify the South African setting (Soweto bedroom, Sandton apartment, Middelburg, township kitchen) — never generic "African".

${BRAND_PREFERENCE_NOTE}

ITERATIVE IMPROVEMENT — PREVIOUS-IMAGE CRITIQUE:
- If the user message includes a "Previous prompt" + "AI critique of previous image" section, the user has already generated this scene at least once and Pixtral 12B has reviewed the result. Treat the critique as concrete, factual feedback about what went wrong in the previous image (wrong shot type, missing body proportions, wrong wardrobe, incorrect setting, etc.).
- Your job in that case is NOT to start from scratch — keep what worked, fix what the critique flagged. Read the previous prompt, identify which clauses produced the problems the critique describes, and rewrite ONLY those clauses. Preserve everything the critique didn't complain about.
- If the critique is positive (no issues raised), keep the previous prompt's structure but introduce small composition/lighting variations so a re-roll has a chance of producing a different acceptable result.
- Never repeat the previous prompt verbatim — the user clicked Re-draft because they want a change.

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
  const lockedText = c.lockedPromptText?.trim();
  const fallbackBody = c.fallbackBodyType?.trim();
  const clothing = c.defaultClothing?.trim();

  const refNote = c.hasApprovedPortrait
    ? "    (FACE-ONLY i2i reference image will be sent — do NOT redescribe face/skin/eyes/hair, but DO describe body/silhouette/build because the reference does not carry those)"
    : "    (no i2i reference — describe the character inline including face)";

  const lockedLine = lockedText
    ? `    Canonical character text (this is the EXACT prompt the user approved when generating this character's portrait — extract identity, body type, hair, distinguishing features from it; IGNORE any portrait framing/lighting/composition language at the end such as "Full body shot, plain dark background, looking directly at the camera"): ${lockedText}`
    : fallbackBody
      ? `    Body type / silhouette to render (REQUIRED in your prompt — no locked portrait text on file): ${fallbackBody}`
      : "    (no canonical character text and no fallback body type — describe the character based on what the scene needs)";

  const clothingLine = clothing
    ? `    Default wardrobe (use unless the scene needs different clothing): ${clothing}`
    : "";

  return [`  - ${c.name}:`, refNote, lockedLine, clothingLine]
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

  if (input.previousFinalPrompt?.trim() && input.previousCritique?.trim()) {
    lines.push("");
    lines.push("================================================================");
    lines.push("ITERATIVE RE-DRAFT — previous attempt + Pixtral 12B critique:");
    lines.push("================================================================");
    lines.push("Previous prompt that was sent to the model:");
    lines.push(input.previousFinalPrompt.trim());
    lines.push("");
    lines.push("AI critique of the resulting image (treat as concrete feedback to apply):");
    lines.push(input.previousCritique.trim());
  }
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
