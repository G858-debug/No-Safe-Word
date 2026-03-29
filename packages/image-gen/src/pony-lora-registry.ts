/**
 * Pony V6 / CyberRealistic Pony Semi-Realistic LoRA registry for the V4 (pony_cyberreal) pipeline.
 *
 * These LoRAs are SDXL-compatible and loaded by CyberRealistic Pony Semi-Realistic v4.5.
 * Unlike Flux LoRAs (which use prose prompts), Pony LoRAs use booru-style tags.
 *
 * Character LoRAs are managed via the existing `character_loras` table and
 * Character LoRA entries are built inline where needed.
 */

export type LoraCategory = 'detail' | 'skin' | 'eyes' | 'hands' | 'lighting' | 'bodies' | 'style' | 'cinematic' | 'melanin' | 'character';
export type ContentMode = 'sfw' | 'nsfw';

export interface LoraEntry {
  name: string;
  filename: string;
  category: LoraCategory;
  defaultStrength: number;
  clipStrength: number;
  triggerWord?: string;
  description: string;
  compatibleWith: ContentMode[];
  /** Whether this LoRA is installed on the RunPod ComfyUI instance */
  installed: boolean;
  /** Gender relevance: 'female' LoRAs only apply to female characters,
   *  'male' only to male, 'neutral' applies to all. Defaults to 'neutral'. */
  genderCategory?: 'male' | 'female' | 'neutral';
}

// ---- Pony/SDXL style LoRAs — loaded from /runpod-volume/models/loras/ ----
export const PONY_LORA_REGISTRY: LoraEntry[] = [
  {
    name: 'Ebony Pony',
    filename: 'pony-ebony-skin.safetensors',
    category: 'melanin',
    defaultStrength: 0.6,
    clipStrength: 0.6,
    triggerWord: 'aiebonyskin',
    description: 'Dark skin / black skin enhancement for Pony — CivitAI model 513296, version 595483',
    compatibleWith: ['sfw', 'nsfw'],
    installed: true,
    genderCategory: 'neutral',
  },
  {
    name: 'Skin Tone Slider PonyXL',
    filename: 'pony-skin-tone-slider.safetensors',
    category: 'melanin',
    defaultStrength: 3.0,
    clipStrength: 1.0,
    description: 'Slider LoRA for skin tone adjustment (positive = lighter, negative = darker) — CivitAI model 421744, version 1106176',
    compatibleWith: ['sfw', 'nsfw'],
    installed: true,
    genderCategory: 'neutral',
  },
  {
    name: 'Hourglass Body Pony',
    filename: 'pony-hourglass-body.safetensors',
    category: 'bodies',
    defaultStrength: 0.85,
    clipStrength: 0.85,
    triggerWord: 'hourglass body shape',
    description: 'Hourglass body shape v2 for Pony — wide hips, narrow waist — CivitAI model 129130, version 928762',
    compatibleWith: ['sfw', 'nsfw'],
    installed: true,
    genderCategory: 'female',
  },
  {
    name: 'Perfect Breasts v2',
    filename: 'perfect-breasts-v2.safetensors',
    category: 'bodies',
    defaultStrength: 0.65,
    clipStrength: 0.65,
    description: 'Breast shape/fullness LoRA — CivitAI model 1621732, version 1987668',
    compatibleWith: ['sfw', 'nsfw'],
    installed: true,
    genderCategory: 'female',
  },
  {
    name: 'Realism Stable Yogi',
    filename: 'pony-realism-stable-yogi.safetensors',
    category: 'skin',
    defaultStrength: 0.7,
    clipStrength: 0.7,
    description: 'Photorealism enhancement v3.0_lite for Pony — CivitAI model 1098033, version 2074888',
    compatibleWith: ['sfw', 'nsfw'],
    installed: true,
    genderCategory: 'neutral',
  },
  {
    name: 'Detail Slider PonyXL',
    filename: 'pony-detail-slider.safetensors',
    category: 'detail',
    defaultStrength: 3.0,
    clipStrength: 1.0,
    description: 'Slider LoRA for detail level adjustment v1.4 — CivitAI model 402462, version 712947',
    compatibleWith: ['sfw', 'nsfw'],
    installed: true,
    genderCategory: 'neutral',
  },
];

