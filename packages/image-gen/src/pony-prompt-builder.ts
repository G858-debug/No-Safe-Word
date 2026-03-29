/**
 * Pony V6 prompt builder for the V4 (pony_cyberreal) pipeline.
 *
 * KEY DIFFERENCE FROM FLUX:
 * - Flux uses flowing prose sentences (T5 encoder)
 * - Pony V6 uses booru-style comma-separated tags (CLIP encoder)
 * - Pony has special quality tags: score_9, score_8_up, etc.
 * - Pony has rating tags: rating_safe, rating_questionable, rating_explicit
 * - Negative prompts ARE used (unlike Flux)
 * - No emphasis weights like (word:1.3)
 */

import Anthropic from '@anthropic-ai/sdk';

// ── Quality & Rating ──

export function buildPonyQualityPrefix(mode: 'sfw' | 'nsfw'): string {
  const quality = 'score_9, score_8_up, score_7_up';
  const rating = mode === 'nsfw' ? 'rating_explicit' : 'rating_safe';
  return `${quality}, ${rating}`;
}

export function buildPonyNegativePrompt(mode: 'sfw' | 'nsfw'): string {
  const base = [
    'score_4, score_3, score_2, score_1',
    'source_pony',
    'worst quality, low quality, normal quality',
    'photorealistic, photograph, RAW photo, hyperrealistic',
    'bad anatomy, bad hands, bad feet, extra limbs, missing limbs',
    'extra fingers, fewer digits, fused fingers',
    'watermark, signature, text, username',
    'blurry, jpeg artifacts',
    'deformed, disfigured, mutation',
  ];

  if (mode === 'sfw') {
    base.push('nsfw, nude, nudity, naked, nipples, exposed breasts');
  }

  return base.join(', ');
}

// ── Character Identity Tags ──

export interface PonyCharacterData {
  gender: 'male' | 'female';
  ethnicity?: string;
  skinTone?: string;
  hairColor?: string;
  hairStyle?: string;
  eyeColor?: string;
  bodyType?: string;
  age?: string;
  distinguishingFeatures?: string;
}

export function buildPonyCharacterTags(
  charData: PonyCharacterData,
  opts?: { mode?: 'sfw' | 'nsfw' },
): string {
  const tags: string[] = [];

  // Character count tag
  tags.push(charData.gender === 'female' ? '1girl' : '1boy');

  // Skin/ethnicity
  if (charData.skinTone) tags.push(`${charData.skinTone} skin`);
  if (charData.ethnicity) {
    const eth = charData.ethnicity.toLowerCase();
    if (eth.includes('african') || eth.includes('black')) {
      tags.push('dark-skinned female', 'african');
    }
  }

  // Hair
  if (charData.hairColor) tags.push(`${charData.hairColor.toLowerCase()} hair`);
  if (charData.hairStyle) tags.push(charData.hairStyle.toLowerCase());

  // Eyes
  if (charData.eyeColor) tags.push(`${charData.eyeColor.toLowerCase()} eyes`);

  // Body type (female characters get detailed body tags for Pony)
  if (charData.gender === 'female') {
    tags.push('curvy', 'wide hips', 'large breasts', 'thick thighs', 'narrow waist');
    if (charData.bodyType) tags.push(charData.bodyType.toLowerCase());
  }

  // Age
  if (charData.age) tags.push(`${charData.age} years old`);

  // Distinguishing features
  if (charData.distinguishingFeatures) {
    tags.push(charData.distinguishingFeatures.toLowerCase());
  }

  return tags.join(', ');
}

// ── Full Prompt Assembly ──

export function buildPonyPositivePrompt(opts: {
  qualityPrefix: string;
  characterTags: string;
  secondaryCharacterTags?: string;
  sceneTags: string;
  triggerWords: string[];
  mode: 'sfw' | 'nsfw';
}): string {
  const parts: string[] = [];

  // Quality tags first (Pony convention)
  parts.push(opts.qualityPrefix);

  // Character LoRA trigger words (must appear early for strong activation)
  for (const trigger of opts.triggerWords) {
    parts.push(trigger);
  }

  // Character identity tags
  parts.push(opts.characterTags);
  if (opts.secondaryCharacterTags) {
    parts.push(opts.secondaryCharacterTags);
  }

  // Scene tags (from convertProseToBooru or pre-formatted)
  parts.push(opts.sceneTags);

  return parts.join(', ');
}

// ── Prose → Booru Tag Conversion ──

const BOORU_SYSTEM_PROMPT = `You are a booru tag specialist for Stable Diffusion XL / Pony Diffusion V6 / CyberRealistic Pony Semi-Realistic.
Convert the user's scene description into comma-separated booru-style tags.

Rules:
- Output ONLY comma-separated tags, nothing else
- Use lowercase tags with spaces (e.g., long hair, dark skin, large breasts)
- Include composition tags: close-up, medium shot, full body, from above, from below, dutch angle, shallow depth of field, etc.
- Include lighting tags: candlelight, natural lighting, studio lighting, dramatic lighting, rim lighting, warm lighting, etc.
- Include setting tags: indoor, outdoor, bedroom, restaurant, street, township, workshop, etc.
- Include pose/action tags: standing, sitting, leaning, lying down, walking, hand on hip, arms crossed, etc.
- Include expression tags: smile, smirk, half-lidded eyes, looking at viewer, looking away, parted lips, etc.
- Include clothing tags with specific garments: mini skirt, crop top, sundress, tank top, jeans, lingerie, etc.
- Preserve ALL body descriptions exactly (large breasts, wide hips, thick thighs, etc.)
- Do NOT include quality tags (score_9, masterpiece, etc.) — added separately
- Do NOT include rating tags (rating_safe, rating_explicit, etc.) — added separately
- Do NOT include character identity tags (skin color, hair color, etc.) — added separately via LoRA trigger
- Do NOT include character count tags (1girl, 1boy) — added separately

Output tags in this order:
[pose/action], [expression/gaze], [clothing], [setting details], [lighting], [composition tags]`;

/**
 * Convert a prose scene prompt to booru-style tags using Claude.
 * Returns the original prompt if conversion fails.
 */
export async function convertProseToBooru(
  prosePrompt: string,
  opts: { nsfw: boolean },
): Promise<string> {
  const trimmed = prosePrompt.trim();
  if (!trimmed) return trimmed;

  try {
    const anthropic = new Anthropic();

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: BOORU_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: trimmed }],
    });

    const tags = message.content[0].type === 'text' ? message.content[0].text.trim() : trimmed;
    return tags;
  } catch (err) {
    console.error('[PonyPromptBuilder] Booru conversion failed, using original:', err);
    return trimmed;
  }
}

// ── Dimensions ──

export function getPonyDimensions(
  orientation: 'portrait' | 'landscape' | 'square',
  hasDualCharacters: boolean,
): { width: number; height: number } {
  if (hasDualCharacters) {
    return { width: 1216, height: 832 };
  }

  switch (orientation) {
    case 'portrait':
      return { width: 832, height: 1216 };
    case 'landscape':
      return { width: 1216, height: 832 };
    case 'square':
      return { width: 1024, height: 1024 };
  }
}
