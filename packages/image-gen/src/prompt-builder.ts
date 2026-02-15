import type { CharacterData, SceneData } from "@no-safe-word/shared";

export function buildPrompt(
  character: CharacterData,
  scene: SceneData
): string {
  const parts: string[] = [];

  parts.push("masterpiece, best quality, highly detailed");

  if (character.age) parts.push(character.age);
  if (character.gender) parts.push(character.gender);
  if (character.ethnicity) parts.push(character.ethnicity);
  if (character.bodyType) parts.push(`${character.bodyType} body`);
  if (character.hairColor && character.hairStyle) {
    parts.push(`${character.hairColor} ${character.hairStyle} hair`);
  } else if (character.hairColor) {
    parts.push(`${character.hairColor} hair`);
  } else if (character.hairStyle) {
    parts.push(`${character.hairStyle} hair`);
  }
  if (character.eyeColor) parts.push(`${character.eyeColor} eyes`);
  if (character.skinTone) parts.push(`${character.skinTone} skin`);
  if (character.expression) parts.push(`${character.expression} expression`);
  if (character.clothing) parts.push(`wearing ${character.clothing}`);
  if (character.pose) parts.push(character.pose);
  if (character.distinguishingFeatures)
    parts.push(character.distinguishingFeatures);

  if (scene.setting) parts.push(scene.setting);
  if (scene.lighting) parts.push(`${scene.lighting} lighting`);
  if (scene.mood) parts.push(`${scene.mood} mood`);

  const modeDescription =
    scene.mode === "nsfw" ? scene.nsfwDescription : scene.sfwDescription;
  if (modeDescription) parts.push(modeDescription);

  if (scene.additionalTags.length > 0) parts.push(...scene.additionalTags);

  return parts.filter(Boolean).join(", ");
}

/**
 * Extract just the character-description tags from a full portrait prompt.
 * Strips the quality prefix and portrait-scene suffix that buildPortraitPrompt adds,
 * leaving only the appearance tags (age, gender, body, hair, eyes, etc.).
 */
export function extractCharacterTags(portraitPrompt: string): string {
  let result = portraitPrompt;

  // Strip quality prefix
  result = result.replace(
    /^masterpiece,\s*best quality,\s*highly detailed,\s*/i,
    ""
  );

  // Strip portrait-scene suffix (everything from "studio portrait" onwards)
  result = result.replace(
    /,\s*studio portrait,\s*clean neutral background.*/i,
    ""
  );

  return result.trim().replace(/,\s*$/, "");
}

export function buildNegativePrompt(scene: SceneData): string {
  const base =
    "(deformed, distorted, disfigured:1.3), poorly drawn, bad anatomy, wrong anatomy, extra limb, missing limb, floating limbs, mutated hands, extra fingers, missing fingers, blurry, bad quality, watermark, text, signature";

  if (scene.mode === "sfw") {
    return `${base}, nsfw, nude, naked, sexual`;
  }

  return base;
}
