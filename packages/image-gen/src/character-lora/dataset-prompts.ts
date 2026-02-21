// 30 Prompt Templates for LoRA Training Dataset Generation
// Organized by variation type to ensure training diversity

import type { VariationType } from './types';

export interface DatasetPrompt {
  id: string;
  variationType: VariationType;
  prompt: string;
  description: string;
}

export const DATASET_PROMPTS: DatasetPrompt[] = [
  // ── ANGLES (6 prompts) ──────────────────────────────────────
  {
    id: 'angle_front',
    variationType: 'angle',
    prompt: 'Portrait photo of this person, front view, facing directly at camera, neutral expression, plain studio background, soft even lighting, head and shoulders, photorealistic',
    description: 'Front-facing portrait, neutral',
  },
  {
    id: 'angle_three_quarter_left',
    variationType: 'angle',
    prompt: 'Portrait photo of this person, three-quarter view turned slightly to the left, natural expression, plain background, soft studio lighting, head and shoulders, photorealistic',
    description: '3/4 left turn',
  },
  {
    id: 'angle_three_quarter_right',
    variationType: 'angle',
    prompt: 'Portrait photo of this person, three-quarter view turned slightly to the right, relaxed expression, clean background, professional lighting, head and shoulders, photorealistic',
    description: '3/4 right turn',
  },
  {
    id: 'angle_profile_left',
    variationType: 'angle',
    prompt: 'Profile portrait of this person, left side profile view, looking straight ahead, clean background, rim lighting on face, head and shoulders, photorealistic',
    description: 'Left profile',
  },
  {
    id: 'angle_profile_right',
    variationType: 'angle',
    prompt: 'Profile portrait of this person, right side profile view, chin slightly raised, clean background, soft side lighting, head and shoulders, photorealistic',
    description: 'Right profile',
  },
  {
    id: 'angle_slight_above',
    variationType: 'angle',
    prompt: 'Portrait of this person from a slightly elevated angle, looking up at the camera with a gentle expression, clean background, overhead soft lighting, head and shoulders, photorealistic',
    description: 'Slight high angle looking up',
  },

  // ── EXPRESSIONS (6 prompts) ──────────────────────────────────
  {
    id: 'expr_smile',
    variationType: 'expression',
    prompt: 'Portrait photo of this person, warm genuine smile showing teeth, eyes crinkling with joy, front view, plain background, warm studio lighting, head and shoulders, photorealistic',
    description: 'Warm smile',
  },
  {
    id: 'expr_serious',
    variationType: 'expression',
    prompt: 'Portrait photo of this person, serious focused expression, intense eye contact with camera, slight furrow in brow, front view, plain background, dramatic side lighting, head and shoulders, photorealistic',
    description: 'Serious/intense',
  },
  {
    id: 'expr_laugh',
    variationType: 'expression',
    prompt: 'Candid portrait of this person laughing naturally, head tilted slightly back, genuine joy on face, three-quarter view, blurred background, natural daylight, head and shoulders, photorealistic',
    description: 'Laughing',
  },
  {
    id: 'expr_contemplative',
    variationType: 'expression',
    prompt: 'Portrait of this person with a thoughtful contemplative expression, gaze slightly downward, soft half-smile, three-quarter view, neutral background, soft natural window light, head and shoulders, photorealistic',
    description: 'Contemplative/thoughtful',
  },
  {
    id: 'expr_confident',
    variationType: 'expression',
    prompt: 'Portrait of this person with a confident assured expression, chin slightly raised, direct eye contact, subtle knowing smile, front view, clean background, professional lighting, head and shoulders, photorealistic',
    description: 'Confident',
  },
  {
    id: 'expr_seductive',
    variationType: 'expression',
    prompt: 'Portrait of this person with a seductive half-smile, slightly parted lips, heavy-lidded eyes looking at camera, three-quarter view, dark background, warm dramatic side lighting, head and shoulders, photorealistic',
    description: 'Seductive',
  },

  // ── LIGHTING (6 prompts) ─────────────────────────────────────
  {
    id: 'light_warm_indoor',
    variationType: 'lighting',
    prompt: 'Portrait of this person indoors, warm ambient interior lighting, golden hour light through window casting warm tones on face, relaxed natural expression, waist-up, photorealistic',
    description: 'Warm indoor / golden hour',
  },
  {
    id: 'light_daylight_outdoor',
    variationType: 'lighting',
    prompt: 'Portrait of this person outdoors, bright natural daylight, slight overcast for soft shadows, slight squint from sun, natural relaxed pose, waist-up, photorealistic',
    description: 'Natural daylight outdoor',
  },
  {
    id: 'light_studio_high_key',
    variationType: 'lighting',
    prompt: 'Professional studio portrait of this person, high-key bright even lighting, white background, clean and polished look, neutral pleasant expression, head and shoulders, photorealistic',
    description: 'Studio high-key',
  },
  {
    id: 'light_dramatic_side',
    variationType: 'lighting',
    prompt: 'Dramatic portrait of this person, strong side lighting from the left, half the face in deep shadow, moody cinematic atmosphere, serious expression, dark background, head and shoulders, photorealistic',
    description: 'Dramatic side lighting',
  },
  {
    id: 'light_golden_hour',
    variationType: 'lighting',
    prompt: 'Portrait of this person during golden hour, warm golden sunlight on face, lens flare, soft backlit glow, peaceful expression, outdoor setting, waist-up, photorealistic',
    description: 'Golden hour backlit',
  },
  {
    id: 'light_night_ambient',
    variationType: 'lighting',
    prompt: 'Portrait of this person at night, warm amber streetlight illumination, urban background out of focus, casual confident expression, three-quarter view, waist-up, photorealistic',
    description: 'Night ambient / streetlight',
  },

  // ── CLOTHING VARIATIONS (6 prompts) ──────────────────────────
  {
    id: 'cloth_professional',
    variationType: 'clothing',
    prompt: 'Portrait of this person wearing professional business attire, fitted blazer over a blouse, small gold earrings, polished and put-together, office environment blurred in background, warm lighting, waist-up, photorealistic',
    description: 'Professional / business',
  },
  {
    id: 'cloth_casual',
    variationType: 'clothing',
    prompt: 'Portrait of this person in casual everyday clothes, simple fitted t-shirt, minimal accessories, relaxed natural pose, outdoor park setting blurred, natural daylight, waist-up, photorealistic',
    description: 'Casual everyday',
  },
  {
    id: 'cloth_elegant_evening',
    variationType: 'clothing',
    prompt: 'Portrait of this person dressed for an evening out, elegant dress or formal top, statement earrings, subtle makeup visible, dimly lit restaurant background, warm candlelight ambience, waist-up, photorealistic',
    description: 'Elegant evening',
  },
  {
    id: 'cloth_athleisure',
    variationType: 'clothing',
    prompt: 'Portrait of this person in athletic/workout clothing, sports top or tank, hair pulled back practically, fresh-faced with minimal makeup, gym or outdoor exercise setting blurred, bright lighting, waist-up, photorealistic',
    description: 'Athletic / sporty',
  },
  {
    id: 'cloth_traditional',
    variationType: 'clothing',
    prompt: 'Portrait of this person wearing traditional African print fabric, vibrant colors and patterns, proud natural expression, clean background with warm tones, cultural celebration atmosphere, waist-up, photorealistic',
    description: 'Traditional African attire',
  },
  {
    id: 'cloth_sleepwear',
    variationType: 'clothing',
    prompt: 'Portrait of this person in comfortable sleepwear, silk camisole or sleep shirt, hair loose and natural, soft relaxed morning expression, bedroom setting with soft window light, waist-up, photorealistic',
    description: 'Sleepwear / intimate casual',
  },

  // ── FRAMING VARIATIONS (6 prompts) ───────────────────────────
  {
    id: 'frame_close_face',
    variationType: 'framing',
    prompt: 'Extreme close-up portrait of this person, face filling the frame, showing detailed skin texture, pores, natural imperfections, soft neutral expression, shallow depth of field, studio lighting, photorealistic',
    description: 'Extreme close-up face',
  },
  {
    id: 'frame_head_shoulders',
    variationType: 'framing',
    prompt: 'Head and shoulders portrait of this person, standard portrait framing, pleasant natural expression, clean background, professional portrait lighting, photorealistic',
    description: 'Standard head and shoulders',
  },
  {
    id: 'frame_waist_up',
    variationType: 'framing',
    prompt: 'Waist-up portrait of this person, casual confident pose, one hand on hip, looking at camera with slight smile, blurred indoor background, natural light from window, photorealistic',
    description: 'Waist-up with pose',
  },
  {
    id: 'frame_three_quarter_body',
    variationType: 'framing',
    prompt: 'Three-quarter body shot of this person, standing naturally, weight on one leg, relaxed confident posture, arms at sides, blurred neutral background, full studio lighting, photorealistic',
    description: 'Three-quarter body',
  },
  {
    id: 'frame_full_body',
    variationType: 'framing',
    prompt: 'Full body portrait of this person, standing upright, natural relaxed pose, arms comfortably at sides, clean simple background, even studio lighting from head to toe, photorealistic',
    description: 'Full body standing',
  },
  {
    id: 'frame_seated',
    variationType: 'framing',
    prompt: 'Portrait of this person seated in a chair, relaxed posture leaning slightly forward, hands in lap, warm natural expression, three-quarter view, blurred room background, warm interior lighting, waist-up, photorealistic',
    description: 'Seated pose',
  },
];

// ── Gender Adaptation ───────────────────────────────────────────

const MALE_CLOTHING_SWAPS: Array<[RegExp, string]> = [
  [/fitted blazer over a blouse/g, 'tailored button-up shirt'],
  [/small gold earrings, /g, ''],
  [/elegant dress or formal top, statement earrings, subtle makeup visible/g, 'fitted dark suit, open collar shirt, clean-shaven'],
  [/sports top or tank, hair pulled back practically, fresh-faced with minimal makeup/g, 'athletic tank top, short cropped hair, clean look'],
  [/silk camisole or sleep shirt/g, 'plain t-shirt or bare chest'],
  [/statement earrings/g, ''],
  [/subtle makeup visible, /g, ''],
  [/fresh-faced with minimal makeup, /g, ''],
];

/**
 * Adapt a prompt for male characters by swapping female-coded clothing/accessories.
 * Female prompts are used as-is.
 */
export function adaptPromptForGender(prompt: string, gender: string): string {
  if (gender.toLowerCase() !== 'male') return prompt;

  let adapted = prompt;
  for (const [pattern, replacement] of MALE_CLOTHING_SWAPS) {
    adapted = adapted.replace(pattern, replacement);
  }
  return adapted;
}
