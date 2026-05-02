import {
  VISUAL_SIGNATURE,
  PORTRAIT_COMPOSITION,
  FULLBODY_COMPOSITION,
} from "./prompt-constants";

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
 * Build a natural-language portrait prompt from structured character fields.
 *
 * Used by BOTH flux2_dev and hunyuan3 character-portrait generation. The
 * output is a single paragraph that describes the character, then either a
 * face- or body-framing clause, then the shared visual signature.
 *
 * `stage` defaults to "face" so existing callers are unaffected. Pass "body"
 * for the head-to-mid-thigh framing (introduced for the dual-output
 * face+body flow in PR-3b).
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
 * Build a character identity block for SCENE generation from the structured
 * `characters.description` JSONB.
 *
 * Used as the fallback path when `characters.portrait_prompt_locked` is null
 * (e.g. a character that hasn't gone through the full portrait approval flow
 * yet). The preferred scene-block source is `buildSceneCharacterBlockFromLocked`
 * which reuses the exact text that produced the approved portrait.
 *
 * Identity only — name, ethnicity, gender, age, skin, hair, eyes, distinguishing
 * features, and body shape. Excludes portrait framing/lighting (those belong
 * to the scene prompt, not the character block).
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

  if (description.bodyType) {
    parts.push(capitalize(description.bodyType.trim()) + ".");
  }

  return parts.join(" ");
}

/**
 * Resolve the canonical portrait text for a character.
 *
 * Returns `portrait_prompt_locked` (the exact text that produced the approved
 * portrait) if set, otherwise rebuilds from the structured description. Used
 * verbatim by the cover Hunyuan path; used by scene generation as input to
 * `stripPortraitFraming` + name prefixing via `buildSceneCharacterBlockFromLocked`.
 */
export function resolvePortraitText(
  locked: string | null,
  description: PortraitCharacterDescription
): string {
  return locked ?? buildCharacterPortraitPrompt(description);
}

const PORTRAIT_FRAMING_FRAGMENTS: readonly string[] = [
  PORTRAIT_COMPOSITION,
  VISUAL_SIGNATURE,
];

/**
 * Strip portrait framing/lighting/signature text from a portrait prompt.
 *
 * Removes any occurrence of `PORTRAIT_COMPOSITION` and `VISUAL_SIGNATURE`
 * (handles duplicates from a historical bug where the signature was
 * concatenated twice). Leaves the structural identity prefix intact.
 * Tolerates absent fragments.
 */
export function stripPortraitFraming(text: string): string {
  let out = text;
  for (const fragment of PORTRAIT_FRAMING_FRAGMENTS) {
    out = out.split(fragment).join(" ");
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Build a SCENE character block from the locked portrait prompt.
 *
 * Strips portrait composition/lighting/signature, then prepends the character's
 * name as a label so the model can bind name → body in multi-character scenes.
 * Format: `"<name>: <stripped identity prose>"`.
 *
 * Caller is responsible for falling back to `buildSceneCharacterBlock` when
 * `portrait_prompt_locked` is null.
 */
export function buildSceneCharacterBlockFromLocked(
  name: string,
  lockedText: string
): string {
  const stripped = stripPortraitFraming(lockedText);
  return `${name}: ${stripped}`;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}
