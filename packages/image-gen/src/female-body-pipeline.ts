/**
 * Shared female body generation pipeline.
 *
 * Single source of truth for checkpoints, LoRAs, prompt construction, and
 * denoise values used by BOTH portrait generation (approval UI) and dataset
 * generation (LoRA training). Any change here automatically propagates to
 * both pipelines — never duplicate these values elsewhere.
 *
 * Pipeline: BigASP (SDXL) → Flux Kontext img2img conversion
 */

// ── Checkpoints ──────────────────────────────────────────────────────────────

export const FEMALE_BODY_SDXL_CHECKPOINT = 'bigasp_v20.safetensors';
export const FEMALE_BODY_KONTEXT_MODEL = 'flux1KreaDev_fp8E4m3fn.safetensors';

// ── SDXL Generation Config ───────────────────────────────────────────────────

export const FEMALE_BODY_SDXL_CONFIG = {
  width: 768,
  height: 1152,
  steps: 40,
  cfg: 4.0,
  samplerName: 'dpmpp_2m_sde' as const,
  /** Portrait generation uses txt2img (1.0), dataset uses img2img from approved body (0.80) */
  denoiseTxt2Img: 1.0,
  denoiseImg2Img: 0.80,
};

// ── Flux img2img Config ──────────────────────────────────────────────────────

export const FEMALE_BODY_KONTEXT_CONFIG = {
  width: 1024,
  height: 1024,
  denoise: 0.85,
};

export const FEMALE_BODY_KONTEXT_LORAS = [
  { filename: 'flux_realism_lora.safetensors', strengthModel: 0.8, strengthClip: 0.8 },
  { filename: 'flux-add-details.safetensors', strengthModel: 0.6, strengthClip: 0.6 },
] as const;

// ── LoRA Stack ───────────────────────────────────────────────────────────────

interface LoraEntry {
  filename: string;
  strengthModel: number;
  strengthClip: number;
}

/** Case-insensitive check for Black/African ethnicity */
export function isBlackAfrican(ethnicity: string): boolean {
  const lower = ethnicity.toLowerCase();
  return lower.includes('black') || lower.includes('african') || lower.includes('dark');
}

/**
 * Build the SDXL LoRA stack for female body generation.
 * Used by both portrait approval and dataset generation.
 */
export function buildFemaleBodyLoraStack(useMelanin: boolean): LoraEntry[] {
  const loras: LoraEntry[] = [
    { filename: 'curvy-body-sdxl.safetensors', strengthModel: 0.70, strengthClip: 0.70 },
  ];
  if (useMelanin) {
    loras.push({ filename: 'melanin-XL.safetensors', strengthModel: 0.5, strengthClip: 0.5 });
    loras.push({ filename: 'sdxl-skin-tone-xl.safetensors', strengthModel: 0.6, strengthClip: 0.6 });
    loras.push({ filename: 'sdxl-skin-realism.safetensors', strengthModel: 0.4, strengthClip: 0.4 });
  }
  return loras;
}

// ── Prompt Construction ──────────────────────────────────────────────────────

export interface FemaleBodyPromptParams {
  age: string;
  ethnicity: string;
  skinTone: string;
  bodyType: string;
  hairStyle: string;
  hairColor: string;
  useMelanin: boolean;
  /** Clothing + pose override (for dataset variants). If omitted, uses default portrait clothing. */
  clothingAndPose?: string;
  /** Custom prompt override (user-supplied). Takes priority over all construction. */
  customPrompt?: string;
}

/**
 * Build SDXL positive + negative prompts for female body generation.
 * Same prompt logic for portrait and dataset.
 */
