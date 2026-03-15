export { extractCharacterTags, cleanScenePrompt } from './prompt-builder';

export {
  submitRunPodJob,
  submitRunPodSync,
  getRunPodJobStatus,
  waitForRunPodResult,
  imageUrlToBase64,
  base64ToBuffer,
} from './runpod';
export type { CharacterLoraDownload } from './runpod';

export { buildKontextWorkflow, buildSdxlWorkflow, buildSdxlPulidPortraitWorkflow } from './workflow-builder';
export type { KontextWorkflowConfig, KontextWorkflowType, SdxlWorkflowConfig, SdxlPulidPortraitConfig } from './workflow-builder';

export { classifyScene } from './scene-classifier';
export type { SceneClassification, ImageType, InteractionType } from './scene-classifier';
export { selectDimensionsFromPrompt, DIMENSION_PRESETS } from './dimension-presets';
export type { DimensionPreset } from './dimension-presets';
export { KONTEXT_LORA_REGISTRY, getKontextLoras, selectKontextResources, buildCharacterLoraEntry } from './lora-registry';
export type { LoraEntry, CharacterLoraEntry, KontextResourceSelection } from './lora-registry';

// Post-hoc person count validation for dual-character scenes
export { validatePersonCount, canRetryValidation, buildRetrySettings, generateRetrySeed } from './person-validator';
export type { PersonValidationResult } from './person-validator';

// Kontext identity prefix for natural-language character description
export { buildKontextIdentityPrefix, resolvePromptEthnicity } from './kontext-identity';

// Flux prompt rewriter — converts tag-style prompts to Flux natural language
export { rewritePromptForFlux } from './flux-prompt-rewriter';

// Replicate client — Nano Banana 2 for male character portraits
export { runNanoBanana, readReplicateOutput } from './replicate-client';

// Flux-native prompt builder — assembles prose prompts, strips legacy syntax, and enhances sensuality
export { buildFluxPrompt, stripSdxlSyntax, hasHeavySdxlFormatting, injectFluxFemaleEnhancement, injectFluxGazeEmphasis, buildFluxAtmosphereSuffix } from './flux-prompt-builder';

// Character LoRA pipeline — server-only, import directly:
//   import { runPipeline, getPipelineProgress } from '@no-safe-word/image-gen/character-lora/pipeline'
// NOT re-exported here because trainer.ts uses Node.js-only deps (archiver, fs)
// that break webpack client builds.
export type {
  CharacterInput,
  CharacterStructured,
  CharacterLoraRow,
  PipelineProgress,
  PipelineStatus,
  PipelineType,
  ImageSource,
  ImageCategory,
} from './character-lora/types';
