import type { SceneClassification } from './scene-classifier';
import { LORA_REGISTRY } from './lora-registry';

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

export function selectResources(classification: SceneClassification): ResourceSelection {
  const candidates: Array<{ priority: number; lora: SelectedLora }> = [];
  const negativeAdditions: string[] = [];

  // 1. Always include detail-tweaker-xl
  const detailLora = getLoraFromRegistry('detail-tweaker-xl.safetensors');
  if (detailLora) {
    candidates.push({ priority: 0, lora: detailLora });
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
      candidates.push({ priority: 5, lora: melaninLora });
    }
  }

  // 9. Cap at 6 LoRAs — sort by priority (lower number = higher priority) and take first 6
  candidates.sort((a, b) => a.priority - b.priority);
  const selectedLoras = candidates.slice(0, 6).map((c) => c.lora);

  // Build negative prompt additions based on classification
  if (classification.hasIntimateContent && classification.contentLevel !== 'nsfw') {
    negativeAdditions.push('explicit, graphic');
  }

  return {
    loras: selectedLoras,
    negativePromptAdditions: negativeAdditions.join(', '),
    paramOverrides: {
      hiresFixEnabled: true,
    },
  };
}
