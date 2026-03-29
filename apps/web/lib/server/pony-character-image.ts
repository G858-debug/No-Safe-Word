/**
 * Character approval image generation for the Pony V4 (pony_cyberreal) pipeline.
 *
 * Generates face portraits and full-body shots using CyberRealistic Pony Semi-Realistic v4.5
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

// ── Skin Tone Mapper ──

/**
 * Convert a character's described skin tone to Pony-compatible booru tags.
 *
 * Maps faithfully to the character's ACTUAL specified tone.
 * A light-skinned Black character gets light-brown skin tags, not dark.
 * African identity comes from facial features and hair texture, not just skin darkness.
 */
function mapSkinToneToPonyTags(skinTone: string, gender: string): string[] {
  if (!skinTone) return [];
  const tone = skinTone.toLowerCase();
  const genderSuffix = gender === "male" ? "male" : "female";

  if (tone.includes("ebony") || tone.includes("very dark") || tone.includes("deep dark")) {
    return [`dark-skinned ${genderSuffix}`, "dark skin"];
  }
  if (tone.includes("dark chocolate") || tone.includes("dark brown") || tone.includes("deep brown")) {
    return [`dark-skinned ${genderSuffix}`, "dark skin", "brown skin"];
  }
  if (tone.includes("chocolate") || tone.includes("brown") || tone.includes("warm brown") || tone.includes("medium-dark")) {
    return [`dark-skinned ${genderSuffix}`, "brown skin"];
  }
  if (tone.includes("caramel") || tone.includes("tawny") || tone.includes("honey") || tone.includes("medium")) {
    return ["brown skin", `dark-skinned ${genderSuffix}`];
  }
  if (tone.includes("light brown") || tone.includes("golden") || tone.includes("amber") || tone.includes("light")) {
    return ["brown skin"];
  }
  if (tone.includes("olive") || tone.includes("tan")) {
    return ["tan", "brown skin"];
  }
  if (tone.includes("fair") || tone.includes("pale")) {
    return ["pale skin"];
  }

  // Default: use dark-skinned as fallback
  return [`dark-skinned ${genderSuffix}`, "brown skin"];
}

// ── Ethnicity Mapper ──

/**
 * Convert ethnicity to booru tags representing African facial features and hair texture.
 *
 * These tags work ALONGSIDE skin tone (handled separately) to produce
 * characters that are recognisably Black African across all skin tones.
 * A light-skinned Black woman should still have African facial features.
 */
function mapEthnicityToPonyTags(ethnicity: string): string[] {
  if (!ethnicity) return [];
  const eth = ethnicity.toLowerCase();

  if (
    eth.includes("african") || eth.includes("black") ||
    eth.includes("zulu") || eth.includes("xhosa") || eth.includes("ndebele") ||
    eth.includes("sotho") || eth.includes("tswana") || eth.includes("venda") ||
    eth.includes("tsonga") || eth.includes("pedi") || eth.includes("swazi")
  ) {
    return ["full lips", "broad nose", "afro-textured hair"];
  }

  if (eth.includes("coloured") || eth.includes("mixed") || eth.includes("cape malay")) {
    return ["full lips"];
  }

  if (eth.includes("indian") || eth.includes("south asian")) {
    return ["brown skin"];
  }

  return [];
}

// ── Prompt Builders ──

/**
 * Build a booru-style face portrait prompt for CyberRealistic Pony Semi-Realistic.
 */
function buildPonyFacePrompt(charData: CharacterData): string {
  const genderTag = charData.gender === "male" ? "1boy" : "1girl";
  const tags: string[] = [genderTag];

  // Skin tone + ethnicity via mappers, deduplicated
  const skinTags = mapSkinToneToPonyTags(charData.skinTone, charData.gender);
  const ethnicityTags = mapEthnicityToPonyTags(charData.ethnicity);
  const identityTags = skinTags.concat(ethnicityTags.filter((t) => !skinTags.includes(t)));
  tags.push(...identityTags);

  // Hair (texture comes from ethnicity mapper, style from charData)
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
  );

  return tags.join(", ");
}

/**
 * Build a booru-style full-body prompt for CyberRealistic Pony Semi-Realistic.
 */
function buildPonyBodyPrompt(charData: CharacterData): string {
  const genderTag = charData.gender === "male" ? "1boy" : "1girl";
  const tags: string[] = [genderTag];

  // Skin tone + ethnicity via mappers, deduplicated
  const skinTags = mapSkinToneToPonyTags(charData.skinTone, charData.gender);
  const ethnicityTags = mapEthnicityToPonyTags(charData.ethnicity);
  const identityTags = skinTags.concat(ethnicityTags.filter((t) => !skinTags.includes(t)));
  tags.push(...identityTags);

  // Hair
  if (charData.hairColor) tags.push(`${charData.hairColor.toLowerCase()} hair`);
  if (charData.hairStyle) tags.push(charData.hairStyle.toLowerCase());

  // Eyes
  if (charData.eyeColor) tags.push(`${charData.eyeColor.toLowerCase()} eyes`);

  // Body type (female characters get detailed body tags)
  if (charData.gender === "female") {
    tags.push("wide hips", "large breasts", "thick thighs", "narrow waist", "voluptuous");
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
  );

  return tags.join(", ");
}

/**
 * Build the character generation payload for CyberRealistic Pony Semi-Realistic.
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

  // Dimensions — portrait orientation for both
  const width = 832;
  const height = 1216;

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
