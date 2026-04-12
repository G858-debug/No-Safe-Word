/**
 * Art Director system types.
 *
 * Centralised to avoid circular imports between qwen-vl-client,
 * civitai-client, orchestrator, and API routes.
 */

// ── Qwen VL ──

export interface QwenVLConfig {
  endpoint: string;
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
}

export interface QwenVLImageInput {
  /** HTTP URL or base64 data URI */
  url: string;
  /** Optional label for multi-image analysis */
  label?: string;
}

export interface QwenVLResponse {
  content: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// ── CivitAI Image Search ──

export interface CivitAIImageMeta {
  prompt?: string;
  negativePrompt?: string;
  Model?: string;
  "Model hash"?: string;
  sampler?: string;
  cfgScale?: number | string;
  steps?: number | string;
  seed?: number | string;
  Size?: string; // "832x1216"
  "Clip skip"?: number | string;
  resources?: Array<{
    name: string;
    type: "model" | "lora" | string;
    weight?: number;
    hash?: string;
  }>;
  [key: string]: unknown;
}

export interface CivitAIImageResult {
  id: number;
  url: string;
  width: number;
  height: number;
  nsfw: boolean | string;
  nsfwLevel?: string;
  meta: CivitAIImageMeta | null;
  stats: { likeCount: number; laughCount: number; heartCount: number; dislikeCount: number; commentCount: number };
  createdAt?: string;
}

// ── Parsed Recipe ──

export interface ParsedRecipe {
  model: string | null;
  modelHash: string | null;
  loras: Array<{ name: string; weight: number }>;
  prompt: string;
  negativePrompt: string;
  sampler: string;
  cfgScale: number;
  steps: number;
  dimensions: { width: number; height: number };
  seed: number | null;
  clipSkip: number;
}

// ── Intent Analysis ──

export interface IntentAnalysis {
  characters: Array<{
    name: string;
    role: string;
    physicalDescription: string;
  }>;
  characterCount: number;
  characterGenders: string[];
  poses: string[];
  interactionType: "intimate" | "romantic" | "casual" | "solo";
  setting: string;
  lighting: string;
  mood: string;
  cameraAngle: string;
  composition: string;
  nsfwLevel: "sfw" | "suggestive" | "nsfw" | "explicit";
  searchQueries: [string, string, string];
  keyVisualElements: string[];
}

// ── Ranked Reference ──

export interface RankedReference {
  id: number;
  url: string;
  thumbnailBase64?: string;
  recipe: ParsedRecipe;
  rank: number;
  explanation: string;
  whatMatches: string;
  whatDoesnt: string;
  relevanceScore: number; // 0-100
}

// ── Iteration ──

export interface EvaluationScores {
  positionPose: number;       // 0-100, weight 30%
  characterCount: number;     // 0-100, weight 20%
  settingEnvironment: number; // 0-100, weight 15%
  characterAppearance: number;// 0-100, weight 15%
  lightingMood: number;       // 0-100, weight 10%
  compositionQuality: number; // 0-100, weight 10%
}

export interface IterationResult {
  attempt: number;
  civitaiToken: string | null;
  imageUrl: string | null;
  imageBase64?: string;
  recipe: ParsedRecipe | null;
  evaluation: {
    scores: EvaluationScores;
    overall: number; // 0-100 weighted
    feedback: string;
    passesThreshold: boolean;
  } | null;
  recipeAdjustments: string | null;
  status: "pending" | "generating" | "evaluating" | "completed" | "failed";
  error?: string;
}

// ── Job ──

export type ArtDirectorJobStatus =
  | "analyzing"
  | "awaiting_selection"
  | "generating"
  | "completed"
  | "failed"
  | "cancelled";

export interface ArtDirectorJob {
  id: string;
  promptId: string;
  seriesId: string;
  status: ArtDirectorJobStatus;
  intentAnalysis: IntentAnalysis | null;
  referenceImages: RankedReference[];
  selectedReferenceId: number | null;
  adaptedRecipe: ParsedRecipe | null;
  iterations: IterationResult[];
  currentIteration: number;
  bestIteration: number | null;
  bestScore: number | null;
  finalImageUrl: string | null;
  finalImageId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
