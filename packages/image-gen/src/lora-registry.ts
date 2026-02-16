export type LoraCategory = 'detail' | 'skin' | 'eyes' | 'hands' | 'lighting' | 'bodies' | 'style';
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
  },
  {
    name: 'Realistic Skin XL',
    filename: 'realistic-skin-xl.safetensors',
    category: 'skin',
    defaultStrength: 0.6,
    clipStrength: 0.6,
    description: 'Photorealistic skin texture for close-up and medium shots',
    compatibleWith: ['sfw', 'nsfw'],
  },
  {
    name: 'Eyes Detail XL',
    filename: 'eyes-detail-xl.safetensors',
    category: 'eyes',
    defaultStrength: 0.5,
    clipStrength: 0.5,
    description: 'Better eyes and gaze accuracy for eye contact shots',
    compatibleWith: ['sfw', 'nsfw'],
  },
  {
    name: 'Negative Hands v2',
    filename: 'negative-hands-v2.safetensors',
    category: 'hands',
    defaultStrength: 0.8,
    clipStrength: 0.8,
    description: 'Reduce hand artifacts, use only when hands are visible',
    compatibleWith: ['sfw', 'nsfw'],
  },
  {
    name: 'Better Bodies XL',
    filename: 'better-bodies-xl.safetensors',
    category: 'bodies',
    defaultStrength: 0.5,
    clipStrength: 0.5,
    description: 'Anatomical accuracy for NSFW content',
    compatibleWith: ['nsfw'],
  },
  {
    name: 'Cinematic Lighting XL',
    filename: 'cinematic-lighting-xl.safetensors',
    category: 'lighting',
    defaultStrength: 0.4,
    clipStrength: 0.4,
    description: 'Enhanced dramatic lighting for cinematic scenes',
    compatibleWith: ['sfw', 'nsfw'],
  },
];

export function getLorasByCategory(category: LoraCategory): LoraEntry[] {
  return LORA_REGISTRY.filter((l) => l.category === category);
}

export function getLoraByFilename(filename: string): LoraEntry | undefined {
  return LORA_REGISTRY.find((l) => l.filename === filename);
}
