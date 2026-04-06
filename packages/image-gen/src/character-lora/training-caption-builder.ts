/**
 * Training Caption Builder for SDXL Character LoRAs.
 *
 * IMPORTANT: Read docs/skills/sdxl-character-lora-training/SKILL.md before modifying this file.
 *
 * Prepares natural language captions for LoRA training by:
 * 1. Auto-tagging images via Claude Vision (natural language description)
 * 2. Removing identity phrases (hair, skin, eyes, body, ethnicity)
 * 3. Prepending the trigger word
 *
 * Caption format: {trigger_word}, a young woman smiling, fitted blazer, warm office lighting
 * Identity phrases are stripped so the LoRA learns them from images, not text.
 */

export interface CharacterIdentity {
  name: string;
  triggerWord: string;
  hairColor: string;
  hairStyle: string;
  eyeColor: string;
  skinTone: string;
  bodyType: string;
  ethnicity: string;
}

/**
 * Default identity tags that should ALWAYS be removed from training captions
 * regardless of character specifics. These are generic descriptors that the
 * LoRA should learn from images, not text.
 */
const UNIVERSAL_IDENTITY_TAGS = [
  // Skin tone variants
  'dark skin', 'dark-skinned female', 'dark-skinned male',
  'light skin', 'pale skin', 'tan', 'tanned',
  'medium skin',
  // Body shape generics
  'curvy', 'voluptuous', 'slim', 'athletic', 'petite', 'muscular',
  'wide hips', 'thick thighs', 'large breasts', 'small breasts',
  'defined waist', 'hourglass', 'pear-shaped',
  'big ass', 'round ass', 'flat chest',
  // Ethnicity
  'african', 'black', 'asian', 'caucasian', 'latina', 'mixed',
  'south african',
  // Generic face descriptors
  'oval face', 'round face', 'heart-shaped face',
  'high cheekbones', 'strong jawline', 'soft features',
  'beautiful', 'gorgeous', 'stunning', 'pretty', 'attractive',
];

/**
 * Build character-specific identity tags to remove from training captions.
 * These are derived from the character's stored data — hair color, eye color,
 * skin tone, body type, and ethnicity.
 */
function getIdentityTagsToRemove(character: {
  hairColor: string;
  hairStyle: string;
  eyeColor: string;
  skinTone: string;
  bodyType: string;
  ethnicity: string;
}): string[] {
  const tags: string[] = [];

  // Hair variations
  if (character.hairColor) {
    tags.push(`${character.hairColor.toLowerCase()} hair`);
  }
  if (character.hairStyle) {
    tags.push(character.hairStyle.toLowerCase());
  }

  // Eye color
  if (character.eyeColor) {
    tags.push(`${character.eyeColor.toLowerCase()} eyes`);
  }

  // Skin tone
  if (character.skinTone) {
    tags.push(character.skinTone.toLowerCase());
    tags.push(`${character.skinTone.toLowerCase()} skin`);
  }

  // Body type descriptors
  if (character.bodyType) {
    const bodyWords = character.bodyType.toLowerCase().split(/[\s,]+/);
    tags.push(...bodyWords.filter(w => w.length > 2));
  }

  // Ethnicity
  if (character.ethnicity) {
    tags.push(character.ethnicity.toLowerCase());
  }

  return tags;
}

/**
 * Process a raw caption for LoRA training.
 *
 * @param rawTags - Comma-separated descriptive tags from Claude Vision
 * @param character - Character identity data
 * @param imageQualityTier - 'best' | 'good' | 'acceptable' (unused — retained for API compat)
 * @returns Processed caption string ready for training: "{trigger}, scene description..."
 */
export function buildTrainingCaption(
  rawTags: string,
  character: CharacterIdentity,
  imageQualityTier: 'best' | 'good' | 'acceptable' = 'good'
): string {
  // Parse tags
  let tags = rawTags
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length > 0);

  // Get character-specific identity tags to remove
  const characterIdentityTags = getIdentityTagsToRemove({
    hairColor: character.hairColor,
    hairStyle: character.hairStyle,
    eyeColor: character.eyeColor,
    skinTone: character.skinTone,
    bodyType: character.bodyType,
    ethnicity: character.ethnicity,
  });

  // Combine with universal identity tags
  const allIdentityTags = [
    ...UNIVERSAL_IDENTITY_TAGS,
    ...characterIdentityTags,
  ].map(t => t.toLowerCase());

  // Remove identity tags
  tags = tags.filter(tag => {
    return !allIdentityTags.some(identity =>
      tag === identity || tag.includes(identity)
    );
  });

  // Remove any existing trigger words or character names
  tags = tags.filter(tag =>
    tag !== character.triggerWord.toLowerCase() &&
    !tag.includes(character.name.toLowerCase())
  );

  // Build final caption
  const parts: string[] = [character.triggerWord];

  // Score tags removed — Pony-specific quality tags are not used with Juggernaut Ragnarok.
  // Quality is controlled at inference time, not in training captions.

  parts.push(...tags);

  return parts.join(', ');
}

/**
 * Validate a set of training captions before submitting to the trainer.
 * Returns warnings for common mistakes.
 */
export function validateTrainingCaptions(
  captions: Array<{ filename: string; caption: string }>,
  character: CharacterIdentity
): string[] {
  const warnings: string[] = [];

  for (const { filename, caption } of captions) {
    // Check trigger word is present
    if (!caption.startsWith(character.triggerWord)) {
      warnings.push(`${filename}: Caption does not start with trigger word "${character.triggerWord}"`);
    }

    // Check for leaked identity tags
    const lowerCaption = caption.toLowerCase();
    const leakedTags = UNIVERSAL_IDENTITY_TAGS.filter(tag =>
      lowerCaption.includes(tag.toLowerCase())
    );
    if (leakedTags.length > 0) {
      warnings.push(`${filename}: Identity tags still present: ${leakedTags.join(', ')}`);
    }

    // Check caption isn't too short (might not have enough context)
    const tagCount = caption.split(',').length;
    if (tagCount < 4) {
      warnings.push(`${filename}: Caption has only ${tagCount} tags — may be too sparse`);
    }

    // Check caption isn't too long (might overwhelm the trigger word)
    if (tagCount > 25) {
      warnings.push(`${filename}: Caption has ${tagCount} tags — consider trimming to essential tags`);
    }
  }

  return warnings;
}
