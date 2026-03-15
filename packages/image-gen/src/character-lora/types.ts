// Character LoRA Pipeline — Shared Types

// ── Pipeline Status ─────────────────────────────────────────────

export type PipelineStatus =
  | 'pending'
  | 'generating_dataset'
  | 'evaluating'
  | 'awaiting_dataset_approval'
  | 'captioning'
  | 'training'
  | 'validating'
  | 'deployed'
  | 'failed'
  | 'archived';

// ── Database Row Types ──────────────────────────────────────────

export interface CharacterLoraRow {
  id: string;
  character_id: string;
  filename: string;
  storage_path: string;
  storage_url: string | null;
  file_size_bytes: number | null;
  trigger_word: string;
  base_model: string;
  training_provider: string;
  training_id: string | null;
  training_params: TrainingParams;
  dataset_size: number;
  validation_score: number | null;
  training_attempts: number;
  status: PipelineStatus;
  error: string | null;
  pipeline_type: PipelineType;
  created_at: string;
  updated_at: string;
  deployed_at: string | null;
}

export interface LoraDatasetImageRow {
  id: string;
  lora_id: string;
  image_url: string;
  storage_path: string;
  prompt_template: string;
  variation_type: VariationType;
  source: ImageSource;
  category: ImageCategory;
  eval_status: EvalStatus;
  eval_score: number | null;
  eval_details: EvalDetails | null;
  caption: string | null;
  created_at: string;
}

// ── Hybrid Pipeline Types ───────────────────────────────────────

export type ImageSource = 'nano-banana' | 'comfyui' | 'sdxl-img2img';
export type ImageCategory = 'face-closeup' | 'head-shoulders' | 'waist-up' | 'full-body' | 'body-detail';
export type PipelineType = 'story_character' | 'author_persona';

// ── Variation & Evaluation ──────────────────────────────────────

export type VariationType = 'angle' | 'expression' | 'lighting' | 'clothing' | 'framing';
export type EvalStatus = 'pending' | 'passed' | 'failed' | 'replaced';

export interface EvalDetails {
  face_score: number;
  body_score: number;
  quality_score: number;
  verdict: 'PASS' | 'FAIL';
  issues: string[];
  /** True when a body-category image (waist-up, full-body, body-detail) only shows the face/head.
   *  Forces FAIL verdict — the image doesn't match the expected framing. */
  face_only_crop?: boolean;
}

// ── Training Parameters ─────────────────────────────────────────

export interface TrainingParams {
  trigger_word: string;     // Token that identifies this character in prompts
  steps: number;            // Training steps — 1000-2000 for character LoRAs
  learning_rate: number;    // Default 0.0004 for Flux
  lora_rank: number;        // 16 = balanced quality/size; 32 = higher fidelity
  batch_size: number;       // 1
  resolution: number;       // 512 or 1024
  lr_scheduler: string;     // 'constant' or 'linear'
}

export const DEFAULT_TRAINING_PARAMS: TrainingParams = {
  trigger_word: 'tok',
  steps: 1500,
  learning_rate: 0.0004,
  lora_rank: 16,
  batch_size: 1,
  resolution: 512,
  lr_scheduler: 'constant',
};

// ── Pipeline Configuration ──────────────────────────────────────

export const PIPELINE_CONFIG = {
  /** Max images to generate per run */
  datasetSize: 30,
  /** Minimum passed images to proceed with training */
  minPassedImages: 20,
  /** Target passed images before proceeding */
  targetPassedImages: 25,
  /** Max rounds of replacement generation for failed images */
  maxReplacementRounds: 3,
  /** Max training attempts before failing */
  maxTrainingAttempts: 3,
  /** Delay between Nano Banana requests (ms) */
  nanoBananaDelay: 2000,
  /** Delay between ComfyUI requests (ms) */
  comfyuiDelay: 1000,
  /** Parallel evaluation limit */
  evaluationConcurrency: 3,
  /** Replicate polling interval (ms) */
  replicatePollingInterval: 15_000,
  /** Minimum eval score to pass (each category) */
  minEvalScore: 7,
  /** Minimum face score on validation test images to pass */
  minValidationFaceScore: 7,
  /** Minimum test images that must pass validation (out of 6) */
  minValidationPasses: 5,
  /** Replicate hardware SKU for model creation and training */
  replicateHardware: 'gpu-t4',
} as const;

// ── Character Input (Hybrid — dual-image) ───────────────────────

/** Structured character data from the story JSON description field */
export interface CharacterStructured {
  gender: string;
  ethnicity: string;
  bodyType: string;
  skinTone: string;
  hairColor: string;
  hairStyle: string;
  eyeColor: string;
  age: string;
  distinguishingFeatures?: string;
}

export interface CharacterInput {
  characterId: string;
  characterName: string;
  gender: string;
  approvedImageUrl: string;
  approvedPrompt: string;
  /** Full-body reference image URL (for hybrid ComfyUI pipeline) */
  fullBodyImageUrl: string;
  fullBodySeed: number;
  /** Portrait seed for reproducibility */
  portraitSeed: number;
  /** Structured character data for ComfyUI prompt interpolation */
  structuredData: CharacterStructured;
  /** Pipeline type controls dataset size: author_persona gets more images */
  pipelineType: PipelineType;
}

// ── Stage Results ───────────────────────────────────────────────

export interface DatasetGenerationResult {
  totalGenerated: number;
  imageRecords: LoraDatasetImageRow[];
  /** Prompts that failed to generate (for inclusion in replacement rounds) */
  failedPrompts: Array<{ promptTemplate: string; variationType: VariationType; source: ImageSource }>;
}

export interface EvaluationResult {
  totalEvaluated: number;
  passed: number;
  failed: number;
  passedImages: LoraDatasetImageRow[];
}

export interface CaptionResult {
  totalCaptioned: number;
  captionedImages: Array<{ imageUrl: string; caption: string; storagePath: string }>;
}

export interface TrainingResult {
  trainingId: string;
  loraUrl: string;
  loraBuffer: Buffer;
  attempt: number;
}

export interface ValidationResult {
  overallPass: boolean;
  averageFaceScore: number;
  testResults: Array<{
    prompt: string;
    faceScore: number;
    passed: boolean;
    imageUrl?: string;
  }>;
}

export interface DeploymentResult {
  filename: string;
  storagePath: string;
  storageUrl: string;
  fileSizeBytes: number;
}

// ── Pipeline Progress (for status polling) ──────────────────────

export interface PipelineProgress {
  loraId: string;
  status: PipelineStatus;
  progress: {
    datasetGenerated: number;
    datasetApproved: number;
    trainingAttempt: number;
    validationScore: number | null;
  };
  error: string | null;
  estimatedTimeRemaining: string | null;
}
