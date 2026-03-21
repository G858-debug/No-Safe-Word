import {
  buildSdxlWorkflow,
  buildKontextWorkflow,
  resolvePromptEthnicity,
} from "@no-safe-word/image-gen";
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

/** Replicate-based generation (Nano Banana 2) */
export interface ReplicateGenerationPayload {
  engine: 'replicate';
  model: string;
  positivePrompt: string;
  seed: number;
  /** Reference image URL for Nano Banana 2 (approved face for body gen) */
  referenceImageUrl?: string;
}

export type CharacterGenerationPayload = RunPodGenerationPayload | ReplicateGenerationPayload;

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
 * Female body — SDXL RealVisXL + Curvy Body LoRA for body composition, then
 * Flux + PuLID face injection using the approved face portrait.
 * The two stages run as one ComfyUI workflow (one RunPod job).
 * Pure SDXL pipeline — no Flux conversion, no PuLID face injection.
 */
function buildFemaleBodyPayload(
  charData: CharacterData,
  resolvedEthnicity: string,
  useMelanin: boolean,
  seed: number,
  sluggedName: string,
  customPrompt?: string,
): RunPodGenerationPayload {

  const width = 768;
  const height = 1152;

  const loras: Array<{ filename: string; strengthModel: number; strengthClip: number }> = [];
  loras.push({ filename: 'feminine-body-proportions-sdxl.safetensors', strengthModel: 0.80, strengthClip: 0.80 });
  loras.push({ filename: 'curvy-body-sdxl.safetensors', strengthModel: 0.70, strengthClip: 0.70 });
  // perfect-breasts-v2.safetensors — re-enable once downloaded to network volume
  // loras.push({ filename: 'perfect-breasts-v2.safetensors', strengthModel: 0.45, strengthClip: 0.45 });
  if (useMelanin) {
    loras.push({ filename: 'melanin-XL.safetensors', strengthModel: 0.5, strengthClip: 0.5 });
    loras.push({ filename: 'sdxl-skin-tone-xl.safetensors', strengthModel: 0.6, strengthClip: 0.6 });
    loras.push({ filename: 'sdxl-skin-realism.safetensors', strengthModel: 0.4, strengthClip: 0.4 });
  }

  let positivePrompt: string;
  if (customPrompt) {
    positivePrompt = customPrompt;
    // Ensure LoRA trigger words are present
    if (useMelanin && !/\bmelanin\b/i.test(positivePrompt)) {
      positivePrompt = `melanin, ${positivePrompt}`;
    }
    if (useMelanin && !/dark chocolate skin tone style/i.test(positivePrompt)) {
      positivePrompt = `dark chocolate skin tone style, ${positivePrompt}`;
    }
    if (useMelanin && !/Detailed natural skin/i.test(positivePrompt)) {
      positivePrompt = `Detailed natural skin and blemishes without-makeup and acne, ${positivePrompt}`;
    }
  } else {
    const melaninPrefix = useMelanin ? 'melanin, ' : '';
    const skinTonePrefix = useMelanin ? 'dark chocolate skin tone style, ' : '';
    const skinRealismPrefix = useMelanin ? 'Detailed natural skin and blemishes without-makeup and acne, ' : '';
    const bodyDesc = charData.bodyType || 'curvaceous figure with large breasts wide hips and thick thighs small waist';
    positivePrompt = `score_7_up, score_6_up, ${melaninPrefix}${skinTonePrefix}${skinRealismPrefix}photorealistic full body photo of a ${charData.age}-year-old ${resolvedEthnicity} woman, ${charData.skinTone} skin, ${bodyDesc}, ${charData.hairStyle} ${charData.hairColor} hair. She is wearing a tiny fitted mini skirt stopping mid-thigh and a strappy low-cut crop top with thin spaghetti straps, deep neckline showing generous cleavage, midriff partially exposed. High heels. Outfit is tight and body-hugging, emphasising every curve. Full body shot from head to toe. Standing pose, confident stance. Softly blurred warm neutral background, slight bokeh, photography studio with warm ambient light. Soft natural window light from camera left, warm fill light from the right, subtle directional shadows creating depth on skin, rich warm skin tones with natural variation, photorealistic skin texture with visible pore detail, subsurface scattering on skin. Natural melanin-rich skin, deep warm undertones, skin has natural sheen not plastic shine, soft catchlights in eyes, DSLR photography, 85mm portrait lens, f/2.8 aperture`;
  }

  const negativePrompt = `score_1, score_2, score_3, multiple views, bad anatomy, watermark, text, logo, signature, overexposed, flat lighting, plastic skin, oversaturated, muddy skin tone, grey skin, ashy skin`;

  const workflow = buildSdxlWorkflow({
    positivePrompt,
    negativePrompt,
    width,
    height,
    seed,
    cfg: 4.0,
    steps: 40,
    samplerName: 'dpmpp_2m_sde',
    checkpointName: process.env.SDXL_BODY_CHECKPOINT || 'realvisxlV50_v50Bakedvae.safetensors',
    loras,
    filenamePrefix: `fullbody_${sluggedName}`,
  });

  return {
    engine: 'runpod',
    workflow,
    positivePrompt,
    negativePrompt,
    seed,
    width,
    height,
    loras: loras.map(l => ({ filename: l.filename, strength: l.strengthModel })),
  };
}
