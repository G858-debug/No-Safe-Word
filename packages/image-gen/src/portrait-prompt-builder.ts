import { VISUAL_SIGNATURE } from "./hunyuan-generator";

/**
 * Subset of the structured character description used to build a portrait
 * prompt. Matches the fields stored on `characters.description` by the
 * Story Publisher import pipeline (see CharacterStructured in @no-safe-word/shared).
 */
export interface PortraitCharacterDescription {
  gender?: string;
  age?: string;
  ethnicity?: string;
  bodyType?: string;
  hairColor?: string;
  hairStyle?: string;
  eyeColor?: string;
  skinTone?: string;
  distinguishingFeatures?: string;
  expression?: string;
}

/**
 * Framing/lighting clause for a face portrait (medium close-up, head and shoulders).
 */
const PORTRAIT_COMPOSITION =
  "Portrait, looking directly at the camera with a confident expression. Warm side-lighting, dark background with soft bokeh. Medium close-up, eye-level.";

/**
 * Framing/lighting clause for a full-body shot (head to feet, complete figure).
 */
const FULLBODY_COMPOSITION =
  "Full body shot, standing upright, looking directly at the camera with a confident expression. Warm side-lighting, plain dark background. Full-length from head to feet, showing entire figure including legs and feet.";

/**
 * Build a natural-language portrait prompt from structured character fields.
 *
 * Used by BOTH flux2_dev and hunyuan3 character-portrait generation. The
 * output is a single paragraph that describes the character, then a fixed
 * portrait framing, then the shared visual signature. Safe to pass directly
 * to either backend.
 *
 * Pass `stage: "body"` to get a full-length framing instead of a close-up.
 */
export function buildCharacterPortraitPrompt(
  description: PortraitCharacterDescription,
  stage: "face" | "body" = "face"
): string {
  const parts: string[] = [];

  // Who — gender + age
  const whoBits: string[] = [];
  if (description.gender) whoBits.push(description.gender.trim());
  if (description.age) whoBits.push(`age ${description.age.trim()}`);
  if (whoBits.length > 0) {
    parts.push(`A ${whoBits.join(", ")}.`);
  }

  if (description.ethnicity) {
    parts.push(`${description.ethnicity.trim()}.`);
  }

  // Appearance sentence — skin, eyes, features
  const appearance: string[] = [];
  if (description.skinTone) appearance.push(`${description.skinTone.trim()} skin`);
  if (description.eyeColor) appearance.push(`${description.eyeColor.trim()} eyes`);
  if (description.distinguishingFeatures) {
    appearance.push(description.distinguishingFeatures.trim());
  }
  if (appearance.length > 0) {
    parts.push(`${capitalize(appearance.join(", "))}.`);
  }

  // Body
  if (description.bodyType) {
    parts.push(`${capitalize(description.bodyType.trim())}.`);
  }

  // Hair — combine colour + style when both present
  const hair: string[] = [];
  if (description.hairColor) hair.push(description.hairColor.trim());
  if (description.hairStyle) hair.push(description.hairStyle.trim());
  if (hair.length > 0) {
    parts.push(`${capitalize(hair.join(" "))} hair.`);
  }

  if (description.expression) {
    parts.push(`${capitalize(description.expression.trim())}.`);
  }

  parts.push(stage === "body" ? FULLBODY_COMPOSITION : PORTRAIT_COMPOSITION);
  parts.push(VISUAL_SIGNATURE);

  return parts.join(" ");
}

/**
 * Build a minimal character identity block for SCENE generation.
 *
 * Intentionally excludes bodyType (overrides scene clothing) and all
 * portrait composition/lighting/framing text (conflicts with scene setting).
 * Only face, skin, hair, and basic identity — enough for the model to
 * recognise the character without fighting the scene prompt.
 */
export function buildSceneCharacterBlock(
  name: string,
  description: PortraitCharacterDescription
): string {
  const parts: string[] = [];

  // Identity line: "Lindiwe, Black South African woman, 24."
  const who: string[] = [name];
  if (description.ethnicity) who.push(description.ethnicity.trim());
  if (description.gender) who.push(description.gender.trim());
  if (description.age) who.push(description.age.trim());
  parts.push(who.join(", ") + ".");

  // Skin + hair + eyes
  const appearance: string[] = [];
  if (description.skinTone) appearance.push(`${description.skinTone.trim()} skin`);
  const hair: string[] = [];
  if (description.hairColor) hair.push(description.hairColor.trim());
  if (description.hairStyle) hair.push(description.hairStyle.trim());
  if (hair.length > 0) appearance.push(`${hair.join(" ")} hair`);
  if (description.eyeColor) appearance.push(`${description.eyeColor.trim()} eyes`);
  if (appearance.length > 0) parts.push(capitalize(appearance.join(", ")) + ".");

  // Face / distinguishing features
  if (description.distinguishingFeatures) {
    parts.push(capitalize(description.distinguishingFeatures.trim()) + ".");
  }

  // Body shape — included for character consistency. Portrait framing text
  // (which was in portrait_prompt_locked and caused clothing overrides) is
  // intentionally absent; the scene prompt controls clothing and composition.
  if (description.bodyType) {
    parts.push(capitalize(description.bodyType.trim()) + ".");
  }

  return parts.join(" ");
}

function capitalize(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}
