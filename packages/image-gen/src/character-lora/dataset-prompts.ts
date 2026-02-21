// Dataset Prompt Templates for Hybrid LoRA Training Pipeline
//
// SPLIT:
//   Nano Banana Pro (14-18 images) — face close-ups + head-and-shoulders (SFW only)
//   ComfyUI/RunPod (10-14 images) — waist-up, full body, body detail (no restrictions)
//
// Nano Banana prompts are simple and SFW — no body-specific terms.
// ComfyUI prompts use [placeholder] tokens interpolated with character structured data.

import type { ImageSource, ImageCategory, VariationType } from './types';

export interface DatasetPrompt {
  id: string;
  variationType: VariationType;
  source: ImageSource;
  category: ImageCategory;
  prompt: string;
  description: string;
  /** ComfyUI checkpoint override (default RealVisXL; 'lustify' for NSFW) */
  checkpoint?: 'realvis' | 'lustify';
}

// ── NANO BANANA PRO PROMPTS (SFW face/head shots) ───────────────
// These are sent with the approved portrait as a reference image.
// Nano Banana Pro excels at face consistency but content-restricts body terms.

const NANO_BANANA_PROMPTS: DatasetPrompt[] = [
  // Face close-ups (8-10)
  {
    id: 'nb_face_front_neutral',
    variationType: 'angle',
    source: 'nano-banana',
    category: 'face-closeup',
    prompt: 'Close-up portrait, front view, neutral expression, soft studio lighting, clean background',
    description: 'Front-facing close-up, neutral',
  },
  {
    id: 'nb_face_34_right_smile',
    variationType: 'angle',
    source: 'nano-banana',
    category: 'face-closeup',
    prompt: 'Close-up portrait, 3/4 angle looking slightly right, warm smile, golden hour side lighting',
    description: '3/4 right with warm smile',
  },
  {
    id: 'nb_face_over_shoulder',
    variationType: 'expression',
    source: 'nano-banana',
    category: 'face-closeup',
    prompt: 'Close-up portrait, looking over left shoulder, serious contemplative expression, dramatic shadow lighting',
    description: 'Over-shoulder contemplative',
  },
  {
    id: 'nb_face_laughing',
    variationType: 'expression',
    source: 'nano-banana',
    category: 'face-closeup',
    prompt: 'Close-up portrait, slight head tilt, laughing genuinely, bright natural daylight',
    description: 'Laughing candid',
  },
  {
    id: 'nb_face_confident',
    variationType: 'expression',
    source: 'nano-banana',
    category: 'face-closeup',
    prompt: 'Close-up portrait, direct eye contact, confident subtle smirk, warm indoor ambient light',
    description: 'Confident direct gaze',
  },
  {
    id: 'nb_face_vulnerable',
    variationType: 'expression',
    source: 'nano-banana',
    category: 'face-closeup',
    prompt: 'Close-up portrait, eyes slightly downcast, thoughtful vulnerable expression, soft window light from the side',
    description: 'Vulnerable downcast gaze',
  },
  {
    id: 'nb_face_profile',
    variationType: 'angle',
    source: 'nano-banana',
    category: 'face-closeup',
    prompt: 'Close-up portrait, profile view facing left, serene expression, backlit rim lighting',
    description: 'Left profile with rim light',
  },
  {
    id: 'nb_face_34_left_joy',
    variationType: 'angle',
    source: 'nano-banana',
    category: 'face-closeup',
    prompt: 'Close-up portrait, 3/4 angle looking slightly left, joyful bright expression, outdoor natural light',
    description: '3/4 left with joy',
  },

  // Head-and-shoulders (6-8)
  {
    id: 'nb_head_blazer',
    variationType: 'clothing',
    source: 'nano-banana',
    category: 'head-shoulders',
    prompt: 'Head and shoulders portrait, front view, wearing a professional blazer, neutral composed expression, studio lighting',
    description: 'Professional blazer',
  },
  {
    id: 'nb_head_casual',
    variationType: 'clothing',
    source: 'nano-banana',
    category: 'head-shoulders',
    prompt: 'Head and shoulders portrait, 3/4 angle, wearing a casual fitted top, relaxed smile, warm indoor lighting',
    description: 'Casual fitted top',
  },
  {
    id: 'nb_head_offshoulder',
    variationType: 'clothing',
    source: 'nano-banana',
    category: 'head-shoulders',
    prompt: 'Head and shoulders portrait, slight angle, wearing an off-shoulder top, confident expression, golden hour lighting',
    description: 'Off-shoulder confident',
  },
  {
    id: 'nb_head_african_print',
    variationType: 'clothing',
    source: 'nano-banana',
    category: 'head-shoulders',
    prompt: 'Head and shoulders portrait, front view, wearing a colorful African print top, warm genuine smile, bright daylight',
    description: 'African print top',
  },
  {
    id: 'nb_head_white_blouse',
    variationType: 'clothing',
    source: 'nano-banana',
    category: 'head-shoulders',
    prompt: 'Head and shoulders portrait, 3/4 angle looking right, wearing a simple white blouse, pensive expression, soft diffused light',
    description: 'White blouse pensive',
  },
  {
    id: 'nb_head_jewelry',
    variationType: 'clothing',
    source: 'nano-banana',
    category: 'head-shoulders',
    prompt: 'Head and shoulders portrait, facing slightly left, wearing gold jewelry and earrings, elegant composed look, warm amber light',
    description: 'Gold jewelry elegant',
  },
];

