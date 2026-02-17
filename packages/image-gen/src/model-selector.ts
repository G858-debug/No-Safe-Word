import type { SceneClassification, ImageType } from './scene-classifier';
import { MODEL_REGISTRY, DEFAULT_MODEL } from './model-registry';
import type { ModelEntry } from './model-registry';

export interface ModelSelectionOptions {
  /** Override to force a specific model filename */
  forceModel?: string;
  /** Prefer premium models when available */
  preferPremium?: boolean;
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

  // 2. Portrait images prefer premium portrait models
  if (imageType === 'portrait' || classification.shotType === 'close-up') {
    const premium = MODEL_REGISTRY.find(
      (m) => m.installed && m.strengths.includes('portrait') && m.tier === 'premium'
    );
    if (premium) {
      return {
        checkpointName: premium.filename,
        model: premium,
        fellBack: false,
        reason: `Portrait/close-up: using premium model ${premium.name}`,
      };
    }
  }

  // 3. Maximum quality for premium preference
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

  // 4. Default
  return {
    checkpointName: DEFAULT_MODEL,
    model: defaultEntry,
    fellBack: false,
    reason: 'Using default model (Juggernaut XL v10)',
  };
}
