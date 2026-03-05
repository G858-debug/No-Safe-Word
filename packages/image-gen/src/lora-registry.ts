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

/** Extended LoRA entry for character-specific LoRAs loaded from the database */
export interface CharacterLoraEntry extends LoraEntry {
  characterId: string;
  characterName: string;
  /** Supabase Storage URL for RunPod to download at runtime */
  storageUrl: string;
}

/** Build a LoraEntry from a character_loras database record */
export function buildCharacterLoraEntry(dbRecord: {
  character_id: string;
  character_name: string;
  filename: string;
  trigger_word: string;
  storage_url: string;
}): CharacterLoraEntry {
  return {
    name: `Character: ${dbRecord.character_name}`,
    filename: `characters/${dbRecord.filename}`,
    category: 'character',
    defaultStrength: 0.8,
    clipStrength: 0.8,
    triggerWord: dbRecord.trigger_word,
    description: `Trained character LoRA for ${dbRecord.character_name}`,
    compatibleWith: ['sfw', 'nsfw'],
    installed: false, // Downloaded at runtime by RunPod worker
    characterId: dbRecord.character_id,
    characterName: dbRecord.character_name,
    storageUrl: dbRecord.storage_url,
  };
}

export const LORA_REGISTRY: LoraEntry[] = [
  {
    name: 'Detail Tweaker XL',
    filename: 'detail-tweaker-xl.safetensors',
    category: 'detail',
    defaultStrength: 0.5,
    clipStrength: 0.5,
    description: 'Overall sharpness and detail enhancement, always on',
    compatibleWith: ['sfw', 'nsfw'],
    installed: true,
    genderCategory: 'neutral',
  },
  {
    name: 'Realistic Skin XL',
    filename: 'realistic-skin-xl.safetensors',
    category: 'skin',
    defaultStrength: 0.75,
    clipStrength: 0.75,
    description: 'Photorealistic skin texture for close-up and medium shots (Skin Texture Style v4 by EauDeNoire)',
    compatibleWith: ['sfw', 'nsfw'],
    installed: true,
    genderCategory: 'neutral',
  },
  {
    name: 'Eyes Detail XL',
    filename: 'eyes-detail-xl.safetensors',
    category: 'eyes',
    defaultStrength: 0.5,
    clipStrength: 0.5,
    description: 'Better eyes and gaze accuracy for eye contact shots (DetailedEyes v3 by bdsqlsz)',
    compatibleWith: ['sfw', 'nsfw'],
    installed: true,
    genderCategory: 'neutral',
  },
  {
    name: 'Hands XL',
    filename: 'negative-hands-v2.safetensors',
    category: 'hands',
    defaultStrength: 0.8,
    clipStrength: 0.8,
    description: 'Reduce hand artifacts, use only when hands are visible (Hands XL v2.1 by EauDeNoire)',
    compatibleWith: ['sfw', 'nsfw'],
    installed: true,
    genderCategory: 'neutral',
  },
  {
    name: 'Better Bodies XL',
    filename: 'better-bodies-xl.safetensors',
    category: 'bodies',
    defaultStrength: 0.5,
    clipStrength: 0.5,
    description: 'Anatomical accuracy for NSFW content',
    compatibleWith: ['nsfw'],
    installed: true,
    genderCategory: 'female',
  },
  {
    name: 'Curvy Body SDXL',
    filename: 'curvy-body-sdxl.safetensors',
    category: 'bodies',
    defaultStrength: 0.7,
    clipStrength: 0.7,
    description: 'Curvy body shape enhancement for realistic proportions',
    compatibleWith: ['sfw', 'nsfw'],
    installed: true,
    genderCategory: 'female',
  },
  {
    name: 'Cinematic Lighting XL',
    filename: 'cinematic-lighting-xl.safetensors',
    category: 'lighting',
    defaultStrength: 0.4,
    clipStrength: 0.4,
    description: 'Enhanced dramatic lighting for cinematic scenes (ntc-ai slider)',
    compatibleWith: ['sfw', 'nsfw'],
    installed: true,
    genderCategory: 'neutral',
  },
  {
    name: 'CineColor Harmonizer',
    filename: 'cinecolor-harmonizer.safetensors',
    category: 'cinematic',
    defaultStrength: 0.3,
    clipStrength: 0.3,
    triggerWord: 'sunset_gold_film',
    description: 'Warm golden color grading with cinematic contrast — pure palette modifier, no anatomy changes (jarod2212)',
    compatibleWith: ['sfw', 'nsfw'],
    installed: true,
    genderCategory: 'neutral',
  },
  {
    name: 'Melanin Mix XL',
    filename: 'melanin-mix-xl.safetensors',
    category: 'melanin',
    defaultStrength: 0.5,
    clipStrength: 0.5,
    triggerWord: 'melanin',
    description: 'Dark skin tone and texture enhancement trained on 1000+ Black influencer photos (Ggrue)',
    compatibleWith: ['sfw', 'nsfw'],
    installed: true,
    genderCategory: 'neutral',
  },
  {
    name: 'Couples Poses XL',
    filename: 'couples-poses-xl.safetensors',
    category: 'style',
    defaultStrength: 0.6,
    clipStrength: 0.6,
    triggerWord: 'couples_pose',
    description: 'Improved dual-character pose composition — reduces merged limbs and anatomical errors in two-person scenes',
    compatibleWith: ['sfw', 'nsfw'],
    installed: true,
    genderCategory: 'neutral',
  },
  {
    name: 'Touch of Realism V2',
    filename: 'touch-of-realism-v2.safetensors',
    category: 'cinematic',
    defaultStrength: 0.45,
    clipStrength: 0.45,
    triggerWord: 'touch-of-realismV2',
    description: 'Real photography lens effects — shallow DOF, bokeh, light flares, natural depth separation (trained on Sony A7III photos by Huslyo)',
    compatibleWith: ['sfw', 'nsfw'],
    installed: true,
    genderCategory: 'neutral',
  },
  {
    name: 'High Fashion SDXL',
    filename: 'high-fashion-xl.safetensors',
    category: 'detail',
    defaultStrength: 0.4,
    clipStrength: 0.4,
    description: 'Fashion photography clothing and fabric detail enhancement — improves garment rendering, fabric textures, and clothing accuracy',
    compatibleWith: ['sfw', 'nsfw'],
    installed: true,
    genderCategory: 'female',
  },
  {
    name: 'Interior Design Universal SDXL',
    filename: 'interior-design-xl.safetensors',
    category: 'style',
    defaultStrength: 0.4,
    clipStrength: 0.4,
    triggerWord: 'mrares',
    description: 'Indoor scene enhancement — improves restaurants, bedrooms, kitchens, workshops with better light/shadow and spatial depth (by AresWei)',
    compatibleWith: ['sfw', 'nsfw'],
    installed: true,
    genderCategory: 'neutral',
  },
  {
    name: 'Braids & Cornrows SDXL',
    filename: 'braids-cornrows-xl.safetensors',
    category: 'detail',
    defaultStrength: 0.5,
    clipStrength: 0.5,
    triggerWord: 'braided side',
    description: 'Braided hairstyle detail enhancement — cornrows, side braids, African braided styles (by staffy)',
    compatibleWith: ['sfw', 'nsfw'],
    installed: true,
    genderCategory: 'female',
  },
];