export function buildFemaleBodySdxlPrompt(params: FemaleBodyPromptParams): {
  positive: string;
  negative: string;
} {
  const { age, ethnicity, skinTone, bodyType, hairStyle, hairColor, useMelanin, clothingAndPose, customPrompt } = params;

  const melaninPrefix = useMelanin ? 'melanin, ' : '';
  const skinTonePrefix = useMelanin ? 'dark chocolate skin tone style, ' : '';
  const skinRealismPrefix = useMelanin ? 'Detailed natural skin and blemishes without-makeup and acne, ' : '';
  const bodyDesc = bodyType || 'curvaceous figure';
  const hairDesc = hairStyle && hairColor ? `${hairStyle} ${hairColor} hair` : '';

  let positive: string;

  if (customPrompt) {
    positive = customPrompt;
    // Ensure LoRA trigger words are present
    if (useMelanin && !/\bmelanin\b/i.test(positive)) {
      positive = `melanin, ${positive}`;
    }
    if (useMelanin && !/dark chocolate skin tone style/i.test(positive)) {
      positive = `dark chocolate skin tone style, ${positive}`;
    }
    if (useMelanin && !/Detailed natural skin/i.test(positive)) {
      positive = `Detailed natural skin and blemishes without-makeup and acne, ${positive}`;
    }
  } else {
    const clothing = clothingAndPose ||
      `She is wearing a tiny fitted mini skirt stopping mid-thigh and a strappy low-cut crop top with thin spaghetti straps, deep neckline showing generous cleavage, midriff partially exposed. High heels. Outfit is tight and body-hugging, emphasising every curve. Full body shot from head to toe. Standing pose, confident stance. Softly blurred warm neutral background, slight bokeh, photography studio with warm ambient light. Soft natural window light from camera left, warm fill light from the right, subtle directional shadows creating depth on skin, rich warm skin tones with natural variation, photorealistic skin texture with visible pore detail, subsurface scattering on skin. Natural melanin-rich skin, deep warm undertones, skin has natural sheen not plastic shine, soft catchlights in eyes, DSLR photography, 85mm portrait lens, f/2.8 aperture`;

    positive =
      `score_7_up, score_6_up, ${melaninPrefix}${skinTonePrefix}${skinRealismPrefix}` +
      `photorealistic full body photo of a ${age}-year-old ${ethnicity} woman, ${skinTone} skin, ` +
      `${bodyDesc}, ${hairDesc ? `${hairDesc}. ` : ''}${clothing}`;
  }

  const negative =
    'nude, naked, topless, bare breasts, exposed chest, nsfw, cleavage, underwear, lingerie, ' +
    'skinny, thin, flat chest, small breasts, narrow hips, deformed, ' +
    'bad anatomy, extra limbs, (worst quality:2), (low quality:2), ' +
    'white skin, pale skin, asian features, european features, ' +
    'cropped head, cut off head, forehead cropped, head out of frame, headless, partial face, face not visible, ' +
    'score_1, score_2, score_3, multiple views, watermark, text, logo, signature, ' +
    'overexposed, flat lighting, plastic skin, oversaturated, muddy skin tone, grey skin, ashy skin';

  return { positive, negative };
}

/**
 * Build the Flux Kontext img2img prompt for Step 2.
 * Used after SDXL generation to convert to photorealistic Flux output.
 */
export function buildFemaleBodyImg2ImgPrompt(params: {
  ethnicity: string;
  skinTone: string;
  bodyType: string;
  hairStyle: string;
  hairColor: string;
  clothingAndPose?: string;
}): string {
  const { ethnicity, skinTone, bodyType, hairStyle, hairColor, clothingAndPose } = params;
  const bodyDesc = bodyType || 'curvaceous figure';
  const hairDesc = hairStyle && hairColor ? `${hairStyle} ${hairColor} hair` : '';
  const hairEnforced = hairDesc ? `must have exactly this hairstyle: ${hairDesc}. ` : '';

  const clothing = clothingAndPose ||
    'wearing a tiny fitted mini skirt stopping mid-thigh and a strappy low-cut crop top, ' +
    'high heels, standing pose, confident stance, warm studio background, soft directional lighting';

  return (
    `Do not copy the clothing, background, or pose from the reference image. ` +
    `Match the reference body shape and proportions exactly. ` +
    `${hairEnforced}` +
    `Generate this exact scene: ` +
    `Photorealistic photograph, ${ethnicity} woman, ${skinTone} skin, ` +
    `${hairDesc ? `${hairDesc}, ` : ''}` +
    `${bodyDesc}, matching the reference proportions, ` +
    `${clothing}, ` +
    `full body, natural skin texture, high detail`
  );
}

// ── Serializable Step 2 Config (for async portrait pipeline) ─────────────────

/**
 * Serializable config for the Flux img2img step.
 * Stored in images.settings so the status endpoint can build the workflow
 * when Step 1 (SDXL) completes.
 */
export interface FemaleBodyStep2Config {
  kontextModel: string;
  img2imgPrompt: string;
  width: number;
  height: number;
  denoise: number;
  loras: Array<{ filename: string; strengthModel: number; strengthClip: number }>;
  seed: number;
  filenamePrefix: string;
}

/**
 * Build a serializable Step 2 config for the Flux img2img conversion.
 * This is stored in images.settings and used by the status endpoint
 * to submit the Flux job when SDXL completes.
 */
export function buildFemaleBodyStep2Config(params: {
  ethnicity: string;
  skinTone: string;
  bodyType: string;
  hairStyle: string;
  hairColor: string;
  seed: number;
  filenamePrefix: string;
  clothingAndPose?: string;
}): FemaleBodyStep2Config {
  return {
    kontextModel: FEMALE_BODY_KONTEXT_MODEL,
    img2imgPrompt: buildFemaleBodyImg2ImgPrompt(params),
    width: FEMALE_BODY_KONTEXT_CONFIG.width,
    height: FEMALE_BODY_KONTEXT_CONFIG.height,
    denoise: FEMALE_BODY_KONTEXT_CONFIG.denoise,
    loras: [...FEMALE_BODY_KONTEXT_LORAS],
    seed: params.seed,
    filenamePrefix: params.filenamePrefix,
  };
}
