// Stage 3: Auto-Captioning for LoRA Training Dataset
// Generates tag-based captions for each dataset image.
//
// Format: "tok woman, [category framing], [scene-specific tags]"
//
// CRITICAL: Captions must NOT include permanent character features
// (skin tone, hair color, body type, ethnicity) because the LoRA
// should learn these implicitly from the images, not from captions.
// Only describe what VARIES per image: pose, angle, lighting, clothing, expression.

import type { CaptionResult, LoraDatasetImageRow, ImageCategory } from './types';
import { ALL_PROMPTS } from './dataset-prompts';

interface CaptionGeneratorDeps {
  supabase: {
    from: (table: string) => any;
  };
}

// Tags that describe permanent character features — filter these OUT
const PERMANENT_FEATURE_PATTERNS = [
  /\bskin tone\b/i, /\bskin color\b/i, /\bcomplexion\b/i,
  /\bhair color\b/i, /\beye color\b/i, /\bbody type\b/i,
  /\bslim\b/i, /\bcurvy\b/i, /\bathletic build\b/i,
  /\boval face\b/i, /\bhigh cheekbones\b/i,
  /\bthis person\b/i, /\bphotorealistic\b/i,
  /\bmasterpiece\b/i, /\bbest quality\b/i,
  /\[ethnicity\]/i, /\[bodyType\]/i, /\[skinTone\]/i,
  /\[hairStyle\]/i, /\[hairColor\]/i,
];

// Category → base framing tag
const CATEGORY_FRAMING: Record<ImageCategory, string> = {
  'face-closeup': 'close-up portrait',
  'head-shoulders': 'head and shoulders portrait',
  'waist-up': 'waist-up portrait',
  'full-body': 'full body photo',
  'body-detail': 'intimate portrait',
};

// Pattern → caption tags extraction table
const TAG_EXTRACTIONS: Array<{ pattern: RegExp; tags: string[] }> = [
  // Angles
  { pattern: /front view/i, tags: ['front view'] },
  { pattern: /3\/4 angle.*right/i, tags: ['three-quarter view', 'turned right'] },
  { pattern: /3\/4 angle.*left/i, tags: ['three-quarter view', 'turned left'] },
  { pattern: /three-quarter view/i, tags: ['three-quarter view'] },
  { pattern: /profile view/i, tags: ['profile view'] },
  { pattern: /over.*shoulder/i, tags: ['over shoulder'] },
  { pattern: /slight angle/i, tags: ['slight angle'] },

  // Expressions
  { pattern: /warm smile/i, tags: ['smiling'] },
  { pattern: /neutral expression/i, tags: ['neutral expression'] },
  { pattern: /serious.*expression/i, tags: ['serious expression'] },
  { pattern: /contemplative/i, tags: ['contemplative'] },
  { pattern: /laughing/i, tags: ['laughing'] },
  { pattern: /confident/i, tags: ['confident expression'] },
  { pattern: /vulnerable/i, tags: ['vulnerable expression'] },
  { pattern: /joyful/i, tags: ['joyful expression'] },
  { pattern: /pensive/i, tags: ['pensive expression'] },
  { pattern: /serene/i, tags: ['serene expression'] },
  { pattern: /sensual/i, tags: ['sensual expression'] },
  { pattern: /smirk/i, tags: ['subtle smirk'] },
  { pattern: /composed/i, tags: ['composed expression'] },
  { pattern: /relaxed smile/i, tags: ['relaxed smile'] },
  { pattern: /genuine smile/i, tags: ['genuine smile'] },

  // Gaze
  { pattern: /direct eye contact/i, tags: ['direct eye contact'] },
  { pattern: /eyes.*downcast/i, tags: ['gaze downward'] },
  { pattern: /looking.*camera/i, tags: ['looking at camera'] },

  // Lighting
  { pattern: /studio lighting/i, tags: ['studio lighting'] },
  { pattern: /golden hour/i, tags: ['golden hour lighting'] },
  { pattern: /dramatic.*lighting/i, tags: ['dramatic lighting'] },
  { pattern: /shadow lighting/i, tags: ['shadow lighting'] },
  { pattern: /natural daylight/i, tags: ['natural daylight'] },
  { pattern: /window light/i, tags: ['window light'] },
  { pattern: /warm.*lighting/i, tags: ['warm lighting'] },
  { pattern: /backlit/i, tags: ['backlit'] },
  { pattern: /rim lighting/i, tags: ['rim lighting'] },
  { pattern: /ambient light/i, tags: ['ambient light'] },
  { pattern: /side lighting/i, tags: ['side lighting'] },
  { pattern: /bright.*lighting/i, tags: ['bright lighting'] },
  { pattern: /amber light/i, tags: ['amber light'] },
  { pattern: /diffused light/i, tags: ['diffused light'] },
  { pattern: /bedroom lighting/i, tags: ['warm bedroom lighting'] },
  { pattern: /gym lighting/i, tags: ['bright gym lighting'] },
  { pattern: /office lighting/i, tags: ['soft office lighting'] },

  // Background / Setting
  { pattern: /clean background/i, tags: ['clean background'] },
  { pattern: /dark background/i, tags: ['dark background'] },
  { pattern: /white background/i, tags: ['white background'] },
  { pattern: /simple background/i, tags: ['simple background'] },
  { pattern: /neutral background/i, tags: ['neutral background'] },
  { pattern: /outdoor/i, tags: ['outdoor'] },
  { pattern: /indoor/i, tags: ['indoor'] },

  // Clothing (variable per image)
  { pattern: /blazer/i, tags: ['wearing blazer'] },
  { pattern: /fitted top/i, tags: ['fitted top'] },
  { pattern: /off-shoulder/i, tags: ['off-shoulder top'] },
  { pattern: /African print/i, tags: ['African print top'] },
  { pattern: /white blouse/i, tags: ['white blouse'] },
  { pattern: /gold jewelry/i, tags: ['gold jewelry'] },
  { pattern: /tank top/i, tags: ['tank top'] },
  { pattern: /wrap dress/i, tags: ['wrap dress'] },
  { pattern: /jeans/i, tags: ['jeans'] },
  { pattern: /t-shirt/i, tags: ['t-shirt'] },
  { pattern: /blouse/i, tags: ['blouse'] },
  { pattern: /evening dress/i, tags: ['evening dress'] },
  { pattern: /crop top/i, tags: ['crop top'] },
  { pattern: /bodycon dress/i, tags: ['bodycon dress'] },
  { pattern: /sports bra/i, tags: ['sports bra'] },
  { pattern: /workout/i, tags: ['workout attire'] },
  { pattern: /summer dress/i, tags: ['summer dress'] },
  { pattern: /lingerie/i, tags: ['lingerie'] },
  { pattern: /silk robe/i, tags: ['silk robe'] },
  { pattern: /button-up/i, tags: ['button-up shirt'] },

  // Pose
  { pattern: /standing pose/i, tags: ['standing'] },
  { pattern: /seated/i, tags: ['seated'] },
  { pattern: /walking pose/i, tags: ['walking'] },
  { pattern: /athletic pose/i, tags: ['athletic pose'] },
  { pattern: /confident.*stance/i, tags: ['confident stance'] },
  { pattern: /doorway/i, tags: ['standing in doorway'] },
];

