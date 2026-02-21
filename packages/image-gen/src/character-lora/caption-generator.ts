// Stage 3: Auto-Captioning from Prompt Templates
// Generates tag-based captions for each dataset image.
// Captions are derived from the prompt templates (not image analysis)
// since we control the generation prompts.

import type { CaptionResult, LoraDatasetImageRow } from './types';
import { DATASET_PROMPTS } from './dataset-prompts';

interface CaptionGeneratorDeps {
  supabase: {
    from: (table: string) => any;
  };
}

// Tags that describe permanent character features — these should NOT
// appear in captions since the LoRA should learn them implicitly.
const PERMANENT_FEATURE_PATTERNS = [
  /\bskin tone\b/i,
  /\bskin color\b/i,
  /\bcomplexion\b/i,
  /\bhair color\b/i,
  /\beye color\b/i,
  /\bbody type\b/i,
  /\bslim\b/i,
  /\bcurvy\b/i,
  /\bathletic build\b/i,
  /\boval face\b/i,
  /\bhigh cheekbones\b/i,
  /\bthis person\b/i,
  /\bphotorealistic\b/i,
];

// Map prompt template keywords to concise caption tags
const TAG_EXTRACTIONS: Array<{ pattern: RegExp; tags: string[] }> = [
  // Angles
  { pattern: /front view/i, tags: ['front view'] },
  { pattern: /three-quarter view.*left/i, tags: ['three-quarter view', 'turned left'] },
  { pattern: /three-quarter view.*right/i, tags: ['three-quarter view', 'turned right'] },
  { pattern: /three-quarter view/i, tags: ['three-quarter view'] },
  { pattern: /left side profile/i, tags: ['left profile'] },
  { pattern: /right side profile/i, tags: ['right profile'] },
  { pattern: /slightly elevated angle/i, tags: ['high angle', 'looking up'] },

  // Expressions
  { pattern: /warm genuine smile showing teeth/i, tags: ['smiling', 'teeth showing', 'joyful'] },
  { pattern: /serious focused expression/i, tags: ['serious expression', 'intense'] },
  { pattern: /laughing naturally/i, tags: ['laughing', 'head tilted back'] },
  { pattern: /thoughtful contemplative/i, tags: ['contemplative', 'gaze downward'] },
  { pattern: /confident assured/i, tags: ['confident expression', 'chin raised'] },
  { pattern: /seductive half-smile/i, tags: ['seductive', 'half-smile', 'parted lips'] },
  { pattern: /neutral expression/i, tags: ['neutral expression'] },
  { pattern: /relaxed expression/i, tags: ['relaxed expression'] },
  { pattern: /gentle expression/i, tags: ['gentle expression'] },
  { pattern: /natural expression/i, tags: ['natural expression'] },
  { pattern: /pleasant.*expression/i, tags: ['pleasant expression'] },
  { pattern: /peaceful expression/i, tags: ['peaceful expression'] },
  { pattern: /warm natural expression/i, tags: ['warm expression'] },

  // Gaze
  { pattern: /facing directly at camera/i, tags: ['looking at camera'] },
  { pattern: /direct eye contact/i, tags: ['direct eye contact'] },
  { pattern: /intense eye contact/i, tags: ['intense eye contact'] },
  { pattern: /eyes looking at camera/i, tags: ['looking at camera'] },
  { pattern: /looking up at the camera/i, tags: ['looking up at camera'] },
  { pattern: /looking straight ahead/i, tags: ['looking straight ahead'] },
  { pattern: /looking at camera with slight smile/i, tags: ['looking at camera', 'slight smile'] },

  // Lighting
  { pattern: /soft even lighting/i, tags: ['soft even lighting'] },
  { pattern: /soft studio lighting/i, tags: ['soft studio lighting'] },
  { pattern: /professional lighting/i, tags: ['professional lighting'] },
  { pattern: /rim lighting/i, tags: ['rim lighting'] },
  { pattern: /warm studio lighting/i, tags: ['warm studio lighting'] },
  { pattern: /dramatic side lighting/i, tags: ['dramatic side lighting'] },
  { pattern: /natural daylight/i, tags: ['natural daylight'] },
  { pattern: /soft natural window light/i, tags: ['window light'] },
  { pattern: /golden hour light/i, tags: ['golden hour lighting'] },
  { pattern: /warm golden sunlight/i, tags: ['golden hour', 'warm sunlight'] },
  { pattern: /high-key bright even lighting/i, tags: ['high-key lighting'] },
  { pattern: /strong side lighting from the left/i, tags: ['strong side lighting', 'half face shadow'] },
  { pattern: /warm amber streetlight/i, tags: ['streetlight', 'night lighting'] },
  { pattern: /warm candlelight/i, tags: ['candlelight', 'warm ambience'] },
  { pattern: /overhead soft lighting/i, tags: ['overhead lighting'] },
  { pattern: /warm lighting/i, tags: ['warm lighting'] },
  { pattern: /bright lighting/i, tags: ['bright lighting'] },
  { pattern: /soft window light/i, tags: ['window light'] },
  { pattern: /warm interior lighting/i, tags: ['warm interior lighting'] },
  { pattern: /studio lighting/i, tags: ['studio lighting'] },
  { pattern: /natural light from window/i, tags: ['window light'] },
  { pattern: /full studio lighting/i, tags: ['studio lighting'] },
  { pattern: /even studio lighting/i, tags: ['even studio lighting'] },
  { pattern: /professional portrait lighting/i, tags: ['portrait lighting'] },

  // Framing
  { pattern: /extreme close-up/i, tags: ['extreme close-up', 'face filling frame'] },
  { pattern: /head and shoulders/i, tags: ['head and shoulders'] },
  { pattern: /waist-up/i, tags: ['waist-up'] },
  { pattern: /three-quarter body/i, tags: ['three-quarter body'] },
  { pattern: /full body/i, tags: ['full body'] },
  { pattern: /shallow depth of field/i, tags: ['shallow depth of field'] },
  { pattern: /lens flare/i, tags: ['lens flare'] },

  // Setting / Background
  { pattern: /plain studio background/i, tags: ['studio background'] },
  { pattern: /plain background/i, tags: ['plain background'] },
  { pattern: /clean background/i, tags: ['clean background'] },
  { pattern: /neutral background/i, tags: ['neutral background'] },
  { pattern: /dark background/i, tags: ['dark background'] },
  { pattern: /white background/i, tags: ['white background'] },
  { pattern: /blurred background/i, tags: ['blurred background'] },
  { pattern: /office environment blurred/i, tags: ['office background', 'blurred'] },
  { pattern: /outdoor park setting/i, tags: ['outdoor', 'park background'] },
  { pattern: /dimly lit restaurant/i, tags: ['restaurant background', 'dim lighting'] },
  { pattern: /gym or outdoor exercise/i, tags: ['gym background'] },
  { pattern: /clean background with warm tones/i, tags: ['warm toned background'] },
  { pattern: /bedroom setting/i, tags: ['bedroom setting'] },
  { pattern: /urban background/i, tags: ['urban background'] },
  { pattern: /outdoor setting/i, tags: ['outdoor'] },
  { pattern: /indoors/i, tags: ['indoors'] },
  { pattern: /outdoors/i, tags: ['outdoors'] },
  { pattern: /blurred indoor background/i, tags: ['indoor background', 'blurred'] },
  { pattern: /blurred neutral background/i, tags: ['neutral background', 'blurred'] },
  { pattern: /blurred room background/i, tags: ['room background', 'blurred'] },

  // Clothing
  { pattern: /professional business attire/i, tags: ['business attire'] },
  { pattern: /fitted blazer over a blouse/i, tags: ['blazer', 'blouse'] },
  { pattern: /tailored button-up shirt/i, tags: ['button-up shirt'] },
  { pattern: /small gold earrings/i, tags: ['gold earrings'] },
  { pattern: /simple fitted t-shirt/i, tags: ['t-shirt', 'casual'] },
  { pattern: /elegant dress or formal top/i, tags: ['elegant dress'] },
  { pattern: /fitted dark suit/i, tags: ['dark suit'] },
  { pattern: /statement earrings/i, tags: ['statement earrings'] },
  { pattern: /sports top or tank/i, tags: ['sports top'] },
  { pattern: /athletic tank top/i, tags: ['tank top'] },
  { pattern: /traditional African print/i, tags: ['African print fabric', 'vibrant colors'] },
  { pattern: /silk camisole or sleep shirt/i, tags: ['silk camisole'] },
  { pattern: /plain t-shirt or bare chest/i, tags: ['casual sleepwear'] },
  { pattern: /hair pulled back/i, tags: ['hair pulled back'] },
  { pattern: /hair loose and natural/i, tags: ['hair loose'] },

  // Pose
  { pattern: /seated in a chair/i, tags: ['seated', 'chair'] },
  { pattern: /relaxed posture leaning.*forward/i, tags: ['leaning forward'] },
  { pattern: /hands in lap/i, tags: ['hands in lap'] },
  { pattern: /standing upright/i, tags: ['standing'] },
  { pattern: /standing naturally/i, tags: ['standing naturally'] },
  { pattern: /weight on one leg/i, tags: ['weight on one leg'] },
  { pattern: /one hand on hip/i, tags: ['hand on hip'] },
  { pattern: /arms at sides/i, tags: ['arms at sides'] },
  { pattern: /casual confident pose/i, tags: ['confident pose'] },
  { pattern: /relaxed natural pose/i, tags: ['relaxed pose'] },
  { pattern: /chin slightly raised/i, tags: ['chin raised'] },
  { pattern: /head tilted slightly back/i, tags: ['head tilted back'] },
  { pattern: /gaze slightly downward/i, tags: ['gaze downward'] },

  // Mood
  { pattern: /moody cinematic/i, tags: ['moody', 'cinematic'] },
  { pattern: /cultural celebration/i, tags: ['cultural celebration'] },
];

