import {
  buildSdxlWorkflow,
  buildKontextWorkflow,
  resolvePromptEthnicity,
  FEMALE_BODY_SDXL_CHECKPOINT,
  FEMALE_BODY_SDXL_CONFIG,
  buildFemaleBodyLoraStack,
  buildFemaleBodySdxlPrompt,
  buildFemaleBodyStep2Config,
} from "@no-safe-word/image-gen";
import type { FemaleBodyStep2Config } from "@no-safe-word/image-gen";
import type { CharacterData } from "@no-safe-word/shared";

type ImageType = "portrait" | "fullBody";
type GenerationStage = "face" | "body";

/** Case-insensitive check for Black/African ethnicity */
function isBlackAfrican(ethnicity: string): boolean {
  const lower = ethnicity.toLowerCase();
  return lower.includes('black') || lower.includes('african') || lower.includes('dark');
}

// ---------------------------------------------------------------------------
// Prompt Builders
// ---------------------------------------------------------------------------

/**
 * Build the Flux Krea face portrait prompt for FEMALE characters.
 * Uses natural prose style (no tags, no weights, no negative prompt).
 * Only face-relevant fields — NO bodyType.
 */
function buildFluxFacePrompt(
  charData: CharacterData,
  resolvedEthnicity: string,
): string {
  const details: string[] = [];

  if (charData.hairStyle || charData.hairColor) {
    const hair = [charData.hairStyle, charData.hairColor].filter(Boolean).join(' ');
    details.push(`${hair} hair`);
  }
  if (charData.eyeColor) details.push(`${charData.eyeColor} eyes`);
  if (charData.skinTone) details.push(`${charData.skinTone} skin`);

  const age = charData.age ? `${charData.age}-year-old ` : '';
  const core = details.length > 0
    ? `A ${age}${resolvedEthnicity} woman with ${details.join(', ')}`
    : `A ${age}${resolvedEthnicity} woman`;

  const sentences = [core + '.'];
  if (charData.distinguishingFeatures) {
    sentences.push(`She has ${charData.distinguishingFeatures}.`);
  }
  sentences.push(
    'Beautiful, striking facial features, flawless skin. Close-up portrait, face and shoulders only, professional fashion photography, editorial lighting, sharp focus, photorealistic.'
  );

  return sentences.join(' ');
}

/**
 * Build the SDXL positive prompt for face portrait generation (used for SDXL-only face path).
 * Only includes face-relevant fields: age, ethnicity, skin tone, hair, eyes,
 * distinguishing features. Body type and beauty descriptors are explicitly
 * excluded to prevent SDXL from rendering body content in head-and-shoulders shots.
 */
function buildSdxlFacePrompt(
  charData: CharacterData,
  resolvedEthnicity: string,
  isFemale: boolean,
): string {
  const genderWord = isFemale ? 'woman' : 'man';
  const details: string[] = [];

  if (charData.hairStyle || charData.hairColor) {
    const hair = [charData.hairStyle, charData.hairColor].filter(Boolean).join(' ');
    details.push(`${hair} hair`);
  }
  if (charData.eyeColor) details.push(`${charData.eyeColor} eyes`);
  if (charData.skinTone) details.push(`${charData.skinTone} skin`);

  const age = charData.age ? `${charData.age}-year-old ` : '';
  const core = details.length > 0
    ? `A ${age}${resolvedEthnicity} ${genderWord} with ${details.join(', ')}`
    : `A ${age}${resolvedEthnicity} ${genderWord}`;

  const sentences = [core + '.'];
  if (charData.distinguishingFeatures) {
    const pronoun = isFemale ? 'She' : 'He';
    sentences.push(`${pronoun} has ${charData.distinguishingFeatures}.`);
  }
  sentences.push(
    'Beauty-editorial studio portrait. Head and shoulders only. Looking directly at the camera. ' +
    'Warm natural daylight with soft fill light. Clean warm-toned background with subtle depth. ' +
    '8k, masterpiece, best quality, highly detailed.'
  );

  return sentences.join(' ');
}

/**
 * Build Nano Banana 2 face prompt for MALE characters.
 */
function buildMaleNanoBananaFacePrompt(
  charData: CharacterData,
  resolvedEthnicity: string,
): string {
  const details: string[] = [];

  if (charData.skinTone) details.push(`${charData.skinTone} skin`);
  if (charData.hairStyle || charData.hairColor) {
    const hair = [charData.hairStyle, charData.hairColor].filter(Boolean).join(' ');
    details.push(`${hair} hair`);
  }
  if (charData.eyeColor) details.push(`${charData.eyeColor} eyes`);

  const age = charData.age ? `${charData.age}-year-old ` : '';
  const core = details.length > 0
    ? `A ${age}${resolvedEthnicity} man with ${details.join(', ')}`
    : `A ${age}${resolvedEthnicity} man`;

  const sentences = [core + '.'];
  if (charData.distinguishingFeatures) {
    sentences.push(`He has ${charData.distinguishingFeatures}.`);
  }
  sentences.push(
    'Handsome, striking facial features, strong jawline. Close-up portrait, face and shoulders, professional fashion photography, editorial lighting, sharp focus, photorealistic.'
  );

  return sentences.join(' ');
}

