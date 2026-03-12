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
    name: 'BodyLicious FLUX',
    filename: 'bodylicious-flux.safetensors',
    category: 'bodies',
    defaultStrength: 0.8,
    clipStrength: 0.8,
    triggerWord: 'huge breasts, huge hips, huge ass, narrow waist',
    description: 'Exaggerated feminine curves LoRA — huge breasts, huge hips, huge ass, narrow waist (Flux Dev, CivitAI 238105 v979680)',
    compatibleWith: ['sfw', 'nsfw'],
    installed: false,
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
  {
    name: 'Boudoir Style Flux',
    filename: 'boudoir-style-flux.safetensors',
    category: 'style',
    defaultStrength: 0.6,
    clipStrength: 0.6,
    triggerWord: 'boud01rstyle',
    description: 'Boudoir photography aesthetic — intimate, sensual atmosphere with soft warm lighting and elegant posing (CivitAI #1122736)',
    compatibleWith: ['nsfw'],
    installed: false,
    genderCategory: 'female',
  },
  {
    name: 'Flux Fashion Editorial',
    filename: 'flux-fashion-editorial.safetensors',
    category: 'style',
    defaultStrength: 0.5,
    clipStrength: 0.5,
    triggerWord: 'flux-fash',
    description: 'Premium fashion editorial photography — luxury magazine look, sharp cheekbones, flawless skin, high-end studio lighting (CivitAI #2138223)',
    compatibleWith: ['sfw', 'nsfw'],
    installed: true,
    genderCategory: 'female',
  },
  {
    name: 'Flux Oiled Skin',
    filename: 'flux-oiled-skin.safetensors',
    category: 'skin',
    defaultStrength: 0.7,
    clipStrength: 0.7,
    description: 'Oil sheen on skin — glistening, slick highlight effect. Triggered by scene keywords: oiled, glistening, shiny skin (CivitAI #770197)',
    compatibleWith: ['sfw', 'nsfw'],
    installed: false,
    genderCategory: 'neutral',
  },
  {
    name: 'Flux Sweat Effect',
    filename: 'flux-sweat-v2.safetensors',
    category: 'skin',
    defaultStrength: 0.6,
    clipStrength: 0.6,
    description: 'Sweat droplets and glistening skin — from close-up drops to overall shiny look for gym/sport/cinematic scenes (CivitAI #1059415)',
    compatibleWith: ['sfw', 'nsfw'],
    installed: false,
    genderCategory: 'neutral',
  },
  {
    name: 'Flux Beauty Skin',
    filename: 'flux-beauty-skin.safetensors',
    category: 'skin',
    defaultStrength: 0.3,
    clipStrength: 0.3,
    triggerWord: 'mdlnbaytskn',
    description: 'Photorealistic skin texture with natural detail, avoids plastic look — pore-level realism for close-up portraits (CivitAI #2298043)',
    compatibleWith: ['sfw', 'nsfw'],
    installed: false,
    genderCategory: 'neutral',
  },
  {
    name: 'RefControl Kontext Pose',
    filename: 'refcontrol_pose.safetensors',
    category: 'style',
    defaultStrength: 0.9,
    clipStrength: 0.9,
    triggerWord: 'refcontrolpose',
    description: 'Full character identity + pose transfer for Flux Kontext — requires ref+pose concatenated image input (HuggingFace: thedeoxen/refcontrol-flux-kontext-reference-pose-lora)',
    compatibleWith: ['sfw', 'nsfw'],
    installed: false,
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
  /** Trigger words that must appear in the positive prompt for selected LoRAs to activate fully. */
  triggerWords: string[];
}

/**
 * Scene-aware Kontext LoRA selection for Flux Krea Dev Uncensored.
 *
 * Slot Priority Order (max 6 slots):
 *   Slot 1: Character LoRA (face + body identity) — injected by caller, not here
 *   Slot 2: Ethnicity/skin LoRA (African Fashion Model or African Woman)
 *   Slot 3: Skin texture LoRA (Beauty Skin / Oiled / Sweat — situational)
 *   Slot 4: Body shape LoRA (Hourglass or BodyLicious — configurable)
 *   Slot 5: Anatomy/NSFW LoRA (Lustly v1, strength 0.7 — NSFW intimate only)
 *   Slot 6: Atmosphere LoRA (Boudoir Style or Fashion Editorial)
 *
 * Krea Dev has built-in photorealism — Realism and Detail LoRAs removed.
 * Character LoRA with full-body training replaces stacked body LoRAs
 * (NSW Curves + Perfect Busts removed from default stack).
 */
