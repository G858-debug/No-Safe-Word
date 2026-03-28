import { DEFAULT_DIAGNOSTIC_FLAGS, type DiagnosticFlags } from './diagnostic-flags';

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
    name: 'Flux Realism Cinematic Finisher',
    filename: 'flux-cinematic-finisher.safetensors',
    category: 'cinematic',
    defaultStrength: 0.5,
    clipStrength: 0.5,
    triggerWord: 'realism_cinema',
    description: 'Cinematic realism enhancement — editorial skin textures, dramatic directional lighting, and sharp fabric/clothing detail. Covers interior mood lighting and African print/textile sharpness in one LoRA. (CivitAI #1902557 v2153525, trigger: realism_cinema)',
    compatibleWith: ['sfw', 'nsfw'],
    installed: true,
    genderCategory: 'neutral',
  },
  {
    name: 'African Woman Flux',
    filename: 'african-woman-flux.safetensors',
    category: 'melanin',
    defaultStrength: 0.6,
    clipStrength: 0.6,
    description: 'African ethnicity enhancement for Flux — skin tone accuracy and feature consistency for Black/African characters',
    compatibleWith: ['sfw', 'nsfw'],
    installed: false,
    genderCategory: 'female',
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
 * Slot Priority Order (max 7 slots):
 *   Slot 1: Realism LoRA (always loaded — Krea Dev still needs it for quality)
 *   Slot 2: Detail/Style LoRA (Fashion Editorial SFW / Boudoir NSFW / Add Details)
 *   Slot 3: Skin texture LoRA (Beauty Skin / Oiled / Sweat — situational)
 *   Slot 4: Body shape LoRA (BodyLicious / Hourglass — female only)
 *   Slot 5: Kissing LoRA / Lustly NSFW anatomy
 *   Slot 6: RefControl pose LoRA (optional)
 *   Slot 7: Cinematic Finisher (interior/night OR clothing — not close-up/wide)
 *
 * Character LoRA (face + body identity) is injected by the caller, not selected here.
 * NSW Curves + Perfect Busts removed — single BodyLicious replaces stacked body LoRAs.
 */
export function selectKontextResources(opts: {
  gender: 'male' | 'female';
  secondaryGender?: 'male' | 'female';
  isSfw: boolean;
  imageType: string;
  prompt: string;
  hasDualCharacter: boolean;
  /** Primary character ethnicity — used to load ethnicity-specific LoRAs */
  primaryEthnicity?: string;
  /** Secondary character ethnicity */
  secondaryEthnicity?: string;
  /** Which body shape LoRA to use: 'hourglass', 'bodylicious', or 'auto' (default: bodylicious) */
  bodyShapeLoRA?: 'hourglass' | 'bodylicious' | 'auto';
  /** Override base strength for body shape LoRA (default: 0.8 bodylicious, 0.9 hourglass) */
  bodyShapeStrength?: number;
  /** Include RefControl Kontext pose LoRA for identity+pose transfer */
  hasRefControlPose?: boolean;
  /** Diagnostic flags to selectively disable LoRA slots */
  diagnosticFlags?: Partial<DiagnosticFlags>;
}): KontextResourceSelection {
  const { gender, secondaryGender, isSfw, imageType, prompt, hasDualCharacter } = opts;
  const flags = { ...DEFAULT_DIAGNOSTIC_FLAGS, ...opts.diagnosticFlags };
  const bodyShape = opts.bodyShapeLoRA ?? 'auto';
  const isFullBody = imageType === 'fullBody';
  const isCloseUp = /\b(close-up|closeup|detail|portrait|face)\b/i.test(prompt);
  const isIntimate = /\b(naked|nude|sex|penetrat|straddle|undress|topless)\b/i.test(prompt);
  const isOiled = /\b(oil(?:ed)?|glistening.skin|shiny.skin|slick.skin|oily)\b/i.test(prompt);
  const isSweaty = /\b(sweat(?:y|ing)?|perspir|gym|workout|post-workout|athletic)\b/i.test(prompt);
  const isFemale = gender === 'female';
  const hasFemaleCharacter = isFemale || secondaryGender === 'female';

  const isKissing = /\b(kiss|kissing|kisses|french.kiss|lips.meet|lips.touch)\b/i.test(prompt);
  const isWide = /\b(wide|establishing|panoram|full.body)\b/i.test(prompt);

  const loras: Array<{ filename: string; strengthModel: number; strengthClip: number }> = [];
  const pendingTriggers: string[] = [];

  // Ethnicity LoRA — loaded for Black/African characters, outside the style budget cap.
  // Placed before realism LoRA so it chains first after character identity LoRAs.
  const ethnicityLoras: Array<{ filename: string; strengthModel: number; strengthClip: number }> = [];
  if (flags.styleLoras) {
    const isAfricanEthnicity = (eth?: string) => eth && /\b(black|african)\b/i.test(eth);
    const africanLora = KONTEXT_LORA_REGISTRY.find(l => l.filename === 'african-woman-flux.safetensors');
    if (africanLora?.installed && (isAfricanEthnicity(opts.primaryEthnicity) || isAfricanEthnicity(opts.secondaryEthnicity))) {
      const strength = hasDualCharacter ? 0.5 : 0.6;
      ethnicityLoras.push({ filename: 'african-woman-flux.safetensors', strengthModel: strength, strengthClip: strength });
    }
  }

  // Slot 1: Realism LoRA — always included. Krea Dev still needs this for
  // photorealistic quality. Without it, output is blurry and degraded.
  if (flags.realismLora) {
    let realismStrength = 0.7;
    if (hasDualCharacter) realismStrength = Math.min(realismStrength, 0.7);
    loras.push({ filename: 'flux_realism_lora.safetensors', strengthModel: realismStrength, strengthClip: realismStrength });
  }

  // Slot 2: Detail/Style LoRA — style LoRA for female, detail for others
  //   • SFW female solo (non-full-body) → Fashion Editorial (luxury magazine look)
  //   • NSFW female solo → Boudoir Style (intimate/sensual atmosphere)
  //   • All other cases → Detail LoRA
  if (flags.styleLoras) {
    if (hasFemaleCharacter && isSfw && !hasDualCharacter && !isFullBody) {
      loras.push({ filename: 'flux-fashion-editorial.safetensors', strengthModel: 0.5, strengthClip: 0.5 });
      pendingTriggers.push('flux-fash');
    } else if (hasFemaleCharacter && !isSfw && !hasDualCharacter) {
      loras.push({ filename: 'boudoir-style-flux.safetensors', strengthModel: 0.6, strengthClip: 0.6 });
      pendingTriggers.push('boud01rstyle');
    } else {
      let detailStrength = 0.6;
      if (isCloseUp) detailStrength = 0.8;
      else if (isWide) detailStrength = 0.4;
      if (hasDualCharacter) detailStrength = Math.min(detailStrength, 0.5);
      loras.push({ filename: 'flux-add-details.safetensors', strengthModel: detailStrength, strengthClip: detailStrength });
    }
  }

  // Slot 3: Skin texture LoRA — situational, mutually exclusive
  //   Priority: oiled > sweaty > beauty skin (close-up female)
  if (flags.styleLoras) {
    if (isOiled) {
      loras.push({ filename: 'flux-oiled-skin.safetensors', strengthModel: 0.7, strengthClip: 0.7 });
    } else if (isSweaty) {
      loras.push({ filename: 'flux-sweat-v2.safetensors', strengthModel: 0.6, strengthClip: 0.6 });
    } else if (isCloseUp && hasFemaleCharacter) {
      loras.push({ filename: 'flux-beauty-skin.safetensors', strengthModel: 0.3, strengthClip: 0.3 });
      pendingTriggers.push('mdlnbaytskn');
    }
  }

  // Slot 4: Body shape LoRA — single slot, female characters only
  //   Configurable: 'hourglass' (wide hips, thick thighs) or 'bodylicious' (exaggerated curves)
  //   'auto' defaults to bodylicious for its stronger curve reinforcement
  if (flags.bodyShapeLora && hasFemaleCharacter) {
    const isSecondaryOnly = !isFemale && secondaryGender === 'female';
    const secondaryReduction = isSecondaryOnly ? 0.85 : 1.0;

    const useHourglass = bodyShape === 'hourglass';
    if (useHourglass) {
      let strength = (opts.bodyShapeStrength ?? 0.9) * secondaryReduction;
      if (isCloseUp) strength = 0.5 * secondaryReduction; // less body emphasis for close-ups
      loras.push({ filename: 'hourglassv32_FLUX.safetensors', strengthModel: Math.round(strength * 100) / 100, strengthClip: Math.round(strength * 100) / 100 });
    } else {
      // bodylicious or auto
      let strength = (opts.bodyShapeStrength ?? 0.8) * secondaryReduction;
      if (isFullBody) strength = 0.95 * secondaryReduction;
      if (isCloseUp) strength = 0.5 * secondaryReduction;
      // Prompt-based full-body boost for single-character scenes only
      const isPromptFullBody = /\b(full[- ]body|full[- ]length)\b/i.test(prompt);
      if (isPromptFullBody && !hasDualCharacter) strength = Math.min(strength + 0.15, 1.0);
      loras.push({ filename: 'bodylicious-flux.safetensors', strengthModel: Math.round(strength * 100) / 100, strengthClip: Math.round(strength * 100) / 100 });
      pendingTriggers.push('voluptuous figure', 'wide hips', 'huge round ass', 'thick thighs', 'narrow waist');
    }
  }

  // Slot 5: Kissing LoRA — dual-character kissing scenes
  if (flags.styleLoras && hasDualCharacter && isKissing) {
    let kissStrength = 0.7;
    if (isCloseUp) kissStrength = 0.85;
    loras.push({ filename: 'flux-two-people-kissing.safetensors', strengthModel: kissStrength, strengthClip: kissStrength });
  }

  // Slot 5/6: Anatomy/NSFW LoRA — intimate scenes only
  if (flags.styleLoras && !isSfw && isIntimate) {
    let nsfwStrength = 0.7;
    if (hasDualCharacter) nsfwStrength = 0.6;
    loras.push({ filename: 'flux_lustly-ai_v1.safetensors', strengthModel: nsfwStrength, strengthClip: nsfwStrength });
  }

  // RefControl Kontext pose LoRA — optional, for identity+pose transfer
  if (opts.hasRefControlPose && loras.length < 6) {
    loras.push({ filename: 'refcontrol_pose.safetensors', strengthModel: 0.9, strengthClip: 0.9 });
    pendingTriggers.push('refcontrolpose');
  }

  // Slot 7: Cinematic Finisher — interior/night mood OR clothing/fabric sharpness
  //   Skip for close-up (would distort skin pores) and wide/establishing shots.
  if (flags.styleLoras) {
    const isInteriorOrNight = /\b(night|evening|dusk|candlelight|amber|interior|bedroom|restaurant|bar|club|kitchen|lounge|workshop|office|low.light|dim)\b/i.test(prompt);
    const hasClothing = /\b(dress|top|blouse|shirt|blazer|jeans|skirt|fabric|african.print|shweshwe|lace|silk|denim|cloth|outfit|wearing|dressed)\b/i.test(prompt);
    if (!isCloseUp && !isWide && (isInteriorOrNight || hasClothing)) {
      const cinematicStrength = hasDualCharacter ? 0.4 : 0.5;
      loras.push({ filename: 'flux-cinematic-finisher.safetensors', strengthModel: cinematicStrength, strengthClip: cinematicStrength });
      pendingTriggers.push('realism_cinema');
    }
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

  return { loras: [...ethnicityLoras, ...loras], triggerWords };
}

