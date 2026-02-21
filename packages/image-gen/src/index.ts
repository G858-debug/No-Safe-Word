export * from './prompt-builder';

export {
  submitRunPodJob,
  submitRunPodSync,
  getRunPodJobStatus,
  waitForRunPodResult,
  imageUrlToBase64,
  base64ToBuffer,
} from './runpod';

export {
  buildPortraitWorkflow,
  buildSingleCharacterWorkflow,
  buildDualCharacterWorkflow,
  buildWorkflow,
} from './workflow-builder';

export { classifyScene } from './scene-classifier';
export type { SceneClassification, ImageType, InteractionType } from './scene-classifier';
export { selectResources } from './resource-selector';
export type { ResourceSelection, SelectedLora } from './resource-selector';
export { LORA_REGISTRY, getLorasByCategory, getLoraByFilename, buildCharacterLoraEntry } from './lora-registry';
export type { LoraEntry, CharacterLoraEntry } from './lora-registry';

// Model selection intelligence
export { MODEL_REGISTRY, DEFAULT_MODEL, getModelByFilename, getInstalledModels, getModelsByTier } from './model-registry';
export type { ModelEntry, ModelTier, ModelStrength } from './model-registry';
export { selectModel } from './model-selector';
export type { ModelSelection, ModelSelectionOptions } from './model-selector';


// Composition intelligence
export { augmentComposition } from './composition-advisor';
export type { CompositionResult } from './composition-advisor';

// Character LoRA pipeline — server-only, import directly:
//   import { runPipeline, getPipelineProgress } from '@no-safe-word/image-gen/character-lora/pipeline'
// NOT re-exported here because trainer.ts uses Node.js-only deps (archiver, fs)
// that break webpack client builds.
export type {
  CharacterInput,
  CharacterLoraRow,
  PipelineProgress,
  PipelineStatus,
} from './character-lora/types';