// ── COMFYUI PROMPTS (body shots — no content restrictions) ──────
// These use [placeholder] tokens that are replaced with actual character data.
// Placeholders: [ethnicity], [bodyType], [skinTone], [hairStyle], [hairColor]

const COMFYUI_PROMPTS: DatasetPrompt[] = [
  // Waist-up (5-7) — body type visible but not full length
  {
    id: 'cu_waist_tank',
    variationType: 'clothing',
    source: 'comfyui',
    category: 'waist-up',
    prompt: 'masterpiece, photorealistic, waist-up portrait, [ethnicity] woman, [bodyType], [skinTone] skin, [hairStyle] [hairColor] hair, wearing fitted tank top, natural standing pose, warm indoor lighting, clean background',
    description: 'Tank top waist-up',
    checkpoint: 'realvis',
  },
  {
    id: 'cu_waist_wrap_dress',
    variationType: 'clothing',
    source: 'comfyui',
    category: 'waist-up',
    prompt: 'masterpiece, photorealistic, waist-up portrait, [ethnicity] woman, [bodyType], [skinTone] skin, [hairStyle] [hairColor] hair, wearing wrap dress showing figure, 3/4 angle, golden hour side lighting, simple background',
    description: 'Wrap dress waist-up',
    checkpoint: 'realvis',
  },
  {
    id: 'cu_waist_jeans_tee',
    variationType: 'clothing',
    source: 'comfyui',
    category: 'waist-up',
    prompt: 'masterpiece, photorealistic, waist-up portrait, [ethnicity] woman, [bodyType], [skinTone] skin, [hairStyle] [hairColor] hair, wearing casual jeans and fitted t-shirt, relaxed pose, bright natural daylight, clean background',
    description: 'Casual jeans & tee',
    checkpoint: 'realvis',
  },
  {
    id: 'cu_waist_professional',
    variationType: 'clothing',
    source: 'comfyui',
    category: 'waist-up',
    prompt: 'masterpiece, photorealistic, waist-up portrait, [ethnicity] woman, [bodyType], [skinTone] skin, [hairStyle] [hairColor] hair, wearing professional blouse, seated pose, soft office lighting, neutral background',
    description: 'Professional seated',
    checkpoint: 'realvis',
  },
  {
    id: 'cu_waist_evening',
    variationType: 'clothing',
    source: 'comfyui',
    category: 'waist-up',
    prompt: 'masterpiece, photorealistic, waist-up shot, [ethnicity] woman, [bodyType], [skinTone] skin, [hairStyle] [hairColor] hair, wearing elegant evening dress, slight angle, dramatic warm lighting, dark background',
    description: 'Evening dress waist-up',
    checkpoint: 'realvis',
  },

  // Full body (4-6) — head to feet
  {
    id: 'cu_full_crop_top',
    variationType: 'framing',
    source: 'comfyui',
    category: 'full-body',
    prompt: 'masterpiece, photorealistic, full body standing pose, [ethnicity] woman, [bodyType], [skinTone] skin, [hairStyle] [hairColor] hair, wearing fitted jeans and crop top showing midriff, natural confident stance, studio lighting, clean white background, head to feet visible',
    description: 'Crop top full body',
    checkpoint: 'realvis',
  },
  {
    id: 'cu_full_bodycon',
    variationType: 'framing',
    source: 'comfyui',
    category: 'full-body',
    prompt: 'masterpiece, photorealistic, full body pose, [ethnicity] woman, [bodyType], [skinTone] skin, [hairStyle] [hairColor] hair, wearing bodycon dress highlighting curves, walking pose, warm golden light, simple background, full length',
    description: 'Bodycon dress walking',
    checkpoint: 'realvis',
  },
  {
    id: 'cu_full_workout',
    variationType: 'framing',
    source: 'comfyui',
    category: 'full-body',
    prompt: 'masterpiece, photorealistic, full body standing, [ethnicity] woman, [bodyType], [skinTone] skin, [hairStyle] [hairColor] hair, wearing workout leggings and sports bra, athletic pose, bright gym lighting, clean background',
    description: 'Workout gear athletic',
    checkpoint: 'realvis',
  },
  {
    id: 'cu_full_summer_dress',
    variationType: 'framing',
    source: 'comfyui',
    category: 'full-body',
    prompt: 'masterpiece, photorealistic, full body shot, [ethnicity] woman, [bodyType], [skinTone] skin, [hairStyle] [hairColor] hair, wearing summer dress, casual standing pose outdoors, natural daylight, simple outdoor background',
    description: 'Summer dress outdoor',
    checkpoint: 'realvis',
  },

  // Body detail / revealing (2-3, NSFW-capable checkpoint)
  {
    id: 'cu_detail_lingerie',
    variationType: 'clothing',
    source: 'comfyui',
    category: 'body-detail',
    prompt: 'masterpiece, photorealistic, waist-up, [ethnicity] woman, [bodyType], [skinTone] skin, [hairStyle] [hairColor] hair, wearing lace lingerie, confident sensual pose, warm bedroom lighting, soft background, intimate atmosphere',
    description: 'Lingerie waist-up',
    checkpoint: 'lustify',
  },
  {
    id: 'cu_detail_silk_robe',
    variationType: 'clothing',
    source: 'comfyui',
    category: 'body-detail',
    prompt: 'masterpiece, photorealistic, full body, [ethnicity] woman, [bodyType], [skinTone] skin, [hairStyle] [hairColor] hair, wearing silk robe partially open, standing in doorway, dramatic side lighting, photorealistic',
    description: 'Silk robe doorway',
    checkpoint: 'lustify',
  },
];

