import {
  buildSdxlWorkflow,
  resolvePromptEthnicity,
} from "@no-safe-word/image-gen";
import type { CharacterData } from "@no-safe-word/shared";

type ImageType = "portrait" | "fullBody";

/** Case-insensitive check for Black/African ethnicity */
function isBlackAfrican(ethnicity: string): boolean {
  const lower = ethnicity.toLowerCase();
  return lower.includes('black') || lower.includes('african') || lower.includes('dark');
}

/**
 * Build the SDXL positive prompt for face portrait generation.
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
    'Studio portrait. Head and shoulders only. Looking directly at the camera. ' +
    'Clean grey studio background. Professional portrait lighting. 8k, masterpiece, best quality, highly detailed.'
  );

  return sentences.join(' ');
}

export interface CharacterGenerationInput {
  character: {
    id: string;
    name: string;
    description: Record<string, string>;
  };
  imageType: ImageType;
  seed?: number;
  customPrompt?: string;
}

export interface CharacterGenerationPayload {
  workflow: Record<string, any>;
  positivePrompt: string;
  negativePrompt: string;
  seed: number;
  width: number;
  height: number;
  loras: Array<{ filename: string; strength: number }>;
}

/**
 * Build the complete SDXL character generation payload — prompt, LoRAs,
 * negative prompt, dimensions, and ComfyUI workflow.
 *
 * This is the single source of truth for all character image generation logic.
 * Both /generate and /regenerate routes call this function.
 */
