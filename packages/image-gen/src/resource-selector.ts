import type { SceneClassification } from './scene-classifier';
import { LORA_REGISTRY } from './lora-registry';
import type { CharacterLoraEntry } from './lora-registry';

export interface SelectedLora {
  filename: string;
  strengthModel: number;
  strengthClip: number;
  triggerWord?: string;
}

export interface ResourceSelection {
  loras: SelectedLora[];
  negativePromptAdditions: string;
  paramOverrides?: {
    steps?: number;
    cfg?: number;
    denoise?: number;
    hiresFixEnabled?: boolean;
  };
  /** URLs for character LoRAs that RunPod workers need to download at runtime */
  characterLoraDownloads?: Array<{ filename: string; url: string }>;
}

// Priority order for LoRA selection when capping at 6
const PRIORITY_ORDER = ['detail', 'skin', 'eyes', 'bodies', 'cinematic', 'melanin', 'lighting', 'hands'] as const;

function getLoraFromRegistry(filename: string): SelectedLora | null {
  const entry = LORA_REGISTRY.find((l) => l.filename === filename && l.installed);
  if (!entry) return null;
  return {
    filename: entry.filename,
    strengthModel: entry.defaultStrength,
    strengthClip: entry.clipStrength,
    triggerWord: entry.triggerWord,
  };
}

/**
 * Build context-aware negative prompt terms based on the scene prompt and
 * classification. Targets the most common failure modes: unprompted accessories,
 * wrong person count, and ethnicity drift on African characters.
 */
function buildContextualNegatives(
  classification: SceneClassification,
  promptHint?: string,
): string[] {
  const negatives: string[] = [];

  // 1. Unprompted head accessories — the model loves adding headbands/wraps
  //    Only negate if the scene prompt doesn't explicitly request them
  if (promptHint && !/\b(?:headband|headwrap|head wrap|bandana|doek|turban|head scarf|headscarf)\b/i.test(promptHint)) {
    negatives.push('headband, headwrap, bandana, hair accessory on forehead');
  }

  // 2. Person count enforcement
  if (classification.characterCount === 1) {
    negatives.push('(two people, second person, couple, extra person:1.3)');
  } else if (classification.characterCount === 2) {
    negatives.push('(three people, crowd, group, third person:1.4)');
  }

  // 3. Ethnicity preservation for African/Black characters
  if (promptHint && /\b(?:African|Black South African|Zulu|Xhosa|Ndebele|Sotho|Tswana|Venda|Tsonga|dark.?skin|medium.?brown skin|deep brown skin|rich brown skin)\b/i.test(promptHint)) {
    negatives.push('(asian features, european features, light skin, pale skin, white skin:1.2)');
  }

  return negatives;
}