/** Filter registry by gender */
export function getPonyLoras(gender?: 'male' | 'female' | 'neutral'): LoraEntry[] {
  if (!gender) return PONY_LORA_REGISTRY.filter((l) => l.installed);
  return PONY_LORA_REGISTRY.filter(
    (l) => l.installed && (!l.genderCategory || l.genderCategory === gender || l.genderCategory === 'neutral'),
  );
}

export interface PonyResourceSelection {
  loras: Array<{ filename: string; strengthModel: number; strengthClip: number }>;
  triggerWords: string[];
}

/**
 * Select style LoRAs for a Pony scene based on character gender, ethnicity, and scene context.
 *
 * Always loads: realism + detail slider.
 * Conditionally loads: ethnicity LoRAs (African/Black), body shape LoRAs (female).
 * Character LoRAs are handled separately by the scene generation function.
 */
export function selectPonyResources(opts: {
  gender: 'male' | 'female';
  secondaryGender?: 'male' | 'female';
  isSfw: boolean;
  imageType: string;
  prompt: string;
  hasDualCharacter: boolean;
  primaryEthnicity?: string;
  secondaryEthnicity?: string;
}): PonyResourceSelection {
  const loras: PonyResourceSelection['loras'] = [];
  const triggerWords: string[] = [];

  const findLora = (filename: string) => PONY_LORA_REGISTRY.find((l) => l.filename === filename);

  // --- Always loaded: realism + detail ---
  const realism = findLora('pony-realism-stable-yogi.safetensors');
  if (realism?.installed) {
    loras.push({ filename: realism.filename, strengthModel: realism.defaultStrength, strengthClip: realism.clipStrength });
  }

  const detail = findLora('pony-detail-slider.safetensors');
  if (detail?.installed) {
    loras.push({ filename: detail.filename, strengthModel: detail.defaultStrength, strengthClip: detail.clipStrength });
  }

  // --- Ethnicity LoRAs: loaded for Black/African characters ---
  const isAfricanEthnicity = (eth?: string) => eth != null && /\b(black|african)\b/i.test(eth);
  if (isAfricanEthnicity(opts.primaryEthnicity) || isAfricanEthnicity(opts.secondaryEthnicity)) {
    const ebony = findLora('pony-ebony-skin.safetensors');
    if (ebony?.installed) {
      loras.push({ filename: ebony.filename, strengthModel: ebony.defaultStrength, strengthClip: ebony.clipStrength });
      if (ebony.triggerWord) triggerWords.push(ebony.triggerWord);
    }

    const skinTone = findLora('pony-skin-tone-slider.safetensors');
    if (skinTone?.installed) {
      loras.push({ filename: skinTone.filename, strengthModel: skinTone.defaultStrength, strengthClip: skinTone.clipStrength });
    }
  }

  // --- Body shape LoRAs: female characters only ---
  const hasFemaleCharacter = opts.gender === 'female' || opts.secondaryGender === 'female';
  if (hasFemaleCharacter) {
    const hourglass = findLora('pony-hourglass-body.safetensors');
    if (hourglass?.installed) {
      loras.push({ filename: hourglass.filename, strengthModel: hourglass.defaultStrength, strengthClip: hourglass.clipStrength });
      if (hourglass.triggerWord) triggerWords.push(hourglass.triggerWord);
    }

    const breasts = findLora('perfect-breasts-v2.safetensors');
    if (breasts?.installed) {
      const breastStrength = opts.hasDualCharacter ? 0.45 : breasts.defaultStrength;
      loras.push({ filename: breasts.filename, strengthModel: breastStrength, strengthClip: breastStrength });
    }
  }

  return { loras, triggerWords };
}