export function selectKontextResources(opts: {
  gender: 'male' | 'female';
  secondaryGender?: 'male' | 'female';
  isSfw: boolean;
  imageType: string;
  prompt: string;
  hasDualCharacter: boolean;
  /** Which body shape LoRA to use: 'hourglass', 'bodylicious', or 'auto' (default: bodylicious) */
  bodyShapeLoRA?: 'hourglass' | 'bodylicious' | 'auto';
  /** Include RefControl Kontext pose LoRA for identity+pose transfer */
  hasRefControlPose?: boolean;
}): KontextResourceSelection {
  const { gender, secondaryGender, isSfw, imageType, prompt, hasDualCharacter } = opts;
  const bodyShape = opts.bodyShapeLoRA ?? 'auto';
  const isFullBody = imageType === 'fullBody';
  const isCloseUp = /\b(close-up|closeup|detail|portrait|face)\b/i.test(prompt);
  const isIntimate = /\b(naked|nude|sex|intimate|penetrat|straddle|undress|topless)\b/i.test(prompt);
  const isOiled = /\b(oil(?:ed)?|glistening.skin|shiny.skin|slick.skin|oily)\b/i.test(prompt);
  const isSweaty = /\b(sweat(?:y|ing)?|perspir|gym|workout|post-workout|athletic)\b/i.test(prompt);
  const isFemale = gender === 'female';
  const hasFemaleCharacter = isFemale || secondaryGender === 'female';

  const loras: Array<{ filename: string; strengthModel: number; strengthClip: number }> = [];
  const pendingTriggers: string[] = [];

  // Slot 1: Character LoRA — injected by the caller (generate-scene-image.ts)
  // via character_lora_downloads, not selected here. Slot reserved.

  // Slot 2: Skin texture LoRA — situational, mutually exclusive
  //   Priority: oiled > sweaty > beauty skin (close-up female)
  if (isOiled) {
    loras.push({ filename: 'flux-oiled-skin.safetensors', strengthModel: 0.7, strengthClip: 0.7 });
  } else if (isSweaty) {
    loras.push({ filename: 'flux-sweat-v2.safetensors', strengthModel: 0.6, strengthClip: 0.6 });
  } else if (isCloseUp && hasFemaleCharacter) {
    loras.push({ filename: 'flux-beauty-skin.safetensors', strengthModel: 0.3, strengthClip: 0.3 });
    pendingTriggers.push('mdlnbaytskn');
  }

  // Slot 3: Body shape LoRA — single slot, female characters only
  //   Configurable: 'hourglass' (wide hips, thick thighs) or 'bodylicious' (exaggerated curves)
  //   'auto' defaults to bodylicious for its stronger curve reinforcement
  if (hasFemaleCharacter) {
    const isSecondaryOnly = !isFemale && secondaryGender === 'female';
    const secondaryReduction = isSecondaryOnly ? 0.7 : 1.0;

    const useHourglass = bodyShape === 'hourglass';
    if (useHourglass) {
      let strength = 0.9 * secondaryReduction;
      if (isCloseUp) strength = 0.5 * secondaryReduction; // less body emphasis for close-ups
      loras.push({ filename: 'hourglassv32_FLUX.safetensors', strengthModel: Math.round(strength * 100) / 100, strengthClip: Math.round(strength * 100) / 100 });
    } else {
      // bodylicious or auto
      let strength = 0.7 * secondaryReduction;
      if (isFullBody) strength = 0.95 * secondaryReduction;
      if (isCloseUp) strength = 0.4 * secondaryReduction;
      loras.push({ filename: 'bodylicious-flux.safetensors', strengthModel: Math.round(strength * 100) / 100, strengthClip: Math.round(strength * 100) / 100 });
      pendingTriggers.push('huge breasts', 'huge hips', 'huge ass', 'narrow waist');
    }
  }

  // Slot 4: Anatomy/NSFW LoRA — intimate scenes only
  if (!isSfw && isIntimate) {
    let nsfwStrength = 0.7;
    if (hasDualCharacter) nsfwStrength = 0.6;
    loras.push({ filename: 'flux_lustly-ai_v1.safetensors', strengthModel: nsfwStrength, strengthClip: nsfwStrength });
  }

  // Slot 5: Atmosphere LoRA
  //   • NSFW female → Boudoir Style (intimate/sensual atmosphere)
  //   • SFW female (non-full-body) → Fashion Editorial (luxury magazine look)
  if (hasFemaleCharacter && !isSfw) {
    loras.push({ filename: 'boudoir-style-flux.safetensors', strengthModel: 0.6, strengthClip: 0.6 });
    pendingTriggers.push('boud01rstyle');
  } else if (hasFemaleCharacter && isSfw && !isFullBody) {
    loras.push({ filename: 'flux-fashion-editorial.safetensors', strengthModel: 0.5, strengthClip: 0.5 });
    pendingTriggers.push('flux-fash');
  }

  // Slot 6: RefControl Kontext pose LoRA — optional, for identity+pose transfer
  if (opts.hasRefControlPose && loras.length < 6) {
    loras.push({ filename: 'refcontrol_pose.safetensors', strengthModel: 0.9, strengthClip: 0.9 });
    pendingTriggers.push('refcontrolpose');
  }

  // Strength budget cap — scale down if total exceeds 4.0
  const MAX_TOTAL_STRENGTH = 4.0;
  const totalStrength = loras.reduce((sum, l) => sum + l.strengthModel, 0);
  if (totalStrength > MAX_TOTAL_STRENGTH) {
    const scale = MAX_TOTAL_STRENGTH / totalStrength;
    for (const l of loras) {
      l.strengthModel = Math.round(l.strengthModel * scale * 100) / 100;
      l.strengthClip = Math.round(l.strengthClip * scale * 100) / 100;
    }
  }

  // Filter out trigger words already present in the prompt
  const triggerWords = pendingTriggers.filter(
    (t) => !new RegExp(`\\b${t}\\b`, 'i').test(prompt)
  );

  return { loras, triggerWords };
}