// ---- Kontext (Flux) LoRAs — loaded from /runpod-volume/models/loras/ ----
export const KONTEXT_LORA_REGISTRY: LoraEntry[] = [
  {
    name: 'XLabs Flux Realism',
    filename: 'flux_realism_lora.safetensors',
    category: 'style',
    defaultStrength: 0.8,
    clipStrength: 0.8,
    description: 'Photorealism enhancement for Flux — natural skin, lighting, and textures (XLabs-AI, 55k+ downloads)',
    compatibleWith: ['sfw', 'nsfw'],
    installed: true,
    genderCategory: 'neutral',
  },
  {
    name: 'Shakker-Labs Add Details',
    filename: 'flux-add-details.safetensors',
    category: 'detail',
    defaultStrength: 0.6,
    clipStrength: 0.6,
    description: 'Detail and natural skin enhancement for Flux — pore-level realism without over-sharpening (Shakker-Labs)',
    compatibleWith: ['sfw', 'nsfw'],
    installed: true,
    genderCategory: 'neutral',
  },
  {
    name: 'FC Flux Perfect Busts',
    filename: 'fc-flux-perfect-busts.safetensors',
    category: 'bodies',
    defaultStrength: 0.7,
    clipStrength: 0.7,
    triggerWord: 'woman',
    description: 'Full round breasts with slim waist for Flux — trained on Flux.1 Dev (FC, 25k+ downloads)',
    compatibleWith: ['sfw', 'nsfw'],
    installed: true,
    genderCategory: 'female',
  },
  {
    name: 'Hourglass Body Shape Flux',
    filename: 'hourglassv32_FLUX.safetensors',
    category: 'bodies',
    defaultStrength: 0.9,
    clipStrength: 0.9,
    description: 'Hourglass figure enhancement — wide hips, round butt, thick thighs for Flux (olaz, 9.5k downloads)',
    compatibleWith: ['sfw', 'nsfw'],
    installed: true,
    genderCategory: 'female',
  },
  {
    name: 'Flux Two People Kissing',
    filename: 'flux-two-people-kissing.safetensors',
    category: 'style',
    defaultStrength: 0.7,
    clipStrength: 0.7,
    triggerWord: 'kissing',
    description: 'Realistic two-person kissing — prevents face merging and lip distortion (AEmotionStudio, 104 training images)',
    compatibleWith: ['sfw', 'nsfw'],
    installed: true,
    genderCategory: 'neutral',
  },
  {
    name: 'Flux Lustly NSFW',
    filename: 'flux_lustly-ai_v1.safetensors',
    category: 'bodies',
    defaultStrength: 0.7,
    clipStrength: 0.7,
    description: 'Male and female anatomy accuracy for intimate scenes — improves body interaction and nudity rendering (Lustly.ai)',
    compatibleWith: ['nsfw'],
    installed: true,
    genderCategory: 'neutral',
  },
];

