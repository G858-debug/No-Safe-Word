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
export { buildKontextIdentityPrefix, resolvePromptEthnicity, generateDefaultBodyPrompt } from './kontext-identity';

// Scene darkness detection — shared by V1 and V3 pipelines
export { detectSceneDarkness } from './scene-darkness';

// Claude prompt enhancement — shared by enhance endpoint and V3 pipeline
export { enhancePromptForScene } from './prompt-enhancer';

// Flux prompt rewriter — converts tag-style prompts to Flux natural language
export { rewritePromptForFlux } from './flux-prompt-rewriter';

// Female body pipeline — shared config for portrait + dataset generation
export {
  FEMALE_BODY_SDXL_CHECKPOINT,
  FEMALE_BODY_KONTEXT_MODEL,
  FEMALE_BODY_SDXL_CONFIG,
  FEMALE_BODY_KONTEXT_CONFIG,
  FEMALE_BODY_KONTEXT_LORAS,
  isBlackAfrican as isBlackAfricanFemaleBody,
  buildFemaleBodyLoraStack,
  buildFemaleBodySdxlPrompt,
  buildFemaleBodyImg2ImgPrompt,
  buildFemaleBodyStep2Config,
} from './female-body-pipeline';
export type { FemaleBodyPromptParams, FemaleBodyStep2Config } from './female-body-pipeline';

// Replicate client — Nano Banana 2 for male character portraits
export { runNanoBanana, readReplicateOutput } from './replicate-client';

// Anthropic API retry wrapper — exponential backoff on 500/502/503/529
export { anthropicCreateWithRetry } from './anthropic-retry';

// Diagnostic flags for isolating scene generation components
export { DEFAULT_DIAGNOSTIC_FLAGS } from './diagnostic-flags';
export type { DiagnosticFlags } from './diagnostic-flags';

// Flux-native prompt builder — assembles prose prompts, strips legacy syntax, and enhances sensuality
export { buildFluxPrompt, stripSdxlSyntax, hasHeavySdxlFormatting, injectFluxFemaleEnhancement, injectFluxGazeEmphasis, buildFluxAtmosphereSuffix, reorderScenePrompt } from './flux-prompt-builder';

// Character LoRA pipeline — server-only, import directly:
//   import { runPipeline, getPipelineProgress } from '@no-safe-word/image-gen/character-lora/pipeline'
// NOT re-exported here because trainer.ts uses Node.js-only deps (archiver, fs)
// that break webpack client builds.

// Pony V6 Character LoRA pipeline — server-only, import directly:
//   import { ... } from '@no-safe-word/image-gen/server/pony-character-lora/training-image-evaluator'
//   import { ... } from '@no-safe-word/image-gen/server/pony-character-lora/training-caption-builder'
// Following the same pattern as Flux character-lora — not barrel-exported.
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

// V2 Pipeline exports (NB2 → Florence-2/SAM2 → UnCanny)
export { runUncannyInpaintPipeline, submitUncannyInpaintJob, runV2FullPipeline } from './uncanny-inpaint-pipeline';
export type { UncannyInpaintConfig, UncannyInpaintResult, V2FullPipelineConfig, V2FullPipelineResult } from './uncanny-inpaint-pipeline';
export { buildFlorenceSam2MaskWorkflow, buildUncannyInpaintWorkflow } from './workflow-builder-uncanny';
export type { FlorenceSam2MaskConfig, UncannyInpaintWorkflowConfig } from './workflow-builder-uncanny';
export { runNb2Scene } from './replicate-nb2-scene';
export type { Nb2SceneConfig, Nb2SceneResult } from './replicate-nb2-scene';

// V4 Pipeline exports (Multi-LoRA scene generation + Easel face swap) — legacy flux2_pro
export { runMultiLoraScene, runFaceSwap, submitFaceSwap, checkFaceSwapStatus, runV4Pipeline, runV4SceneGeneration } from './replicate-flux2-pro';
export type {
  MultiLoraSceneConfig, MultiLoraSceneResult,
  FaceSwapConfig, FaceSwapResult, FaceSwapStatus,
  V4PipelineConfig, V4PipelineResult, V4SceneOnlyResult,
} from './replicate-flux2-pro';

// Flux 2 Pro client (kept for SFW-only workflows)
export { runFlux2Pro, rewriteNsfwPromptForFlux2Pro } from './replicate-flux2-pro';
export type { Flux2ProConfig, Flux2ProResult } from './replicate-flux2-pro';

// V4 Pony Pipeline exports (CyberRealistic Pony on RunPod/ComfyUI)
export { buildPonyWorkflow } from './pony-workflow-builder';
export type { PonyWorkflowConfig } from './pony-workflow-builder';
export { PONY_LORA_REGISTRY, getPonyLoras, selectPonyResources } from './pony-lora-registry';
export type { PonyResourceSelection } from './pony-lora-registry';
export {
  buildPonyQualityPrefix,
  buildPonyNegativePrompt,
  buildPonyCharacterTags,
  buildPonyPositivePrompt,
  convertProseToBooru,
  getPonyDimensions,
} from './pony-prompt-builder';
export type { PonyCharacterData } from './pony-prompt-builder';
