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
    name: 'NSW Curves Body LoRA',
    filename: 'nsw-curves-body.safetensors',
    category: 'bodies',
    defaultStrength: 0.8,
    clipStrength: 0.8,
    triggerWord: 'nsw_curves',
    description: 'Custom-trained body proportions LoRA — curvaceous figure, large breasts, wide hips, thick thighs, hourglass body (191 training images, Flux Dev)',
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
  const isFullBody = imageType === 'fullBody';
  const isCloseUp = /\b(close-up|closeup|detail|portrait|face)\b/i.test(prompt);
  const isWide = /\b(wide|establishing|panoram|full.body)\b/i.test(prompt);
  const isKissing = /\b(kiss|kissing|kisses|french.kiss|lips.meet|lips.touch)\b/i.test(prompt);
  const isIntimate = /\b(naked|nude|sex|intimate|penetrat|straddle|undress|topless)\b/i.test(prompt);
  const isOiled = /\b(oil(?:ed)?|glistening.skin|shiny.skin|slick.skin|oily)\b/i.test(prompt);
  const isSweaty = /\b(sweat(?:y|ing)?|perspir|gym|workout|post-workout|athletic)\b/i.test(prompt);
  const isFemale = gender === 'female';
  // Include female body LoRAs if either character is female
  const hasFemaleCharacter = isFemale || secondaryGender === 'female';

  const loras: Array<{ filename: string; strengthModel: number; strengthClip: number }> = [];
  const pendingTriggers: string[] = [];

  // 1. Realism LoRA — always included. Reduced for NSFW to give body LoRAs
  //    more room in the model's attention budget.
  let realismStrength = 0.7;
  if (hasDualCharacter) realismStrength = Math.min(realismStrength, 0.7);
  loras.push({ filename: 'flux_realism_lora.safetensors', strengthModel: realismStrength, strengthClip: realismStrength });

  // 2. Style/Detail LoRA — slot 2 swaps to a style LoRA for female characters:
  //    • SFW female solo     → Fashion Editorial (luxury magazine look)
  //    • NSFW female solo    → Boudoir Style (intimate/sensual atmosphere)
  //    • All other cases     → Detail LoRA
  if (hasFemaleCharacter && isSfw && !hasDualCharacter && !isFullBody) {
    // Fashion editorial on portrait/close-up — but NOT full body. The editorial
    // LoRA is trained on slim high-fashion models and fights curvy body LoRAs
    // when the full figure is visible. Use detail LoRA for full body instead.
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

  // 3. Body LoRAs — included when ANY character is female
  // NSW Curves is our custom-trained body LoRA that combines what perfect-busts
  // and hourglass did separately. It takes one LoRA slot instead of two.
  // For dual scenes with a male primary + female secondary, we still want body
  // enhancement for the female character (at slightly reduced strength).
  if (hasFemaleCharacter) {
    const isSecondaryOnly = !isFemale && secondaryGender === 'female';
    const secondaryReduction = isSecondaryOnly ? 0.7 : 1.0; // 30% reduction when female is only secondary

    // NSW Curves body LoRA — custom-trained on curvaceous body proportions.
    // Replaces both perfect-busts + hourglass in a single slot.
    let curvesStrength = 0.7 * secondaryReduction;
    if (isFullBody) curvesStrength = 0.95 * secondaryReduction;
    loras.push({ filename: 'nsw-curves-body.safetensors', strengthModel: Math.round(curvesStrength * 100) / 100, strengthClip: Math.round(curvesStrength * 100) / 100 });
    pendingTriggers.push('nsw_curves');

    // Keep perfect-busts as a complementary LoRA at reduced strength
    let bustsStrength = 0.5 * secondaryReduction;
    if (isFullBody) bustsStrength = 0.6 * secondaryReduction;
    loras.push({ filename: 'fc-flux-perfect-busts.safetensors', strengthModel: Math.round(bustsStrength * 100) / 100, strengthClip: Math.round(bustsStrength * 100) / 100 });
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

  // 6. Skin effect LoRA — situational, mutually exclusive, only if a slot is free
  //    Priority: oiled > sweaty > beauty skin (close-up female)
  //    These are installed: false until downloaded, but selection logic is always active
  if (loras.length < 6) {
    if (isOiled) {
      loras.push({ filename: 'flux-oiled-skin.safetensors', strengthModel: 0.7, strengthClip: 0.7 });
    } else if (isSweaty) {
      loras.push({ filename: 'flux-sweat-v2.safetensors', strengthModel: 0.6, strengthClip: 0.6 });
    } else if (isCloseUp && hasFemaleCharacter) {
      loras.push({ filename: 'flux-beauty-skin.safetensors', strengthModel: 0.3, strengthClip: 0.3 });
      pendingTriggers.push('mdlnbaytskn');
    }
  }

  // Strength budget cap — scale down if total exceeds 4.0.
  // Raised from 3.5: body LoRAs (busts + hourglass) were being diluted to ~77%
  // in NSFW dual + kissing + intimate scenes, weakening body consistency.
  const MAX_TOTAL_STRENGTH = 4.0;
  const totalStrength = loras.reduce((sum, l) => sum + l.strengthModel, 0);
  if (totalStrength > MAX_TOTAL_STRENGTH) {
    const scale = MAX_TOTAL_STRENGTH / totalStrength;
    for (const l of loras) {
      l.strengthModel = Math.round(l.strengthModel * scale * 100) / 100;
      l.strengthClip = Math.round(l.strengthClip * scale * 100) / 100;
    }
  }

  // Filter out trigger words that are already present in the prompt
  const triggerWords = pendingTriggers.filter(
    (t) => !new RegExp(`\\b${t}\\b`, 'i').test(prompt)
  );

  return { loras, triggerWords };
}