export function getKontextLoras(gender?: 'male' | 'female' | 'neutral'): LoraEntry[] {
  return KONTEXT_LORA_REGISTRY.filter(
    (l) => l.genderCategory === 'neutral' || l.genderCategory === gender,
  );
}

export interface KontextResourceSelection {
  loras: Array<{ filename: string; strengthModel: number; strengthClip: number }>;
}

/**
 * Scene-aware Kontext LoRA selection. Adapts which LoRAs are loaded and their
 * strengths based on character gender, SFW/NSFW, shot type, and character count.
 */
export function selectKontextResources(opts: {
  gender: 'male' | 'female';
  secondaryGender?: 'male' | 'female';
  isSfw: boolean;
  imageType: string;
  prompt: string;
  hasDualCharacter: boolean;
}): KontextResourceSelection {
  const { gender, secondaryGender, isSfw, imageType, prompt, hasDualCharacter } = opts;
  const isFacebookSfw = imageType === 'facebook_sfw';
  const isNsfw = imageType === 'website_nsfw_paired';
  const isCloseUp = /\b(close-up|closeup|detail|portrait|face)\b/i.test(prompt);
  const isWide = /\b(wide|establishing|panoram|full.body)\b/i.test(prompt);
  const isKissing = /\b(kiss|kissing|kisses|french.kiss|lips.meet|lips.touch)\b/i.test(prompt);
  const isIntimate = /\b(naked|nude|sex|intimate|penetrat|straddle|undress|topless)\b/i.test(prompt);
  const isFemale = gender === 'female';
  // Include female body LoRAs if either character is female
  const hasFemaleCharacter = isFemale || secondaryGender === 'female';

  const loras: Array<{ filename: string; strengthModel: number; strengthClip: number }> = [];

  // 1. Realism LoRA — always included
  let realismStrength = 0.8;
  if (isFacebookSfw) realismStrength = 0.9;
  if (hasDualCharacter) realismStrength = 0.7;
  loras.push({ filename: 'flux_realism_lora.safetensors', strengthModel: realismStrength, strengthClip: realismStrength });

  // 2. Detail LoRA — always included, strength varies by shot type
  let detailStrength = 0.6;
  if (isCloseUp) detailStrength = 0.8;
  else if (isWide) detailStrength = 0.4;
  if (hasDualCharacter) detailStrength = Math.min(detailStrength, 0.5);
  loras.push({ filename: 'flux-add-details.safetensors', strengthModel: detailStrength, strengthClip: detailStrength });

  // 3. Body LoRAs — included when ANY character is female
  // For dual scenes with a male primary + female secondary, we still want body
  // enhancement for the female character (at slightly reduced strength).
  if (hasFemaleCharacter) {
    const isSecondaryOnly = !isFemale && secondaryGender === 'female';
    const secondaryReduction = isSecondaryOnly ? 0.7 : 1.0; // 30% reduction when female is only secondary

    let bustsStrength = 0.7 * secondaryReduction;
    if (isFacebookSfw) bustsStrength = 0.4 * secondaryReduction;
    else if (isNsfw) bustsStrength = 0.8 * secondaryReduction;
    loras.push({ filename: 'fc-flux-perfect-busts.safetensors', strengthModel: Math.round(bustsStrength * 100) / 100, strengthClip: Math.round(bustsStrength * 100) / 100 });

    let hourglassStrength = 0.9 * secondaryReduction;
    if (isFacebookSfw) hourglassStrength = 0.5 * secondaryReduction;
    loras.push({ filename: 'hourglassv32_FLUX.safetensors', strengthModel: Math.round(hourglassStrength * 100) / 100, strengthClip: Math.round(hourglassStrength * 100) / 100 });
  }

  // 4. Kissing LoRA — dual-character kissing scenes
  if (hasDualCharacter && isKissing) {
    let kissStrength = 0.7;
    if (isCloseUp) kissStrength = 0.85; // stronger for close-up kisses
    loras.push({ filename: 'flux-two-people-kissing.safetensors', strengthModel: kissStrength, strengthClip: kissStrength });
  }

  // 5. NSFW anatomy LoRA — intimate/sex scenes only
  if (!isSfw && isIntimate) {
    let nsfwStrength = 0.7;
    if (hasDualCharacter) nsfwStrength = 0.6; // reduce slightly to stay under budget
    loras.push({ filename: 'flux_lustly-ai_v1.safetensors', strengthModel: nsfwStrength, strengthClip: nsfwStrength });
  }

  // Strength budget cap — scale down if total exceeds 3.5
  const MAX_TOTAL_STRENGTH = 3.5;
  const totalStrength = loras.reduce((sum, l) => sum + l.strengthModel, 0);
  if (totalStrength > MAX_TOTAL_STRENGTH) {
    const scale = MAX_TOTAL_STRENGTH / totalStrength;
    for (const l of loras) {
      l.strengthModel = Math.round(l.strengthModel * scale * 100) / 100;
      l.strengthClip = Math.round(l.strengthClip * scale * 100) / 100;
    }
  }

  return { loras };
}

export function getLorasByCategory(category: LoraCategory): LoraEntry[] {
  return LORA_REGISTRY.filter((l) => l.category === category);
}

export function getLoraByFilename(filename: string): LoraEntry | undefined {
  return LORA_REGISTRY.find((l) => l.filename === filename);
}
