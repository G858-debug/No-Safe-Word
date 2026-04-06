export {
  extractCharacterTags, cleanScenePrompt, generateDefaultBodyPrompt,
  buildQualityPrefix, buildNegativePrompt, buildCharacterTags, buildPositivePrompt,
  convertProseToPrompt, getDimensions, getIdentityPhrasesToRemove,
} from './prompt-builder';
export type { ContentMode, CharacterPromptData } from './prompt-builder';

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

// Claude prompt enhancement
export { enhancePromptForScene } from './prompt-enhancer';

// Anthropic API retry wrapper — exponential backoff on 500/502/503/529
export { anthropicCreateWithRetry } from './anthropic-retry';

// Diagnostic flags for isolating scene generation components
export { DEFAULT_DIAGNOSTIC_FLAGS } from './diagnostic-flags';
export type { DiagnosticFlags } from './diagnostic-flags';

// Character LoRA pipeline types
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

// Scene profiles — composition-aware generation parameter profiles
export { getDefaultProfile, deriveCompositionType, deriveContentMode, applyProfileOverrides } from './scene-profiles';
export type { SceneProfile, CompositionType } from './scene-profiles';

// Scene evaluator — tiered image evaluation pipeline
export { validateTagsPreflight, validatePersonCount as validatePersonCountV2, evaluateSceneFull } from './scene-evaluator';
export type { EvaluationResult, EvaluationContext, EvaluationScores, FailureCategory, PreflightResult } from './scene-evaluator';

// Retry strategy — correction logic and escalation
export { computeCorrectionPlan, canRetry, generateRetrySeed as generateRetrySeedV2, selectBestAttempt, MAX_EVAL_RETRY_ATTEMPTS } from './retry-strategy';
export type { CorrectionPlan } from './retry-strategy';

// Tag rewriter — failure-aware booru tag rewriting
export { rewriteTagsForFailure } from './tag-rewriter';

// Architectural lessons — known structural solutions
export { ARCHITECTURAL_LESSONS, checkArchitecturalLessons, requestStructuralDiagnosis } from './architectural-lessons';
export type { ArchitecturalLesson } from './architectural-lessons';

// Juggernaut Ragnarok Workflow Builder
export { buildWorkflow, buildInpaintWorkflow, buildImg2ImgWorkflow, buildUpscaleWorkflow } from './workflow-builder';
export type { WorkflowConfig, InpaintWorkflowConfig, Img2ImgWorkflowConfig, UpscaleWorkflowConfig } from './workflow-builder';

// Dataset generation for LoRA training
export { buildDatasetPrompts, buildDatasetWorkflow, generateDataset } from './dataset-generator';
export type { DatasetPrompt, DatasetCharacter } from './dataset-generator';

// LoRA validation
export { validateLora, toPipelineValidationResult } from './character-lora-validator';
export type { ValidationResultDetail } from './character-lora-validator';

// LoRA training pipeline + helpers
export { getRecommendedTrainingConfig, getIdentityTagsToRemove } from './lora-trainer';
export type { LoraTrainingConfig } from './lora-trainer';
// Pipeline orchestrator is server-only (uses archiver, streams) — import directly:
//   import { runTrainingPipeline, resumeTrainingPipeline, completeTrainingPipeline } from '@no-safe-word/image-gen/server/lora-trainer'

// RunPod Pod API (batch GPU jobs — LoRA training)
export { createTrainingPod, getTrainingPodStatus, terminateTrainingPod } from './runpod-pods';
export type { TrainingPodConfig, PodStatus, PodDesiredStatus } from './runpod-pods';