/**
 * Build Nano Banana 2 body prompt for MALE characters.
 */
function buildMaleNanoBananaBodyPrompt(
  charData: CharacterData,
  resolvedEthnicity: string,
): string {
  const details: string[] = [];

  if (charData.skinTone) details.push(`${charData.skinTone} skin`);
  if (charData.bodyType) details.push(`${charData.bodyType} build`);
  if (charData.hairStyle || charData.hairColor) {
    const hair = [charData.hairStyle, charData.hairColor].filter(Boolean).join(' ');
    details.push(`${hair} hair`);
  }

  const age = charData.age ? `${charData.age}-year-old ` : '';
  const core = details.length > 0
    ? `A ${age}${resolvedEthnicity} man with ${details.join(', ')}`
    : `A ${age}${resolvedEthnicity} man`;

  const sentences = [core + '.'];
  sentences.push(
    'Handsome, striking facial features. Full body portrait, standing, wearing a fitted crew neck t-shirt and tight shorts, body shape visible through clothing. Professional fashion photography, editorial lighting, sharp focus, photorealistic.'
  );

  return sentences.join(' ');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CharacterGenerationInput {
  character: {
    id: string;
    name: string;
    description: Record<string, string>;
  };
  imageType: ImageType;
  stage?: GenerationStage;
  seed?: number;
  customPrompt?: string;
  /** Approved face URL — needed for body stage (ReActor source for female, Nano Banana ref for male) */
  approvedFaceUrl?: string;
}

/** RunPod-based generation (SDXL or Flux Krea via ComfyUI) */
export interface RunPodGenerationPayload {
  engine: 'runpod';
  workflow: Record<string, any>;
  positivePrompt: string;
  negativePrompt: string;
  seed: number;
  width: number;
  height: number;
  loras: Array<{ filename: string; strength: number }>;
  /** Additional images to pass in RunPod's images[] array (e.g. source face for ReActor) */
  images?: Array<{ name: string; image: string }>;
}

/** Two-step RunPod generation (SDXL → Flux img2img) for female body portraits */
export interface TwoStepRunPodPayload {
  engine: 'runpod-two-step';
  workflow: Record<string, any>;
  positivePrompt: string;
  negativePrompt: string;
  seed: number;
  width: number;
  height: number;
  loras: Array<{ filename: string; strength: number }>;
  /** Serializable config for the Flux img2img step (stored in images.settings) */
  step2Config: FemaleBodyStep2Config;
  /** Additional images to pass in RunPod's images[] array */
  images?: Array<{ name: string; image: string }>;
}

/** Replicate-based generation (Nano Banana 2) */
export interface ReplicateGenerationPayload {
  engine: 'replicate';
  model: string;
  positivePrompt: string;
  seed: number;
  /** Reference image URL for Nano Banana 2 (approved face for body gen) */
  referenceImageUrl?: string;
}

export type CharacterGenerationPayload = RunPodGenerationPayload | TwoStepRunPodPayload | ReplicateGenerationPayload;

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

/**
 * Build the character generation payload — prompt, LoRAs, workflow/API params.
 *
 * Dispatches by gender + stage:
 * | Gender | Stage | Engine    | Model                                      |
 * |--------|-------|-----------|--------------------------------------------|
 * | Female | face  | Replicate | Nano Banana 2                            |
 * | Female | body  | RunPod    | SDXL RealVisXL + Curvy Body LoRA + ReActor |
 * | Male   | face  | Replicate | Nano Banana 2                            |
 * | Male   | body  | Replicate | Nano Banana 2 (with face reference)      |
 */
export async function buildCharacterGenerationPayload(
  params: CharacterGenerationInput,
): Promise<CharacterGenerationPayload> {
  const { character, customPrompt } = params;
  const stage = params.stage ?? 'face';
  const desc = character.description;

  // 1. Build CharacterData from description JSON
  const characterData: CharacterData = {
    name: character.name,
    gender: (['male', 'female', 'non-binary', 'other'].includes(desc.gender)
      ? desc.gender as CharacterData["gender"]
      : 'female') as CharacterData["gender"],
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

  // 2. Gender + ethnicity resolution
  const isMale = characterData.gender === 'male';
  const useMelanin = isBlackAfrican(characterData.ethnicity);
  // Ethnicity normalisation (African American substitution) is female-only —
  // male portraits use the stored ethnicity label directly.
  const resolvedEthnicity = isMale
    ? characterData.ethnicity
    : await resolvePromptEthnicity(
        characterData.ethnicity,
        characterData.gender,
        characterData.skinTone,
      );

  // 3. Seed
  const seed = params.seed ?? Math.floor(Math.random() * 2_147_483_647) + 1;
  const sluggedName = character.name.replace(/\s+/g, "_").toLowerCase();

  // 4. Dispatch by gender + stage
  if (isMale) {
    return buildMalePayload(characterData, resolvedEthnicity, stage, seed, customPrompt, params.approvedFaceUrl);
  } else {
    return buildFemalePayload(characterData, resolvedEthnicity, useMelanin, stage, seed, sluggedName, customPrompt, params.approvedFaceUrl);
  }
}

// ---------------------------------------------------------------------------
// Male Pipeline — Nano Banana 2 (Replicate)
// ---------------------------------------------------------------------------

function buildMalePayload(
  charData: CharacterData,
  resolvedEthnicity: string,
  stage: GenerationStage,
  seed: number,
  customPrompt?: string,
  approvedFaceUrl?: string,
): ReplicateGenerationPayload {
  let prompt: string;

  if (stage === 'face') {
    prompt = customPrompt || buildMaleNanoBananaFacePrompt(charData, resolvedEthnicity);
  } else {
    prompt = customPrompt || buildMaleNanoBananaBodyPrompt(charData, resolvedEthnicity);
  }

  return {
    engine: 'replicate',
    model: 'google/nano-banana-2',
    positivePrompt: prompt,
    seed,
    referenceImageUrl: stage === 'body' ? approvedFaceUrl : undefined,
  };
}

// ---------------------------------------------------------------------------
// Female Pipeline — Nano Banana 2 (face) + SDXL+ReActor (body)
// ---------------------------------------------------------------------------

async function buildFemalePayload(
  charData: CharacterData,
  resolvedEthnicity: string,
  useMelanin: boolean,
  stage: GenerationStage,
  seed: number,
  sluggedName: string,
  customPrompt?: string,
  approvedFaceUrl?: string,
): Promise<CharacterGenerationPayload> {
  if (stage === 'face') {
    return buildFemaleFacePayload(charData, resolvedEthnicity, seed, customPrompt);
  } else {
    return buildFemaleBodyPayload(charData, resolvedEthnicity, useMelanin, seed, sluggedName, customPrompt);
  }
}

/**
 * Female face — Nano Banana 2 (Replicate), same engine as male face.
 * Uses the existing prose face prompt.
 */
function buildFemaleFacePayload(
  charData: CharacterData,
  resolvedEthnicity: string,
  seed: number,
  customPrompt?: string,
): ReplicateGenerationPayload {
  const prompt = customPrompt || buildFluxFacePrompt(charData, resolvedEthnicity);

  return {
    engine: 'replicate',
    model: 'google/nano-banana-2',
    positivePrompt: prompt,
    seed,
  };
}

/**
 * Female body — BigASP (SDXL) → Flux Kontext img2img via ComfyUI on RunPod.
 *
 * Two-step pipeline matching the dataset generation stack exactly:
 *   Step 1: SDXL body shot via BigASP + Curvy Body LoRA
 *   Step 2: Flux Kontext img2img conversion for photorealistic output
 *
 * Config imported from female-body-pipeline.ts (shared with dataset generator).
 */
function buildFemaleBodyPayload(
  charData: CharacterData,
  resolvedEthnicity: string,
  useMelanin: boolean,
  seed: number,
  sluggedName: string,
  customPrompt?: string,
): TwoStepRunPodPayload {

  const { width, height, steps, cfg, samplerName, denoiseTxt2Img } = FEMALE_BODY_SDXL_CONFIG;
  const loras = buildFemaleBodyLoraStack(useMelanin);

  const { positive: positivePrompt, negative: negativePrompt } = buildFemaleBodySdxlPrompt({
    age: charData.age,
    ethnicity: resolvedEthnicity,
    skinTone: charData.skinTone,
    bodyType: charData.bodyType,
    hairStyle: charData.hairStyle,
    hairColor: charData.hairColor,
    useMelanin,
    customPrompt,
  });

  const workflow = buildSdxlWorkflow({
    positivePrompt,
    negativePrompt,
    width,
    height,
    seed,
    cfg,
    steps,
    samplerName,
    denoise: denoiseTxt2Img,
    checkpointName: FEMALE_BODY_SDXL_CHECKPOINT,
    loras,
    filenamePrefix: `fullbody_${sluggedName}`,
  });

  const step2Config = buildFemaleBodyStep2Config({
    ethnicity: resolvedEthnicity,
    skinTone: charData.skinTone,
    bodyType: charData.bodyType,
    hairStyle: charData.hairStyle,
    hairColor: charData.hairColor,
    seed,
    filenamePrefix: `fullbody_flux_${sluggedName}`,
  });

  return {
    engine: 'runpod-two-step',
    workflow,
    positivePrompt,
    negativePrompt,
    seed,
    width,
    height,
    loras: loras.map(l => ({ filename: l.filename, strength: l.strengthModel })),
    step2Config,
  };
}
