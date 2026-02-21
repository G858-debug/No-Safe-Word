// Character LoRA Pipeline — Shared Types

// ── Pipeline Status ─────────────────────────────────────────────

export type PipelineStatus =
  | 'pending'
  | 'generating_dataset'
  | 'evaluating'
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
  eval_status: EvalStatus;
  eval_score: number | null;
  eval_details: EvalDetails | null;
  caption: string | null;
  created_at: string;
}

// ── Variation & Evaluation ──────────────────────────────────────

export type VariationType = 'angle' | 'expression' | 'lighting' | 'clothing' | 'framing';
export type EvalStatus = 'pending' | 'passed' | 'failed' | 'replaced';

export interface EvalDetails {
  face_score: number;
  body_score: number;
  quality_score: number;
  verdict: 'PASS' | 'FAIL';
  issues: string[];
}

// ── Training Parameters ─────────────────────────────────────────

export interface TrainingParams {
  token_string: string;
  is_lora: boolean;
  lora_lr: number;
  unet_learning_rate: number;
  text_encoder_lr: number;
  max_train_steps: number;
  resolution: number;
  batch_size: number;
  use_face_detection_instead: boolean;
  lr_scheduler: string;
  seed: number;
}

export const DEFAULT_TRAINING_PARAMS: TrainingParams = {
  token_string: 'tok',
  is_lora: true,
  lora_lr: 1e-4,
  unet_learning_rate: 1e-6,
  text_encoder_lr: 0,
  max_train_steps: 1000,
  resolution: 1024,
  batch_size: 1,
  use_face_detection_instead: true,
  lr_scheduler: 'cosine',
  seed: 42,
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
  maxReplacementRounds: 2,
  /** Max training attempts before failing */
  maxTrainingAttempts: 3,
  /** Parallel image generation limit */
  generationConcurrency: 5,
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
} as const;

// ── Character Input ─────────────────────────────────────────────

export interface CharacterInput {
  characterId: string;
  characterName: string;
  gender: string;
  approvedImageUrl: string;
  approvedPrompt: string;
}

// ── Stage Results ───────────────────────────────────────────────

export interface DatasetGenerationResult {
  totalGenerated: number;
  imageRecords: LoraDatasetImageRow[];
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
