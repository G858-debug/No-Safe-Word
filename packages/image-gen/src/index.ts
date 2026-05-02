export {
  extractCharacterTags, cleanScenePrompt, generateDefaultBodyPrompt,
  buildQualityPrefix, buildNegativePrompt, buildCharacterTags, buildPositivePrompt,
  convertProseToPrompt, getDimensions, getIdentityPhrasesToRemove, estimateClipTokens,
} from './prompt-builder';
export type { ContentMode, CharacterPromptData } from './prompt-builder';

export {
  submitRunPodJob,
  submitRunPodSync,
  getRunPodJobStatus,
  waitForRunPodResult,
  imageUrlToBase64,
  resizeImageForPayload,
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

// Anthropic API retry wrapper
export { anthropicCreateWithRetry } from './anthropic-retry';

// Scene profiles
export { getDefaultProfile, deriveCompositionType, deriveContentMode, applyProfileOverrides } from './scene-profiles';
export type { SceneProfile, CompositionType } from './scene-profiles';

// Scene evaluator
export { validateTagsPreflight, validatePersonCount as validatePersonCountV2, evaluateSceneFull, detectCorruptedImage } from './scene-evaluator';
export type { EvaluationResult, EvaluationContext, EvaluationScores, FailureCategory, PreflightResult } from './scene-evaluator';

// Retry strategy
export { computeCorrectionPlan, canRetry, generateRetrySeed as generateRetrySeedV2, selectBestAttempt, MAX_EVAL_RETRY_ATTEMPTS } from './retry-strategy';
export type { CorrectionPlan } from './retry-strategy';

// Tag rewriter
export { rewriteTagsForFailure } from './tag-rewriter';

// Architectural lessons
export { ARCHITECTURAL_LESSONS, checkArchitecturalLessons, requestStructuralDiagnosis } from './architectural-lessons';
export type { ArchitecturalLesson } from './architectural-lessons';

// Legacy ComfyUI workflow builder (retained for character portrait generation)
export { buildWorkflow, buildTwoPassWorkflow, buildInpaintWorkflow, buildImg2ImgWorkflow, buildUpscaleWorkflow } from './workflow-builder';
export type { WorkflowConfig, TwoPassWorkflowConfig, InpaintWorkflowConfig, Img2ImgWorkflowConfig, UpscaleWorkflowConfig, ControlNetConfig } from './workflow-builder';

// Replicate client (HunyuanImage 3.0)
export { getReplicateClient } from './replicate-client';
export {
  generateHunyuanImage,
  assembleHunyuanPrompt,
  VISUAL_SIGNATURE,
} from './hunyuan-generator';
export type {
  HunyuanGenerateOptions,
  HunyuanGenerateResult,
} from './hunyuan-generator';

// Shared portrait prompt builder (both flux2_dev + hunyuan3)
export {
  buildCharacterPortraitPrompt,
  buildSceneCharacterBlock,
  buildSceneCharacterBlockFromLocked,
  deriveBodyPromptFromFace,
  resolvePortraitText,
  stripPortraitFraming,
} from './portrait-prompt-builder';
export type { PortraitCharacterDescription } from './portrait-prompt-builder';

// Flux 2 Dev workflow + generator
export { buildFlux2Workflow } from './flux2-workflow-builder';
export type {
  Flux2WorkflowOptions,
  Flux2ReferenceImage,
  Flux2ControlNetConfig,
} from './flux2-workflow-builder';
export { generateFlux2Image, assembleFlux2Prompt } from './flux2-generator';
export type {
  Flux2GenerateOptions,
  Flux2GenerateResult,
} from './flux2-generator';

// Flux 2 Pro (Replicate) — fallback for cover generation when RunPod has no capacity
export { generateFlux2ProImage } from './flux2-pro-generator';
export type {
  Flux2ProGenerateOptions,
  Flux2ProGenerateResult,
} from './flux2-pro-generator';

// Siray.ai client + generator (HunyuanImage 3.0 — replaces Replicate path)
export { getSirayClient } from './siray-client';
export type {
  SirayJobPayload,
  SirayPollResponse,
  SirayJobState,
  SirayJobStatus,
  SirayModelId,
} from './siray-client';
export {
  generateSirayImage,
  submitSirayImage,
  generateCharacterPortrait,
  generateSceneImage,
} from './siray-generator';
export type {
  GenerateSirayImageParams,
  SubmitSirayImageResult,
} from './siray-generator';

// Generated image critic (Pixtral 12B)
export { critiqueGeneratedImage } from './image-critic';