/**
 * Generate captions for all passed dataset images.
 * Captions are tag-based, derived from prompt templates.
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
    const caption = buildCaption(image.prompt_template, genderTag);

    // Update database record
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
 * Build a caption from a prompt template ID.
 * Format: "tok woman, [scene-specific tags]"
 */
function buildCaption(promptTemplateId: string, genderTag: string): string {
  // Find the original prompt text
  // Handle replacement IDs like "angle_front_replacement"
  const baseId = promptTemplateId.replace(/_replacement$/, '');
  const template = DATASET_PROMPTS.find((p) => p.id === baseId);

  if (!template) {
    // Fallback: minimal caption
    return `tok ${genderTag}, portrait photo`;
  }

  const promptText = template.prompt;
  const tags: string[] = ['tok', genderTag];

  // Add the variation type as a category tag
  tags.push(`${template.variationType} variation`);

  // Extract scene-specific tags from the prompt
  for (const extraction of TAG_EXTRACTIONS) {
    if (extraction.pattern.test(promptText)) {
      for (const tag of extraction.tags) {
        if (!tags.includes(tag)) {
          tags.push(tag);
        }
      }
    }
  }

  // Remove any permanent feature tags that might have slipped in
  const filteredTags = tags.filter(
    (tag) => !PERMANENT_FEATURE_PATTERNS.some((p) => p.test(tag))
  );

  return filteredTags.join(', ');
}
