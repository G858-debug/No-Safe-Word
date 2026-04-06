/**
 * Character approval image generation using Juggernaut Ragnarok via RunPod/ComfyUI.
 *
 * Uses natural language prompts with explicit ethnicity + skin tone for strong
 * CLIP signal. See docs/skills/juggernaut-ragnarok/SKILL.md for prompt rules.
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

// ── Prompt Builders ──

/**
 * Build a natural language face portrait prompt for Juggernaut Ragnarok.
 *
 * Uses explicit ethnicity + skin tone phrasing early in the prompt for strong
 * CLIP signal. Booru tags like "dark-skinned male" are weak in Ragnarok —
 * natural language like "a Black African man with dark brown skin" works better.
 */
function buildFacePrompt(charData: CharacterData): string {
  const parts: string[] = [];

  // Lead with ethnicity + gender in natural language — strongest signal for identity
  const genderWord = charData.gender === "male" ? "man" : "woman";
  const ethnicityPhrase = charData.ethnicity
    ? `a ${charData.ethnicity} ${genderWord}`
    : `a ${genderWord}`;
  parts.push(ethnicityPhrase);

  // Skin tone — explicit and early
  if (charData.skinTone) parts.push(`${charData.skinTone} skin`);

  // Hair
  if (charData.hairColor && charData.hairStyle) {
    parts.push(`${charData.hairColor.toLowerCase()} ${charData.hairStyle.toLowerCase()}`);
  } else if (charData.hairStyle) {
    parts.push(charData.hairStyle.toLowerCase());
  }

  // Eyes
  if (charData.eyeColor) parts.push(`${charData.eyeColor.toLowerCase()} eyes`);

  // Age
  if (charData.age) parts.push(`${charData.age} years old`);

  // Distinguishing features
  if (charData.distinguishingFeatures) {
    parts.push(charData.distinguishingFeatures.toLowerCase());
  }

  // Portrait composition
  parts.push("looking at viewer");
  parts.push("close-up portrait, head and shoulders, face in focus");
  parts.push("soft studio lighting, clean neutral background, shallow depth of field");

  return parts.join(", ");
}

/**
 * Build a natural language full-body prompt for Juggernaut Ragnarok.
 */
function buildBodyPrompt(charData: CharacterData): string {
  const parts: string[] = [];

  // Lead with ethnicity + gender
  const genderWord = charData.gender === "male" ? "man" : "woman";
  const ethnicityPhrase = charData.ethnicity
    ? `a ${charData.ethnicity} ${genderWord}`
    : `a ${genderWord}`;
  parts.push(ethnicityPhrase);

  // Skin tone
  if (charData.skinTone) parts.push(`${charData.skinTone} skin`);

  // Hair
  if (charData.hairColor && charData.hairStyle) {
    parts.push(`${charData.hairColor.toLowerCase()} ${charData.hairStyle.toLowerCase()}`);
  } else if (charData.hairStyle) {
    parts.push(charData.hairStyle.toLowerCase());
  }

  // Body type — hourglass trigger word activates the LoRA
  if (charData.gender === "female") {
    parts.push("hourglass body shape, curvaceous figure, wide hips, large breasts, thick thighs, narrow waist");
    if (charData.bodyType) parts.push(charData.bodyType.toLowerCase());
  } else {
    if (charData.bodyType) parts.push(charData.bodyType.toLowerCase());
  }

  // Age
  if (charData.age) parts.push(`${charData.age} years old`);

  // Distinguishing features
  if (charData.distinguishingFeatures) {
    parts.push(charData.distinguishingFeatures.toLowerCase());
  }

  // Clothing — explicit for SFW (Ragnarok defaults to nudity without it)
  if (charData.gender === "female") {
    parts.push("wearing fitted mini skirt and strappy crop top and high heels, fully clothed");
  } else {
    parts.push("wearing fitted henley shirt and jeans, fully clothed");
  }

  // Full body composition
  parts.push("standing, confident pose, looking at viewer");
  parts.push("full body portrait head to toe, warm studio lighting, clean background");

  return parts.join(", ");
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
  console.log(`[CharImage] Built scene tags for ${character.name} (${stage}): ${sceneTags.substring(0, 80)}...`);
  const positivePrompt = `${qualityPrefix}, ${sceneTags}`;
  const negativePrompt = buildNegativePrompt(mode);

  // Dimensions — portrait orientation for both
  const width = 832;
  const height = 1216;

  // Hourglass body shape LoRA — disabled for testing.
  // Re-enable by uncommenting and setting desired strength.
  // const loras = charData.gender === "female" ? [{
  //   filename: "hourglassv2_SDXL.safetensors",
  //   strengthModel: 0.8,
  //   strengthClip: 0.8,
  // }] : undefined;
  const loras = undefined;

  const workflow = buildWorkflow({
    positivePrompt,
    negativePrompt,
    width,
    height,
    seed,
    filenamePrefix: `char_${character.id}_${stage}`,
    loras,
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