/**
 * Generate captions for all passed dataset images.
 */
export async function generateCaptions(
  passedImages: LoraDatasetImageRow[],
  gender: string,
  deps: CaptionGeneratorDeps,
): Promise<CaptionResult> {
  const genderTag = gender.toLowerCase() === 'male' ? 'man' : 'woman';

  console.log(`[LoRA Caption] Generating captions for ${passedImages.length} images...`);

  const captionedImages: CaptionResult['captionedImages'] = [];

  for (const image of passedImages) {
    const caption = buildCaption(image, genderTag);

    await deps.supabase
      .from('lora_dataset_images')
      .update({ caption })
      .eq('id', image.id);

    captionedImages.push({
      imageUrl: image.image_url,
      caption,
      storagePath: image.storage_path,
    });

    console.log(`[LoRA Caption] ${image.prompt_template}: ${caption}`);
  }

  console.log(`[LoRA Caption] Captioned ${captionedImages.length} images`);

  return {
    totalCaptioned: captionedImages.length,
    captionedImages,
  };
}

/**
 * Build a caption from a dataset image record.
 * Format: "tok woman, [category framing], [scene-specific tags]"
 */
function buildCaption(image: LoraDatasetImageRow, genderTag: string): string {
  const baseId = image.prompt_template.replace(/_replacement$/, '');
  const template = ALL_PROMPTS.find((p) => p.id === baseId);

  if (!template) {
    const category = (image.category || 'face-closeup') as ImageCategory;
    const framing = CATEGORY_FRAMING[category] || 'portrait';
    return `tok ${genderTag}, ${framing}`;
  }

  const tags: string[] = [`tok ${genderTag}`];

  // Add category framing tag
  const framing = CATEGORY_FRAMING[template.category];
  if (framing) tags.push(framing);

  // Extract scene-specific tags from the prompt
  const promptText = template.prompt;
  for (const extraction of TAG_EXTRACTIONS) {
    if (extraction.pattern.test(promptText)) {
      for (const tag of extraction.tags) {
        if (!tags.includes(tag)) {
          tags.push(tag);
        }
      }
    }
  }

  // Filter out any permanent feature tags
  const filteredTags = tags.filter(
    (tag) => !PERMANENT_FEATURE_PATTERNS.some((p) => p.test(tag))
  );

  return filteredTags.join(', ');
}