// ── Exports ─────────────────────────────────────────────────────

export const ALL_PROMPTS: DatasetPrompt[] = [...NANO_BANANA_PROMPTS, ...COMFYUI_PROMPTS];

export function getNanoBananaPrompts(): DatasetPrompt[] {
  return NANO_BANANA_PROMPTS;
}

export function getComfyUIPrompts(): DatasetPrompt[] {
  return COMFYUI_PROMPTS;
}

// ── Gender Adaptation ───────────────────────────────────────────

const FEMALE_TO_MALE_SWAPS: Array<[RegExp, string]> = [
  // Nano Banana clothing swaps
  [/wearing a professional blazer/g, 'wearing a tailored button-up shirt'],
  [/wearing a casual fitted top/g, 'wearing a casual polo shirt'],
  [/wearing an off-shoulder top/g, 'wearing a fitted henley'],
  [/wearing gold jewelry and earrings/g, 'wearing a simple watch'],
  [/elegant composed look/g, 'confident composed look'],
  [/wearing a simple white blouse/g, 'wearing a crisp white shirt'],
  // ComfyUI body prompts — swap gendered terms
  [/\bwoman\b/g, 'man'],
  [/wearing fitted tank top/g, 'wearing fitted tank top'],
  [/wearing wrap dress showing figure/g, 'wearing fitted button-down shirt'],
  [/wearing fitted jeans and crop top showing midriff/g, 'wearing fitted jeans and white t-shirt'],
  [/wearing bodycon dress highlighting curves/g, 'wearing tailored chinos and fitted shirt'],
  [/wearing workout leggings and sports bra/g, 'wearing workout shorts and compression shirt'],
  [/wearing summer dress/g, 'wearing chinos and short-sleeve shirt'],
  [/wearing lace lingerie/g, 'wearing fitted boxer briefs'],
  [/wearing silk robe partially open/g, 'wearing cotton robe loosely tied'],
  [/wearing elegant evening dress/g, 'wearing fitted dark suit with open collar'],
  [/wearing professional blouse/g, 'wearing professional button-up shirt'],
];

export function adaptPromptForGender(prompt: string, gender: string): string {
  if (gender.toLowerCase() !== 'male') return prompt;

  let adapted = prompt;
  for (const [pattern, replacement] of FEMALE_TO_MALE_SWAPS) {
    adapted = adapted.replace(pattern, replacement);
  }
  return adapted;
}

// ── ComfyUI Prompt Interpolation ────────────────────────────────

export function interpolateComfyUIPrompt(
  template: string,
  data: { ethnicity: string; bodyType: string; skinTone: string; hairStyle: string; hairColor: string },
): string {
  return template
    .replace(/\[ethnicity\]/g, data.ethnicity)
    .replace(/\[bodyType\]/g, data.bodyType)
    .replace(/\[skinTone\]/g, data.skinTone)
    .replace(/\[hairStyle\]/g, data.hairStyle)
    .replace(/\[hairColor\]/g, data.hairColor);
}

// Keep legacy export for backward compatibility with test-pipeline
export const DATASET_PROMPTS = ALL_PROMPTS;
