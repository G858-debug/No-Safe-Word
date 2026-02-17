import { DEFAULT_MODEL } from './model-registry';

type WorkflowType = 'portrait' | 'single-character' | 'dual-character';

interface LoraInput {
  filename: string;
  strengthModel: number;
  strengthClip: number;
}

interface WorkflowParams {
  /** The scene/portrait prompt text */
  positivePrompt: string;
  /** Negative prompt (uses default if not provided) */
  negativePrompt?: string;
  /** Image dimensions */
  width: number;
  height: number;
  /** Generation seed */
  seed: number;
  /** Output filename prefix */
  filenamePrefix?: string;
  /** Dynamic LoRA stack from resource selector. Falls back to detail-tweaker-xl if not provided. */
  loras?: LoraInput[];
  /** Additional negative prompt terms from scene classification */
  negativePromptAdditions?: string;
  /** Checkpoint model filename. Defaults to DEFAULT_MODEL (Juggernaut XL v10). */
  checkpointName?: string;
  /** Override CFG scale (default 7) */
  cfg?: number;
  /** Override sampler name (default 'euler_ancestral') */
  samplerName?: string;
}

interface SceneWorkflowParams extends WorkflowParams {
  /** Filename for the primary character reference image (must match images[].name in RunPod request) */
  primaryRefImageName: string;
  /** Face-specific prompt for primary character's FaceDetailer pass */
  primaryFacePrompt: string;
  /** IPAdapter weight for primary character (default 0.85 for single, 0.7 for dual) */
  ipadapterWeight?: number;
}

interface DualCharacterWorkflowParams extends SceneWorkflowParams {
  /** Face-specific prompt for secondary character's FaceDetailer pass */
  secondaryFacePrompt: string;
  /** Seed for the secondary character's FaceDetailer (typically their approved seed) */
  secondarySeed: number;
}

const DEFAULT_NEGATIVE_PROMPT =
  'ugly, deformed, noisy, blurry, low contrast, cartoon, anime, sketch, painting, watermark, text, bad anatomy, bad hands, extra fingers, missing fingers, extra limbs, disfigured, mutation, poorly drawn face, poorly drawn hands, distorted face, cross-eyed, out of frame, cropped, worst quality, low quality, jpeg artifacts, airbrushed skin, plastic skin, smooth skin, artificial skin, waxy skin, doll-like';

const DEFAULT_NEGATIVE_PROMPT_DUAL =
  DEFAULT_NEGATIVE_PROMPT + ', three people, crowd, group';

/** Node IDs for up to 4 chained LoRA loaders */
const LORA_NODE_IDS = ['2', '2a', '2b', '2c'] as const;

/**
 * Build a chain of LoRA loader nodes and add them to the workflow.
 * Returns the node ID of the last LoRA loader in the chain (all downstream
 * nodes should reference this for model/clip).
 */
function buildLoraChain(
  workflow: Record<string, any>,
  loras?: LoraInput[],
): string {
  // Default to single detail-tweaker-xl if no loras provided
  const loraStack = (loras && loras.length > 0) ? loras : [
    { filename: 'detail-tweaker-xl.safetensors', strengthModel: 0.5, strengthClip: 0.5 },
  ];

  // Cap at 4 LoRAs
  const capped = loraStack.slice(0, 4);

  for (let i = 0; i < capped.length; i++) {
    const nodeId = LORA_NODE_IDS[i];
    const lora = capped[i];
    const prevNodeId = i === 0 ? '1' : LORA_NODE_IDS[i - 1];

    workflow[nodeId] = {
      class_type: 'LoraLoader',
      inputs: {
        lora_name: lora.filename,
        strength_model: lora.strengthModel,
        strength_clip: lora.strengthClip,
        model: [prevNodeId, 0],
        clip: [prevNodeId, 1],
      },
    };
  }

  return LORA_NODE_IDS[capped.length - 1];
}

/**
 * Combine base negative prompt with optional additions.
 */
function buildNeg(base: string, additions?: string): string {
  if (!additions) return base;
  return base + ', ' + additions;
}

/**
 * Build a portrait generation workflow (no IPAdapter).
 * Used for initial character portrait generation before approval.
 */