export async function buildCharacterGenerationPayload(
  params: CharacterGenerationInput,
): Promise<CharacterGenerationPayload> {
  const { character, imageType, customPrompt } = params;
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

  // 2. Gender resolution
  const isFemale = characterData.gender !== 'male';
  const useMelanin = isBlackAfrican(characterData.ethnicity);

  // 3. Ethnicity normalization via AI classification
  const resolvedEthnicity = await resolvePromptEthnicity(
    characterData.ethnicity,
    characterData.gender,
    characterData.skinTone,
  );

  // 4. Seed
  const seed = params.seed ?? Math.floor(Math.random() * 2_147_483_647) + 1;

  // 5. Build prompt, LoRAs, negative prompt, and dimensions per image type
  let positivePrompt: string;
  let negativePrompt: string;
  let width: number;
  let height: number;
  const loras: Array<{ filename: string; strengthModel: number; strengthClip: number }> = [];

  if (imageType === "portrait") {
    // PATH A — Face portrait: RealVisXL + Melanin/Skin LoRAs (Black/African)
    width = 832;
    height = 1216;

    const melaninTrigger = useMelanin ? 'melanin, ' : '';
    const skinToneTrigger = useMelanin ? 'dark chocolate skin tone style, ' : '';
    const skinRealismTrigger = useMelanin ? 'Detailed natural skin and blemishes without-makeup and acne, ' : '';
    const faceDesc = buildSdxlFacePrompt(characterData, resolvedEthnicity, isFemale);
    positivePrompt = `${melaninTrigger}${skinToneTrigger}${skinRealismTrigger}${faceDesc}`;

    negativePrompt = `nude, naked, topless, bare breasts, exposed chest, nsfw, cleavage, deformed, bad anatomy, extra limbs, (worst quality:2), (low quality:2), blurry, watermark, asian features, european features, pale skin, white skin, light skin, caucasian`;

    if (useMelanin) {
      loras.push({ filename: 'melanin-XL.safetensors', strengthModel: 0.5, strengthClip: 0.5 });
      loras.push({ filename: 'sdxl-skin-tone-xl.safetensors', strengthModel: 0.6, strengthClip: 0.6 });
      loras.push({ filename: 'sdxl-skin-realism.safetensors', strengthModel: 0.4, strengthClip: 0.4 });
    }
  } else {
    // PATH B — Full body: RealVisXL + Venus Body LoRA + Melanin LoRA
    width = 768;
    height = 1152;

    if (isFemale) {
      const venusPrefix = 'venusbody, ';
      const melaninPrefix = useMelanin ? 'melanin, ' : '';
      const skinTonePrefix = useMelanin ? 'dark chocolate skin tone style, ' : '';
      const skinRealismPrefix = useMelanin ? 'Detailed natural skin and blemishes without-makeup and acne, ' : '';
      positivePrompt = `${venusPrefix}${melaninPrefix}${skinTonePrefix}${skinRealismPrefix}photorealistic full body photo of a ${characterData.age}-year-old ${resolvedEthnicity} woman, ${characterData.skinTone} skin, curvaceous figure with large breasts wide hips and thick thighs small waist, ${characterData.hairStyle} ${characterData.hairColor} hair. She is wearing a stylish fitted outfit — a form-fitting bodycon dress or high-waisted jeans with a fitted top that clearly shows her body shape and proportions. Fully clothed. Full body shot from head to toe. Standing pose, confident stance. Clean studio background with soft professional lighting. 8k, masterpiece, best quality`;

      loras.push({ filename: 'venus-body-xl.safetensors', strengthModel: 0.75, strengthClip: 0.75 });
      if (useMelanin) {
        loras.push({ filename: 'melanin-XL.safetensors', strengthModel: 0.5, strengthClip: 0.5 });
        loras.push({ filename: 'sdxl-skin-tone-xl.safetensors', strengthModel: 0.6, strengthClip: 0.6 });
        loras.push({ filename: 'sdxl-skin-realism.safetensors', strengthModel: 0.4, strengthClip: 0.4 });
      }
    } else {
      positivePrompt = `photorealistic full body photo of a ${characterData.age}-year-old ${resolvedEthnicity} man, ${characterData.skinTone} skin, ${characterData.bodyType || 'athletic build'}, ${characterData.hairStyle} ${characterData.hairColor} hair, wearing casual clothing, full body visible head to toe, standing, studio lighting, neutral gray background, 8k, masterpiece, best quality`;
    }

    negativePrompt = `nude, naked, topless, bare breasts, exposed chest, nsfw, lingerie, bikini, underwear only, skinny, thin, flat chest, small breasts, narrow hips, deformed, bad anatomy, extra limbs, (worst quality:2), (low quality:2), white skin, pale skin, asian features, european features`;
  }

  // 6. Custom prompt override — still ensure LoRA trigger words are present
  if (customPrompt) {
    positivePrompt = customPrompt;
    if (useMelanin && !/\bmelanin\b/i.test(positivePrompt)) {
      positivePrompt = `melanin, ${positivePrompt}`;
    }
    if (useMelanin && !/dark chocolate skin tone style/i.test(positivePrompt)) {
      positivePrompt = `dark chocolate skin tone style, ${positivePrompt}`;
    }
    if (useMelanin && !/Detailed natural skin/i.test(positivePrompt)) {
      positivePrompt = `Detailed natural skin and blemishes without-makeup and acne, ${positivePrompt}`;
    }
    if (imageType === 'fullBody' && isFemale && !/\bvenusbody\b/i.test(positivePrompt)) {
      positivePrompt = `venusbody, ${positivePrompt}`;
    }
  }

  // 7. Build SDXL ComfyUI workflow
  const sluggedName = character.name.replace(/\s+/g, "_").toLowerCase();
  const workflow = buildSdxlWorkflow({
    positivePrompt,
    negativePrompt,
    width,
    height,
    seed,
    checkpointName: 'realvisxlV50_v50Bakedvae.safetensors',
    loras,
    filenamePrefix: `${imageType === "fullBody" ? "fullbody" : "portrait"}_${sluggedName}`,
  });

  return {
    workflow,
    positivePrompt,
    negativePrompt,
    seed,
    width,
    height,
    loras: loras.map(l => ({ filename: l.filename, strength: l.strengthModel })),
  };
}
