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
    defaultStrength: 0.65,
    clipStrength: 0.65,
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

export function getLorasByCategory(category: LoraCategory): LoraEntry[] {
  return LORA_REGISTRY.filter((l) => l.category === category);
}

export function getLoraByFilename(filename: string): LoraEntry | undefined {
  return LORA_REGISTRY.find((l) => l.filename === filename);
}
