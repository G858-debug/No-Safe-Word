export { extractCharacterTags, cleanScenePrompt, generateDefaultBodyPrompt } from './prompt-builder';

export {
  submitRunPodJob,
  submitRunPodSync,
  getRunPodJobStatus,
  waitForRunPodResult,
  imageUrlToBase64,
  base64ToBuffer,
} from './runpod';
export type { CharacterLoraDownload } from './runpod';

export { classifyScene } from './scene-classifier';
export type { SceneClassification, ImageType, InteractionType } from './scene-classifier';
export { selectDimensionsFromPrompt, DIMENSION_PRESETS } from './dimension-presets';
export type { DimensionPreset } from './dimension-presets';

// Post-hoc person count validation for dual-character scenes
export { validatePersonCount, canRetryValidation, buildRetrySettings, generateRetrySeed } from './person-validator';
export type { PersonValidationResult } from './person-validator';

// Claude prompt enhancement — Pony booru tag output
export { enhancePromptForScene } from './prompt-enhancer';

// Anthropic API retry wrapper — exponential backoff on 500/502/503/529
export { anthropicCreateWithRetry } from './anthropic-retry';

// Diagnostic flags for isolating scene generation components
export { DEFAULT_DIAGNOSTIC_FLAGS } from './diagnostic-flags';
export type { DiagnosticFlags } from './diagnostic-flags';

// Character LoRA pipeline types — shared by Pony pipeline
export type {
  CharacterInput,
  CharacterStructured,
  CharacterLoraRow,
  PipelineProgress,
  PipelineStatus,
  PipelineType,
  ImageSource,
  ImageCategory,
  VariationType,
} from './character-lora/types';

// Pony V6 CyberRealistic Pipeline
export { buildPonyWorkflow } from './pony-workflow-builder';
export type { PonyWorkflowConfig } from './pony-workflow-builder';
export { PONY_LORA_REGISTRY, getPonyLoras, selectPonyResources } from './pony-lora-registry';
export type { LoraEntry, ContentMode, LoraCategory, PonyResourceSelection } from './pony-lora-registry';
export {
  buildPonyQualityPrefix,
  buildPonyNegativePrompt,
  buildPonyCharacterTags,
  buildPonyPositivePrompt,
  convertProseToBooru,
  getPonyDimensions,
} from './pony-prompt-builder';
export type { PonyCharacterData } from './pony-prompt-builder';

// Pony dataset generation for LoRA training
export { buildPonyDatasetPrompts, buildPonyDatasetWorkflow, generatePonyDataset } from './pony-dataset-generator';
export type { PonyDatasetPrompt, PonyDatasetCharacter } from './pony-dataset-generator';

// Pony LoRA validation
export { validatePonyLora, toPipelineValidationResult } from './pony-character-lora-validator';
export type { PonyValidationResult } from './pony-character-lora-validator';

// Pony LoRA training pipeline + helpers
export { getRecommendedTrainingConfig, getIdentityTagsToRemove } from './pony-lora-trainer';
export type { PonyLoraTrainingConfig } from './pony-lora-trainer';
// Pipeline orchestrator is server-only (uses archiver, streams) — import directly:
//   import { runPonyPipeline, resumePonyPipeline, completePonyPipeline } from '@no-safe-word/image-gen/server/pony-lora-trainer'

// RunPod Pod API (batch GPU jobs — LoRA training)
export { createTrainingPod, getTrainingPodStatus, terminateTrainingPod } from './runpod-pods';
export type { TrainingPodConfig, PodStatus, PodDesiredStatus } from './runpod-pods';