export function buildPortraitWorkflow(params: WorkflowParams): Record<string, any> {
  const baseNeg = params.negativePrompt || DEFAULT_NEGATIVE_PROMPT;
  const neg = buildNeg(baseNeg, params.negativePromptAdditions);
  const prefix = params.filenamePrefix || 'portrait';
  const ckpt = params.checkpointName || DEFAULT_MODEL;
  const cfg = params.cfg || 7;
  const sampler = params.samplerName || 'euler_ancestral';

  const workflow: Record<string, any> = {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: ckpt },
    },
  };

  const lastLora = buildLoraChain(workflow, params.loras);

  Object.assign(workflow, {
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: params.positivePrompt, clip: [lastLora, 1] },
    },
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: { text: neg, clip: [lastLora, 1] },
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { width: params.width, height: params.height, batch_size: 1 },
    },
    '6': {
      class_type: 'KSampler',
      inputs: {
        model: [lastLora, 0],
        positive: ['3', 0],
        negative: ['4', 0],
        latent_image: ['5', 0],
        seed: params.seed,
        steps: 30,
        cfg,
        sampler_name: sampler,
        scheduler: 'normal',
        denoise: 1.0,
      },
    },
    '7': {
      class_type: 'VAEDecode',
      inputs: { samples: ['6', 0], vae: ['1', 2] },
    },
    '10': {
      class_type: 'UltralyticsDetectorProvider',
      inputs: { model_name: 'bbox/face_yolov8m.pt' },
    },
    '11': {
      class_type: 'SAMLoader',
      inputs: { model_name: 'sam_vit_b_01ec64.pth', device_mode: 'AUTO' },
    },
    '12': {
      class_type: 'FaceDetailer',
      inputs: {
        image: ['7', 0],
        model: [lastLora, 0],
        clip: [lastLora, 1],
        vae: ['1', 2],
        positive: ['3', 0],
        negative: ['4', 0],
        bbox_detector: ['10', 0],
        sam_model_opt: ['11', 0],
        guide_size: 512,
        guide_size_for: true,
        max_size: 1024,
        seed: params.seed,
        steps: 20,
        cfg,
        sampler_name: sampler,
        scheduler: 'normal',
        denoise: 0.3,
        feather: 5,
        noise_mask: true,
        force_inpaint: true,
        bbox_threshold: 0.5,
        bbox_dilation: 10,
        bbox_crop_factor: 3.0,
        sam_detection_hint: 'center-1',
        sam_dilation: 0,
        sam_threshold: 0.93,
        sam_bbox_expansion: 0,
        sam_mask_hint_threshold: 0.7,
        sam_mask_hint_use_negative: 'False',
        drop_size: 10,
        wildcard: '',
        cycle: 1,
        inpaint_model: false,
        noise_mask_feather: 20,
      },
    },
    '20': {
      class_type: 'SaveImage',
      inputs: { images: ['12', 0], filename_prefix: prefix },
    },
  });

  return workflow;
}

/**
 * Build a single-character scene workflow with IPAdapter FaceID.
 * Used when only one character appears in the image.
 */
