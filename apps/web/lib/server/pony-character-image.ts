/**
 * Character approval image generation for the Pony V4 (pony_cyberreal) pipeline.
 *
 * Generates face portraits and full-body shots using CyberRealistic Pony v17
 * via RunPod/ComfyUI. Both stages produce actual images (unlike V3 where body
 * is text-only).
 *
 * Uses booru-style tags and SDXL negative prompts for maximum control.
 */

import {
  buildPonyWorkflow,
  buildPonyQualityPrefix,
  buildPonyNegativePrompt,
} from "@no-safe-word/image-gen";
import type { CharacterData } from "@no-safe-word/shared";

type ImageType = "portrait" | "fullBody";
type GenerationStage = "face" | "body";

export interface PonyCharacterPayload {
  engine: "runpod-pony";
  workflow: Record<string, any>;
  positivePrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  seed: number;
}

/** Case-insensitive check for Black/African ethnicity */
function isBlackAfrican(ethnicity: string): boolean {
  const lower = ethnicity.toLowerCase();
  return lower.includes("black") || lower.includes("african") || lower.includes("dark");
}

/**
 * Build a booru-style face portrait prompt for CyberRealistic Pony.
 */
function buildPonyFacePrompt(charData: CharacterData): string {
  const genderTag = charData.gender === "male" ? "1boy" : "1girl";
  const tags: string[] = [genderTag];

  // Skin/ethnicity
  if (charData.skinTone) tags.push(`${charData.skinTone} skin`);
  if (charData.ethnicity && isBlackAfrican(charData.ethnicity)) {
    tags.push("dark-skinned female", "african");
  }

  // Hair
  if (charData.hairColor) tags.push(`${charData.hairColor.toLowerCase()} hair`);
  if (charData.hairStyle) tags.push(charData.hairStyle.toLowerCase());

  // Eyes
  if (charData.eyeColor) tags.push(`${charData.eyeColor.toLowerCase()} eyes`);

  // Age
  if (charData.age) tags.push(`${charData.age} years old`);

  // Distinguishing features
  if (charData.distinguishingFeatures) {
    tags.push(charData.distinguishingFeatures.toLowerCase());
  }

  // Portrait composition
  tags.push(
    "looking at viewer",
    "slight smile",
    "beautiful face",
    "detailed eyes",
    "portrait",
    "head and shoulders",
    "face focus",
    "soft studio lighting",
    "clean background",
    "shallow depth of field",
    "photorealistic",
  );

  return tags.join(", ");
}

/**
 * Build a booru-style full-body prompt for CyberRealistic Pony.
 */
function buildPonyBodyPrompt(charData: CharacterData): string {
  const genderTag = charData.gender === "male" ? "1boy" : "1girl";
  const tags: string[] = [genderTag];

  // Skin/ethnicity
  if (charData.skinTone) tags.push(`${charData.skinTone} skin`);
  if (charData.ethnicity && isBlackAfrican(charData.ethnicity)) {
    tags.push("dark-skinned female", "african");
  }

  // Hair
  if (charData.hairColor) tags.push(`${charData.hairColor.toLowerCase()} hair`);
  if (charData.hairStyle) tags.push(charData.hairStyle.toLowerCase());

  // Eyes
  if (charData.eyeColor) tags.push(`${charData.eyeColor.toLowerCase()} eyes`);

  // Body type (critical for Pony — booru tags give great body control)
  if (charData.gender === "female") {
    tags.push(
      "curvy",
      "wide hips",
      "large breasts",
      "thick thighs",
      "narrow waist",
      "voluptuous",
    );
    if (charData.bodyType) tags.push(charData.bodyType.toLowerCase());
  } else {
    if (charData.bodyType) tags.push(charData.bodyType.toLowerCase());
  }

  // Age
  if (charData.age) tags.push(`${charData.age} years old`);

  // Distinguishing features
  if (charData.distinguishingFeatures) {
    tags.push(charData.distinguishingFeatures.toLowerCase());
  }

  // Clothing (female default: fitted mini skirt + crop top; male: casual)
  if (charData.gender === "female") {
    tags.push(
      "fitted mini skirt",
      "strappy crop top",
      "high heels",
      "fully clothed",
    );
  } else {
    tags.push(
      "fitted henley shirt",
      "jeans",
      "casual clothing",
      "fully clothed",
    );
  }

  // Full body composition
  tags.push(
    "standing",
    "confident pose",
    "looking at viewer",
    "full body",
    "head to toe",
    "warm studio lighting",
    "clean background",
    "photorealistic",
  );

  return tags.join(", ");
}

/**
 * Build the character generation payload for CyberRealistic Pony.
 */
export function buildPonyCharacterGenerationPayload(opts: {
  character: { id: string; name: string; description: Record<string, string> };
  imageType: ImageType;
  stage: GenerationStage;
  seed?: number;
  customPrompt?: string;
}): PonyCharacterPayload {
  const { character, stage, customPrompt } = opts;
  const desc = character.description;

  const charData: CharacterData = {
    name: character.name,
    gender: (desc.gender as CharacterData["gender"]) || "female",
    ethnicity: desc.ethnicity || "",
    bodyType: desc.bodyType || "",
    hairColor: desc.hairColor || "",
    hairStyle: desc.hairStyle || "",
    eyeColor: desc.eyeColor || "",
    skinTone: desc.skinTone || "",
    distinguishingFeatures: desc.distinguishingFeatures || "",
    clothing: desc.clothing || "",
    pose: desc.pose || "",
    expression: desc.expression || "",
    age: desc.age || "",
  };

  const seed = opts.seed || Math.floor(Math.random() * 2_147_483_647) + 1;
  const mode: "sfw" | "nsfw" = "sfw"; // Character approval is always SFW

  // Build prompt
  let sceneTags: string;
  if (customPrompt) {
    sceneTags = customPrompt;
  } else if (stage === "face") {
    sceneTags = buildPonyFacePrompt(charData);
  } else {
    sceneTags = buildPonyBodyPrompt(charData);
  }

  const qualityPrefix = buildPonyQualityPrefix(mode);
  const positivePrompt = `${qualityPrefix}, ${sceneTags}`;
  const negativePrompt = buildPonyNegativePrompt(mode);

  // Dimensions
  const isFace = stage === "face";
  const width = isFace ? 832 : 832;
  const height = isFace ? 1216 : 1216; // Portrait orientation for both

  const workflow = buildPonyWorkflow({
    positivePrompt,
    negativePrompt,
    width,
    height,
    seed,
    filenamePrefix: `char_${character.id}_${stage}`,
  });

  return {
    engine: "runpod-pony",
    workflow,
    positivePrompt,
    negativePrompt,
    width,
    height,
    seed,
  };
}
