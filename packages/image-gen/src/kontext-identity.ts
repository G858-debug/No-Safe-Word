import type { CharacterData } from "@no-safe-word/shared";

/**
 * Build a natural-language identity prefix for Kontext prompts.
 *
 * Kontext doesn't use SDXL-style tag injection — instead, character identity
 * is conveyed through a descriptive paragraph prepended to the scene prompt.
 * The reference image handles visual consistency; this text anchors the model
 * on ethnicity, build, and clothing details that the reference alone can't
 * guarantee (e.g. body proportions, specific hair style, skin tone).
 *
 * Returns a multi-sentence string ending with a newline.
 */
export function buildKontextIdentityPrefix(charData: CharacterData): string {
  const sentences: string[] = [];

  // ── 1. Ethnicity + face sentence ──
  const faceParts: string[] = [];
  if (charData.ethnicity) faceParts.push(charData.ethnicity);
  if (charData.gender === "female") faceParts.push("woman");
  else if (charData.gender === "male") faceParts.push("man");
  else faceParts.push("person");
  if (charData.age) faceParts.push(`${charData.age} years old`);
  if (charData.distinguishingFeatures) faceParts.push(charData.distinguishingFeatures);
  if (charData.eyeColor) faceParts.push(`${charData.eyeColor} eyes`);
  if (charData.skinTone) faceParts.push(`${charData.skinTone} skin`);
  // Hair as a combined phrase
  const hairParts: string[] = [];
  if (charData.hairColor) hairParts.push(charData.hairColor);
  if (charData.hairStyle) hairParts.push(charData.hairStyle);
  if (hairParts.length > 0) faceParts.push(hairParts.join(" "));

  if (faceParts.length > 0) {
    sentences.push(faceParts.join(", ") + ".");
  }

  // ── 2. Body sentence ──
  const bt = (charData.bodyType || "").toLowerCase();
  if (bt) {
    const bodyParts: string[] = [charData.bodyType];

    const hasLargeBreasts = /large breasts|full breasts|big breasts|busty/i.test(bt);
    if (hasLargeBreasts && !/large breasts/i.test(bt)) {
      bodyParts.push("large breasts");
    }

    const hasCurvyRear = /large butt|big ass|round hips|full hips|curvy/i.test(bt);
    if (hasCurvyRear && !/full round ass/i.test(bt)) {
      bodyParts.push("full round ass, wide hips");
    }

    const hasSlimWaist = /slim waist|defined waist/i.test(bt);
    if (hasSlimWaist && !/slim waist/i.test(bt)) {
      bodyParts.push("slim waist");
    }

    sentences.push(bodyParts.join(", ") + ".");
  }

  // ── 3. Clothing ──
  // Intentionally omitted from the identity prefix. The scene prompt controls
  // what the character wears in each image — injecting default clothing here
  // would conflict with scene-specific wardrobe choices and confuse Kontext.

  if (sentences.length === 0) return "";
  return sentences.join(" ") + "\n";
}