export function buildSingleCharacterWorkflow(params: SceneWorkflowParams): Record<string, any> {
  const baseNeg = params.negativePrompt || DEFAULT_NEGATIVE_PROMPT;
  const neg = buildNeg(baseNeg, params.negativePromptAdditions);
  const prefix = params.filenamePrefix || 'scene';
  const ipaWeight = params.ipadapterWeight ?? 0.85;
  const ckpt = params.checkpointName || DEFAULT_MODEL;
  const cfg = params.cfg || 7;
  const sampler = params.samplerName || 'euler_ancestral';

  const workflow: Record<string, any> = {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: ckpt },
    },
  };

  const lastLora = buildLoraChain(workflow, params.loras);

  Object.assign(workflow, {
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: params.positivePrompt, clip: [lastLora, 1] },
    },
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: { text: neg, clip: [lastLora, 1] },
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { width: params.width, height: params.height, batch_size: 1 },
    },
    '30': {
      class_type: 'IPAdapterUnifiedLoaderFaceID',
      inputs: { model: [lastLora, 0], preset: 'FACEID PLUS V2', lora_strength: 0.6, provider: 'CUDA' },
    },
    '31': {
      class_type: 'LoadImage',
      inputs: { image: params.primaryRefImageName },
    },
    '32': {
      class_type: 'IPAdapterFaceID',
      inputs: {
        model: ['30', 0],
        ipadapter: ['30', 1],
        image: ['31', 0],
        weight: ipaWeight,
        weight_faceidv2: ipaWeight,
        weight_type: 'linear',
        combine_embeds: 'concat',
        start_at: 0.0,
        end_at: 1.0,
        embeds_scaling: 'V only',
      },
    },
    '6': {
      class_type: 'KSampler',
      inputs: {
        model: ['32', 0],
        positive: ['3', 0],
        negative: ['4', 0],
        latent_image: ['5', 0],
        seed: params.seed,
        steps: 30,
        cfg,
        sampler_name: sampler,
        scheduler: 'normal',
        denoise: 1.0,
      },
    },
    '7': {
      class_type: 'VAEDecode',
      inputs: { samples: ['6', 0], vae: ['1', 2] },
    },
    '10': {
      class_type: 'UltralyticsDetectorProvider',
      inputs: { model_name: 'bbox/face_yolov8m.pt' },
    },
    '11': {
      class_type: 'SAMLoader',
      inputs: { model_name: 'sam_vit_b_01ec64.pth', device_mode: 'AUTO' },
    },
    '40': {
      class_type: 'CLIPTextEncode',
      inputs: { text: params.primaryFacePrompt, clip: [lastLora, 1] },
    },
    '12': {
      class_type: 'FaceDetailer',
      inputs: {
        image: ['7', 0],
        model: [lastLora, 0],
        clip: [lastLora, 1],
        vae: ['1', 2],
        positive: ['40', 0],
        negative: ['4', 0],
        bbox_detector: ['10', 0],
        sam_model_opt: ['11', 0],
        guide_size: 512,
        guide_size_for: true,
        max_size: 1024,
        seed: params.seed,
        steps: 20,
        cfg,
        sampler_name: sampler,
        scheduler: 'normal',
        denoise: 0.3,
        feather: 5,
        noise_mask: true,
        force_inpaint: true,
        bbox_threshold: 0.5,
        bbox_dilation: 10,
        bbox_crop_factor: 3.0,
        sam_detection_hint: 'center-1',
        sam_dilation: 0,
        sam_threshold: 0.93,
        sam_bbox_expansion: 0,
        sam_mask_hint_threshold: 0.7,
        sam_mask_hint_use_negative: 'False',
        drop_size: 10,
        wildcard: '',
        cycle: 1,
        inpaint_model: false,
        noise_mask_feather: 20,
      },
    },
    '20': {
      class_type: 'SaveImage',
      inputs: { images: ['12', 0], filename_prefix: prefix },
    },
  });

  return workflow;
}

/**
 * Build a dual-character scene workflow with IPAdapter FaceID + 2 FaceDetailer passes.
 * Used when two characters appear in the same image.
 */
export function buildDualCharacterWorkflow(params: DualCharacterWorkflowParams): Record<string, any> {
  const neg = params.negativePrompt || DEFAULT_NEGATIVE_PROMPT_DUAL;
  const prefix = params.filenamePrefix || 'scene';
  const ipaWeight = params.ipadapterWeight ?? 0.7;

  const workflow = buildSingleCharacterWorkflow({
    ...params,
    negativePrompt: neg,
    ipadapterWeight: ipaWeight,
    filenamePrefix: prefix,
  });

  // Determine the last LoRA node ID for downstream references
  const loraCount = (params.loras && params.loras.length > 0)
    ? Math.min(params.loras.length, 4)
    : 1;
  const lastLora = LORA_NODE_IDS[loraCount - 1];

  // Add secondary character FaceDetailer (Pass 2)
  // Node 50: Secondary face prompt
  workflow['50'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: params.secondaryFacePrompt, clip: [lastLora, 1] },
  };

  // Node 51: FaceDetailer Pass 2 — takes output from Pass 1 (node 12)
  workflow['51'] = {
    class_type: 'FaceDetailer',
    inputs: {
      image: ['12', 0],
      model: [lastLora, 0],
      clip: [lastLora, 1],
      vae: ['1', 2],
      positive: ['50', 0],
      negative: ['4', 0],
      bbox_detector: ['10', 0],
      sam_model_opt: ['11', 0],
      guide_size: 512,
      guide_size_for: true,
      max_size: 1024,
      seed: params.secondarySeed,
      steps: 20,
      cfg: params.cfg || 7,
      sampler_name: params.samplerName || 'euler_ancestral',
      scheduler: 'normal',
      denoise: 0.4,
      feather: 5,
      noise_mask: true,
      force_inpaint: true,
      bbox_threshold: 0.5,
      bbox_dilation: 10,
      bbox_crop_factor: 3.0,
      sam_detection_hint: 'center-1',
      sam_dilation: 0,
      sam_threshold: 0.93,
      sam_bbox_expansion: 0,
      sam_mask_hint_threshold: 0.7,
      sam_mask_hint_use_negative: 'False',
      drop_size: 10,
      wildcard: '',
      cycle: 1,
      inpaint_model: false,
      noise_mask_feather: 20,
    },
  };

  // Update SaveImage to take from Pass 2 output instead of Pass 1
  workflow['20'] = {
    class_type: 'SaveImage',
    inputs: { images: ['51', 0], filename_prefix: prefix },
  };

  return workflow;
}

