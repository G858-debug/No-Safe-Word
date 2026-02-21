import type { SceneClassification, ImageType } from './scene-classifier';
import { MODEL_REGISTRY, DEFAULT_MODEL } from './model-registry';
import type { ModelEntry } from './model-registry';

export interface ModelSelectionOptions {
  /** Override to force a specific model filename */
  forceModel?: string;
  /** Prefer premium models when available */
  preferPremium?: boolean;
  /** Explicit content level override (falls back to classification.contentLevel) */
  contentLevel?: 'sfw' | 'suggestive' | 'nsfw';
}

export interface ModelSelection {
  /** The checkpoint filename to use */
  checkpointName: string;
  /** The registry entry (null if forced to an unregistered model) */
  model: ModelEntry | null;
  /** Whether a fallback occurred because the preferred model was not installed */
  fellBack: boolean;
  /** Reason for the selection (for logging) */
  reason: string;
  /** Optional parameter overrides for this model/content combination */
  paramOverrides?: { cfg?: number; steps?: number };
}

export function selectModel(
  classification: SceneClassification,
  imageType: ImageType,
  options: ModelSelectionOptions = {},
): ModelSelection {
  const defaultEntry = MODEL_REGISTRY.find((m) => m.filename === DEFAULT_MODEL) || null;

  // 1. Honor explicit override
  if (options.forceModel) {
    const entry = MODEL_REGISTRY.find((m) => m.filename === options.forceModel);
    if (entry?.installed) {
      return {
        checkpointName: options.forceModel,
        model: entry,
        fellBack: false,
        reason: `Forced model: ${entry.name}`,
      };
    }
    return {
      checkpointName: DEFAULT_MODEL,
      model: defaultEntry,
      fellBack: true,
      reason: `Forced model ${options.forceModel} not installed, falling back to default`,
    };
  }

  // 2. NSFW content prefers maximum quality model
  const contentLevel = options.contentLevel || classification.contentLevel;
  if (contentLevel === 'nsfw') {
    const maxQuality = MODEL_REGISTRY.find(
      (m) => m.installed && m.tier === 'maximum'
    );
    if (maxQuality) {
      return {
        checkpointName: maxQuality.filename,
        model: maxQuality,
        fellBack: false,
        reason: `NSFW content: using maximum quality model ${maxQuality.name}`,
        paramOverrides: { cfg: 4.0 },
      };
    }
  }

  // 3. Portrait images prefer the best installed portrait model (maximum > premium)
  if (imageType === 'portrait' || classification.shotType === 'close-up') {
    const portraitModel = MODEL_REGISTRY.find(
      (m) => m.installed && m.strengths.includes('portrait') && m.tier === 'maximum'
    ) || MODEL_REGISTRY.find(
      (m) => m.installed && m.strengths.includes('portrait') && m.tier === 'premium'
    );
    if (portraitModel) {
      return {
        checkpointName: portraitModel.filename,
        model: portraitModel,
        fellBack: false,
        reason: `Portrait/close-up: using ${portraitModel.tier} model ${portraitModel.name}`,
        paramOverrides: { cfg: 6.5, steps: 35 },
      };
    }
  }

  // 4. Maximum quality for premium preference
  if (options.preferPremium) {
    const maxQuality = MODEL_REGISTRY.find(
      (m) => m.installed && m.tier === 'maximum'
    );
    if (maxQuality) {
      return {
        checkpointName: maxQuality.filename,
        model: maxQuality,
        fellBack: false,
        reason: `Premium preference: using ${maxQuality.name}`,
      };
    }
  }

  // 5. Default
  return {
    checkpointName: DEFAULT_MODEL,
    model: defaultEntry,
    fellBack: false,
    reason: 'Using default model (Juggernaut XL v10)',
  };
}
