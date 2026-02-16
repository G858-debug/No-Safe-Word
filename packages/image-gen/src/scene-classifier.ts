export interface SceneClassification {
  settingType: 'indoor' | 'outdoor' | 'studio';
  lightingMood: 'dramatic' | 'soft' | 'natural' | 'neon' | 'candlelight' | 'golden_hour';
  shotType: 'close-up' | 'medium' | 'wide' | 'detail';
  contentLevel: 'sfw' | 'suggestive' | 'nsfw';
  characterCount: 0 | 1 | 2;
  hasHandsVisible: boolean;
  hasIntimateContent: boolean;
  mood: 'romantic' | 'tense' | 'passionate' | 'contemplative' | 'playful' | 'vulnerable';
  needsSkinDetail: boolean;
  needsEyeDetail: boolean;
}

export type ImageType = 'facebook_sfw' | 'website_nsfw_paired' | 'website_only' | 'portrait';

const HAND_KEYWORDS = [
  'hand', 'hands', 'finger', 'fingers', 'grip', 'gripping',
  'hold', 'holding', 'touch', 'touching', 'reaching', 'caress',
  'caressing', 'clasping', 'clutching', 'stroking',
];

const EYE_KEYWORDS = [
  'eye contact', 'gaze', 'gazing', 'looking at', 'looking directly',
  'stare', 'staring', 'eyes', 'glancing', 'glance',
];

const SKIN_KEYWORDS = [
  'skin', 'bare', 'shoulder', 'shoulders', 'collarbone',
  'chest', 'cleavage', 'neck', 'back', 'midriff', 'legs', 'thigh', 'thighs',
];

const INTIMATE_KEYWORDS = [
  'kiss', 'kissing', 'pressed against', 'embrace', 'embracing',
  'undress', 'undressing', 'naked', 'nude', 'intimate',
  'straddling', 'grinding', 'moaning', 'climax', 'orgasm',
  'penetrat', 'thrust', 'nipple', 'breast', 'erect',
];

const INDOOR_KEYWORDS = [
  'indoor', 'interior', 'room', 'bedroom', 'bathroom', 'kitchen',
  'living room', 'lounge', 'restaurant', 'bar', 'club', 'hotel',
  'apartment', 'house', 'office', 'studio', 'shower', 'bath',
  'couch', 'sofa', 'bed', 'table', 'window',
];

const OUTDOOR_KEYWORDS = [
  'outdoor', 'outside', 'street', 'beach', 'garden', 'park',
  'rooftop', 'balcony', 'pool', 'ocean', 'sea', 'mountain',
  'forest', 'city', 'urban', 'sunset', 'sunrise', 'sky',
];

const STUDIO_KEYWORDS = [
  'studio', 'backdrop', 'seamless background', 'white background',
  'black background', 'plain background',
];

const DRAMATIC_LIGHTING_KEYWORDS = [
  'dramatic', 'cinematic', 'rim light', 'chiaroscuro', 'spotlight',
  'high contrast', 'shadow', 'silhouette',
];

const SOFT_LIGHTING_KEYWORDS = [
  'soft light', 'diffused', 'gentle light', 'ambient', 'even lighting',
];

const NEON_KEYWORDS = [
  'neon', 'neon light', 'neon glow', 'rgb', 'colored light',
];

const CANDLELIGHT_KEYWORDS = [
  'candle', 'candlelight', 'candle light', 'flame', 'firelight', 'fire light',
];

const GOLDEN_HOUR_KEYWORDS = [
  'golden hour', 'golden light', 'warm sun', 'sunset light', 'sunrise light',
  'magic hour',
];

const CLOSEUP_KEYWORDS = [
  'close-up', 'closeup', 'close up', 'macro', 'face shot', 'headshot',
  'head shot', 'portrait shot', 'tight crop', 'detail shot',
];

const WIDE_KEYWORDS = [
  'wide shot', 'wide angle', 'full body', 'full-body', 'establishing shot',
  'panoramic', 'panoram', 'long shot', 'far shot',
];

const DETAIL_KEYWORDS = [
  'detail shot', 'extreme close', 'texture', 'abstract',
];

const ROMANTIC_KEYWORDS = [
  'romantic', 'tender', 'gentle', 'loving', 'affection', 'warm smile',
];

const TENSE_KEYWORDS = [
  'tense', 'tension', 'intense', 'confrontation', 'argument', 'angry',
  'frustrated', 'serious',
];

const PASSIONATE_KEYWORDS = [
  'passionate', 'desire', 'hunger', 'lustful', 'yearning', 'fervent',
  'urgent', 'heat',
];

const CONTEMPLATIVE_KEYWORDS = [
  'contemplat', 'pensive', 'thoughtful', 'reflective', 'lost in thought',
  'staring out', 'gazing out', 'solitary', 'quiet',
];

const PLAYFUL_KEYWORDS = [
  'playful', 'teasing', 'smirk', 'wink', 'mischiev', 'coy', 'flirt',
  'laugh', 'giggle', 'fun',
];