/**
 * High-level function that selects the right workflow based on the scene configuration.
 * This is the main entry point for the pipeline integration (Phase 6).
 */
export function buildWorkflow(config: {
  type: WorkflowType;
  positivePrompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  seed: number;
  filenamePrefix?: string;
  primaryRefImageName?: string;
  primaryFacePrompt?: string;
  ipadapterWeight?: number;
  secondaryFacePrompt?: string;
  secondarySeed?: number;
  loras?: LoraInput[];
  negativePromptAdditions?: string;
  /** Checkpoint model filename. Defaults to DEFAULT_MODEL. */
  checkpointName?: string;
  /** Override CFG scale (default 7) */
  cfg?: number;
  /** Override sampler name (default 'euler_ancestral') */
  samplerName?: string;
}): Record<string, any> {
  switch (config.type) {
    case 'portrait':
      return buildPortraitWorkflow({
        positivePrompt: config.positivePrompt,
        negativePrompt: config.negativePrompt,
        width: config.width,
        height: config.height,
        seed: config.seed,
        filenamePrefix: config.filenamePrefix,
        loras: config.loras,
        negativePromptAdditions: config.negativePromptAdditions,
        checkpointName: config.checkpointName,
        cfg: config.cfg,
        samplerName: config.samplerName,
      });

    case 'single-character':
      if (!config.primaryRefImageName || !config.primaryFacePrompt) {
        throw new Error('Single-character workflow requires primaryRefImageName and primaryFacePrompt');
      }
      return buildSingleCharacterWorkflow({
        positivePrompt: config.positivePrompt,
        negativePrompt: config.negativePrompt,
        width: config.width,
        height: config.height,
        seed: config.seed,
        filenamePrefix: config.filenamePrefix,
        primaryRefImageName: config.primaryRefImageName,
        primaryFacePrompt: config.primaryFacePrompt,
        ipadapterWeight: config.ipadapterWeight,
        loras: config.loras,
        negativePromptAdditions: config.negativePromptAdditions,
        checkpointName: config.checkpointName,
        cfg: config.cfg,
        samplerName: config.samplerName,
      });

    case 'dual-character':
      if (!config.primaryRefImageName || !config.primaryFacePrompt || !config.secondaryFacePrompt || config.secondarySeed === undefined) {
        throw new Error('Dual-character workflow requires primary and secondary character data');
      }
      return buildDualCharacterWorkflow({
        positivePrompt: config.positivePrompt,
        negativePrompt: config.negativePrompt,
        width: config.width,
        height: config.height,
        seed: config.seed,
        filenamePrefix: config.filenamePrefix,
        primaryRefImageName: config.primaryRefImageName,
        primaryFacePrompt: config.primaryFacePrompt,
        ipadapterWeight: config.ipadapterWeight,
        secondaryFacePrompt: config.secondaryFacePrompt,
        secondarySeed: config.secondarySeed,
        loras: config.loras,
        negativePromptAdditions: config.negativePromptAdditions,
        checkpointName: config.checkpointName,
        cfg: config.cfg,
        samplerName: config.samplerName,
      });

    default:
      throw new Error(`Unknown workflow type: ${config.type}`);
  }
}
