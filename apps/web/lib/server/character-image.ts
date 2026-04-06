/**
 * Character approval image generation using Juggernaut Ragnarok via RunPod/ComfyUI.
 *
 * TODO: Refactor prompt builders for natural language (Prompt 3).
 * Currently still uses booru-style tags — will be updated when prompt-builder stubs are implemented.
 */

import {
  buildWorkflow,
  buildQualityPrefix,
  buildNegativePrompt,
} from "@no-safe-word/image-gen";
import type { CharacterData } from "@no-safe-word/shared";

type ImageType = "portrait" | "fullBody";
type GenerationStage = "face" | "body";

export interface CharacterGenerationPayload {
  engine: "runpod-comfyui";
  workflow: Record<string, any>;
  positivePrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  seed: number;
}

// ── Skin Tone Mapper ──

/**
 * Convert a character's described skin tone to booru tags.
 *
 * Maps faithfully to the character's ACTUAL specified tone.
 * A light-skinned Black character gets light-brown skin tags, not dark.
 * African identity comes from facial features and hair texture, not just skin darkness.
 */
function mapSkinToneToTags(skinTone: string, gender: string): string[] {
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
/**
 * Short male hairstyles where "afro-textured hair" would conflict and produce
 * an afro instead of the intended style. For these, the style tag alone is enough.
 */
const SHORT_MALE_HAIRSTYLES = [
  "fade", "buzz", "crew cut", "caesar", "bald", "shaved", "close crop",
  "taper", "flat top", "waves", "line up", "temple fade", "skin fade",
];

function hasShortMaleHairstyle(hairStyle: string): boolean {
  const style = hairStyle.toLowerCase();
  return SHORT_MALE_HAIRSTYLES.some((s) => style.includes(s));
}

function mapEthnicityToTags(ethnicity: string, opts?: { gender?: string; hairStyle?: string }): string[] {
  if (!ethnicity) return [];
  const eth = ethnicity.toLowerCase();

  if (
    eth.includes("african") || eth.includes("black") ||
    eth.includes("zulu") || eth.includes("xhosa") || eth.includes("ndebele") ||
    eth.includes("sotho") || eth.includes("tswana") || eth.includes("venda") ||
    eth.includes("tsonga") || eth.includes("pedi") || eth.includes("swazi")
  ) {
    const tags = ["full lips", "broad nose"];
    // Only add afro-textured hair if the character doesn't have a specific short male hairstyle
    // that would conflict (e.g. "low fade" + "afro-textured hair" = model generates an afro)
    const skipHairTexture =
      opts?.gender === "male" && opts?.hairStyle && hasShortMaleHairstyle(opts.hairStyle);
    if (!skipHairTexture) {
      tags.push("afro-textured hair");
    }
    return tags;
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
 * Build a booru-style face portrait prompt. TODO: Convert to natural language (Prompt 3).
 */
function buildFacePrompt(charData: CharacterData): string {
  const genderTag = charData.gender === "male" ? "1boy" : "1girl";
  const tags: string[] = [genderTag];

  // Skin tone + ethnicity via mappers, deduplicated
  const skinTags = mapSkinToneToTags(charData.skinTone, charData.gender);
  const ethnicityTags = mapEthnicityToTags(charData.ethnicity, {
    gender: charData.gender,
    hairStyle: charData.hairStyle,
  });
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

  // Portrait composition — gender-specific tags
  if (charData.gender === "male") {
    tags.push(
      "solo male", "male focus", "masculine",
      "handsome", "sharp jawline",
      "looking at viewer",
      "portrait", "head and shoulders", "face focus",
      "soft studio lighting", "clean background", "shallow depth of field",
    );
  } else {
    tags.push(
      "solo female",
      "looking at viewer", "slight smile",
      "beautiful face", "detailed eyes",
      "portrait", "head and shoulders", "face focus",
      "soft studio lighting", "clean background", "shallow depth of field",
    );
  }

  return tags.join(", ");
}

/**
 * Build a booru-style full-body prompt. TODO: Convert to natural language (Prompt 3).
 */
function buildBodyPrompt(charData: CharacterData): string {
  const genderTag = charData.gender === "male" ? "1boy" : "1girl";
  const tags: string[] = [genderTag];

  // Skin tone + ethnicity via mappers, deduplicated
  const skinTags = mapSkinToneToTags(charData.skinTone, charData.gender);
  const ethnicityTags = mapEthnicityToTags(charData.ethnicity, {
    gender: charData.gender,
    hairStyle: charData.hairStyle,
  });
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

  // Full body composition — gender-specific reinforcement
  if (charData.gender === "male") {
    tags.push(
      "solo male", "male focus", "masculine",
      "standing", "confident pose", "looking at viewer",
      "full body", "head to toe",
      "warm studio lighting", "clean background",
    );
  } else {
    tags.push(
      "solo female",
      "standing", "confident pose", "looking at viewer",
      "full body", "head to toe",
      "warm studio lighting", "clean background",
    );
  }

  return tags.join(", ");
}

/**
 * Build the character generation payload for Juggernaut Ragnarok.
 */
export function buildCharacterGenerationPayload(opts: {
  character: { id: string; name: string; description: Record<string, string> };
  imageType: ImageType;
  stage: GenerationStage;
  seed?: number;
  customPrompt?: string;
}): CharacterGenerationPayload {
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
    sceneTags = buildFacePrompt(charData);
  } else {
    sceneTags = buildBodyPrompt(charData);
  }

  const qualityPrefix = buildQualityPrefix(mode);
  const positivePrompt = `${qualityPrefix}, ${sceneTags}`;
  const negativePrompt = buildNegativePrompt(mode);

  // Dimensions — portrait orientation for both
  const width = 832;
  const height = 1216;

  const workflow = buildWorkflow({
    positivePrompt,
    negativePrompt,
    width,
    height,
    seed,
    filenamePrefix: `char_${character.id}_${stage}`,
  });

  return {
    engine: "runpod-comfyui",
    workflow,
    positivePrompt,
    negativePrompt,
    width,
    height,
    seed,
  };
}