const VULNERABLE_KEYWORDS = [
  'vulnerable', 'exposed', 'raw', 'emotional', 'tear', 'crying',
  'biting lip', 'hesitant', 'shy', 'nervous',
];

function hasKeyword(prompt: string, keywords: string[]): boolean {
  return keywords.some((kw) => prompt.includes(kw));
}

function countCharacterReferences(prompt: string): 0 | 1 | 2 {
  // Look for dual-character indicators
  const dualPatterns = [
    'two people', 'two figures', 'couple', 'both',
    'him and her', 'her and him', 'man and woman', 'woman and man',
    'primary character', 'secondary character',
    'foreground.*background',
  ];

  for (const pattern of dualPatterns) {
    if (new RegExp(pattern, 'i').test(prompt)) return 2;
  }

  // Look for single-character indicators
  const singlePatterns = [
    'she ', 'he ', 'her ', 'his ', 'woman', 'man', 'girl', 'guy',
    'person', 'figure', 'portrait',
  ];

  for (const pattern of singlePatterns) {
    if (prompt.includes(pattern)) return 1;
  }

  // If there's any substantive prompt, assume at least one character
  if (prompt.length > 20) return 1;

  return 0;
}

export function classifyScene(
  prompt: string,
  imageType: ImageType,
): SceneClassification {
  const lower = prompt.toLowerCase();

  // Setting type
  let settingType: SceneClassification['settingType'] = 'indoor';
  if (hasKeyword(lower, STUDIO_KEYWORDS)) {
    settingType = 'studio';
  } else if (hasKeyword(lower, OUTDOOR_KEYWORDS)) {
    settingType = 'outdoor';
  } else if (hasKeyword(lower, INDOOR_KEYWORDS)) {
    settingType = 'indoor';
  }

  // Lighting mood
  let lightingMood: SceneClassification['lightingMood'] = 'natural';
  if (hasKeyword(lower, CANDLELIGHT_KEYWORDS)) {
    lightingMood = 'candlelight';
  } else if (hasKeyword(lower, GOLDEN_HOUR_KEYWORDS)) {
    lightingMood = 'golden_hour';
  } else if (hasKeyword(lower, NEON_KEYWORDS)) {
    lightingMood = 'neon';
  } else if (hasKeyword(lower, DRAMATIC_LIGHTING_KEYWORDS)) {
    lightingMood = 'dramatic';
  } else if (hasKeyword(lower, SOFT_LIGHTING_KEYWORDS)) {
    lightingMood = 'soft';
  }

  // Shot type
  let shotType: SceneClassification['shotType'] = 'medium';
  if (hasKeyword(lower, DETAIL_KEYWORDS)) {
    shotType = 'detail';
  } else if (hasKeyword(lower, CLOSEUP_KEYWORDS)) {
    shotType = 'close-up';
  } else if (hasKeyword(lower, WIDE_KEYWORDS)) {
    shotType = 'wide';
  }

  // Content level
  const hasIntimateContent = hasKeyword(lower, INTIMATE_KEYWORDS);
  let contentLevel: SceneClassification['contentLevel'] = 'sfw';
  if (imageType === 'website_nsfw_paired') {
    contentLevel = 'nsfw';
  } else if (hasIntimateContent) {
    contentLevel = 'suggestive';
  }

  // Character count
  const characterCount = countCharacterReferences(lower);

  // Hands visible — portraits are head-and-shoulders shots where hands may appear
  const hasHandsVisible = imageType === 'portrait' || hasKeyword(lower, HAND_KEYWORDS);

  // Mood
  let mood: SceneClassification['mood'] = 'contemplative';
  if (hasKeyword(lower, PASSIONATE_KEYWORDS)) {
    mood = 'passionate';
  } else if (hasKeyword(lower, ROMANTIC_KEYWORDS)) {
    mood = 'romantic';
  } else if (hasKeyword(lower, TENSE_KEYWORDS)) {
    mood = 'tense';
  } else if (hasKeyword(lower, PLAYFUL_KEYWORDS)) {
    mood = 'playful';
  } else if (hasKeyword(lower, VULNERABLE_KEYWORDS)) {
    mood = 'vulnerable';
  } else if (hasKeyword(lower, CONTEMPLATIVE_KEYWORDS)) {
    mood = 'contemplative';
  }

  // Needs skin detail: portraits always need it; otherwise close-up/medium shots with skin visible
  const hasSkinVisible = hasKeyword(lower, SKIN_KEYWORDS);
  const needsSkinDetail = imageType === 'portrait' || (hasSkinVisible && (shotType === 'close-up' || shotType === 'medium'));

  // Needs eye detail: gaze/eyes prominent in the prompt
  const needsEyeDetail = hasKeyword(lower, EYE_KEYWORDS);

  return {
    settingType,
    lightingMood,
    shotType,
    contentLevel,
    characterCount,
    hasHandsVisible,
    hasIntimateContent,
    mood,
    needsSkinDetail,
    needsEyeDetail,
  };
}