export function selectResources(
  classification: SceneClassification,
  characterLora?: CharacterLoraEntry | null,
  secondaryCharacterLora?: CharacterLoraEntry | null,
  /** Final prompt text — used to detect female subjects for negative prompt tuning */
  promptHint?: string,
): ResourceSelection {
  const candidates: Array<{ priority: number; lora: SelectedLora }> = [];
  const negativeAdditions: string[] = [];
  const characterLoraDownloads: Array<{ filename: string; url: string }> = [];

  // 1. Always include detail-tweaker-xl
  const detailLora = getLoraFromRegistry('detail-tweaker-xl.safetensors');
  if (detailLora) {
    candidates.push({ priority: 0, lora: detailLora });
  }

  // 1.5. Character LoRA — identity-critical, must never be bumped
  if (characterLora) {
    candidates.push({
      priority: 1.5,
      lora: {
        filename: characterLora.filename,
        strengthModel: characterLora.defaultStrength,
        strengthClip: characterLora.clipStrength,
        triggerWord: characterLora.triggerWord,
      },
    });
    characterLoraDownloads.push({
      filename: characterLora.filename,
      url: characterLora.storageUrl,
    });
  }

  // 1.6. Secondary character LoRA — same priority tier as primary
  if (secondaryCharacterLora) {
    candidates.push({
      priority: 1.6,
      lora: {
        filename: secondaryCharacterLora.filename,
        strengthModel: secondaryCharacterLora.defaultStrength,
        strengthClip: secondaryCharacterLora.clipStrength,
        triggerWord: secondaryCharacterLora.triggerWord,
      },
    });
    characterLoraDownloads.push({
      filename: secondaryCharacterLora.filename,
      url: secondaryCharacterLora.storageUrl,
    });
  }

  // 2. If needsSkinDetail: add realistic-skin-xl
  if (classification.needsSkinDetail) {
    const skinLora = getLoraFromRegistry('realistic-skin-xl.safetensors');
    if (skinLora) {
      candidates.push({ priority: 1, lora: skinLora });
    }
  }

  // 3. If needsEyeDetail: add eyes-detail-xl
  if (classification.needsEyeDetail) {
    const eyesLora = getLoraFromRegistry('eyes-detail-xl.safetensors');
    if (eyesLora) {
      candidates.push({ priority: 2, lora: eyesLora });
    }
  }

  // 4. If hasHandsVisible: add negative-hands-v2
  if (classification.hasHandsVisible) {
    const handsLora = getLoraFromRegistry('negative-hands-v2.safetensors');
    if (handsLora) {
      candidates.push({ priority: 5, lora: handsLora });
    }
    negativeAdditions.push('bad hands, extra fingers, missing fingers, fused fingers, mutated hands');
  }

  // 5. If contentLevel === 'nsfw': add better-bodies-xl
  if (classification.contentLevel === 'nsfw') {
    const bodiesLora = getLoraFromRegistry('better-bodies-xl.safetensors');
    if (bodiesLora) {
      candidates.push({ priority: 3, lora: bodiesLora });
    }
    negativeAdditions.push('bad anatomy, distorted proportions');
  }

  // 5b. If female character present, body visible, or NSFW: add curvy-body-sdxl
  if (classification.hasFemaleCharacter || classification.needsSkinDetail || classification.contentLevel === 'nsfw') {
    const curvyLora = getLoraFromRegistry('curvy-body-sdxl.safetensors');
    if (curvyLora) {
      candidates.push({ priority: 3.1, lora: curvyLora });
    }
  }

  // 6. If dramatic / candlelight / golden_hour lighting: add cinematic-lighting-xl
  const cinematicMoods = ['dramatic', 'candlelight', 'golden_hour'];
  if (cinematicMoods.includes(classification.lightingMood)) {
    const lightingLora = getLoraFromRegistry('cinematic-lighting-xl.safetensors');
    if (lightingLora) {
      candidates.push({ priority: 6, lora: lightingLora });
    }
  }

  // 7. Always include cinecolor-harmonizer at low strength for cinematic warmth
  const cinecolorLora = getLoraFromRegistry('cinecolor-harmonizer.safetensors');
  if (cinecolorLora) {
    candidates.push({ priority: 4, lora: cinecolorLora });
  }

  // 8. If dark-skinned subject detected: add melanin-mix-xl for skin accuracy
  if (classification.hasDarkSkinSubject) {
    const melaninLora = getLoraFromRegistry('melanin-mix-xl.safetensors');
    if (melaninLora) {
      candidates.push({ priority: 2.5, lora: melaninLora });
    }
  }

  // 9. If scene involves character interaction (dual-character scenes): add couples-poses-xl
  if (classification.interactionType && classification.interactionType !== 'unknown') {
    const couplesLora = getLoraFromRegistry('couples-poses-xl.safetensors');
    if (couplesLora) {
      candidates.push({ priority: 3.5, lora: couplesLora });
    }
  }

  // 10. Cap at 6 LoRAs — sort by priority (lower number = higher priority) and take first 6
  candidates.sort((a, b) => a.priority - b.priority);
  const selectedLoras = candidates.slice(0, 6).map((c) => c.lora);

  // Build negative prompt additions based on classification
  if (classification.hasIntimateContent && classification.contentLevel !== 'nsfw') {
    negativeAdditions.push('explicit, graphic');
  }

  // Female figure reinforcement: push anti-patterns into the negative prompt
  // when the prompt contains female-indicating terms
  if (promptHint && /\b(?:female|woman|girl|lady|she|her)\b/i.test(promptHint)) {
    negativeAdditions.push('flat chest, small breasts, boyish figure, shapeless body, frumpy, unflattering clothing, no makeup, plain');
  }

  // Contextual negatives: unprompted accessories, person count, ethnicity drift
  negativeAdditions.push(...buildContextualNegatives(classification, promptHint));

  return {
    loras: selectedLoras,
    negativePromptAdditions: negativeAdditions.join(', '),
    paramOverrides: {
      hiresFixEnabled: true,
    },
    ...(characterLoraDownloads.length > 0 ? { characterLoraDownloads } : {}),
  };
}
