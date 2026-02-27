import { DEFAULT_MODEL } from './model-registry';

type WorkflowType = 'portrait' | 'single-character' | 'dual-character' | 'multi-pass';

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
  /** Override CFG scale (default 8.5 portrait/single, 8.0 dual) */
  cfg?: number;
  /** Override sampler name (default 'dpmpp_2m') */
  samplerName?: string;
  /** Skip the FaceDetailer pass (debug mode — saves directly from VAEDecode) */
  skipFaceDetailer?: boolean;
  /** Enable hires fix (two-pass generation with latent upscale). Roughly doubles generation time. */
  hiresFixEnabled?: boolean;
  /** Hires fix upscale factor (default 1.25) */
  hiresFixScale?: number;
  /** Hires fix denoise strength (default 0.45) */
  hiresFixDenoise?: number;
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
  'ugly, deformed, noisy, blurry, low contrast, cartoon, anime, sketch, painting, watermark, text, bad anatomy, bad hands, (wrong number of fingers, extra fingers, missing fingers:1.2), extra limbs, disfigured, mutation, poorly drawn face, poorly drawn hands, distorted face, cross-eyed, out of frame, cropped, worst quality, low quality, jpeg artifacts, airbrushed skin, plastic skin, smooth skin, artificial skin, waxy skin, doll-like, (overexposed:1.2), (underexposed:1.2), (oversaturated:1.2), flat lighting, harsh shadows, amateur photography, (extra people:1.3), wrong ethnicity, wrong race';

const DEFAULT_NEGATIVE_PROMPT_DUAL =
  DEFAULT_NEGATIVE_PROMPT + ', (three people, crowd, group, third person:1.4)';

/** Node IDs for up to 6 chained LoRA loaders */
const LORA_NODE_IDS = ['2', '2a', '2b', '2c', '2d', '2e'] as const;

/**
 * Build a chain of LoRA loader nodes and add them to the workflow.
 * Returns the node ID of the last LoRA loader in the chain (all downstream
 * nodes should reference this for model/clip).
 */
function buildLoraChain(
  workflow: Record<string, any>,
  loras?: LoraInput[],
): string {
  // Explicit empty array means "no LoRAs" (debug mode). Undefined means "use default".
  if (loras && loras.length === 0) {
    // No LoRA nodes — downstream nodes connect directly to checkpoint loader (node 1)
    return '1';
  }

  // Default to single detail-tweaker-xl if no loras provided
  const loraStack = (loras && loras.length > 0) ? loras : [
    { filename: 'detail-tweaker-xl.safetensors', strengthModel: 0.5, strengthClip: 0.5 },
  ];

  // Cap at 6 LoRAs
  const capped = loraStack.slice(0, 6);

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
 * Insert hires fix nodes into a workflow between the base KSampler and VAEDecode.
 * Chain: KSampler(6) → LatentUpscale(60) → HiresKSampler(61) → VAEDecode(7)
 */
function applyHiresFix(
  workflow: Record<string, any>,
  params: WorkflowParams,
  modelSource: string,
  cfg: number,
  sampler: string,
): void {
  // Node 60: Latent Upscale — upscale the KSampler output before VAE decode
  workflow['60'] = {
    class_type: 'LatentUpscaleBy',
    inputs: {
      samples: ['6', 0],
      upscale_method: 'bislerp',
      scale_by: params.hiresFixScale || 1.25,
    },
  };

  // Node 61: Second KSampler pass — refine the upscaled latent
  workflow['61'] = {
    class_type: 'KSampler',
    inputs: {
      model: [modelSource, 0],
      positive: ['3', 0],
      negative: ['4', 0],
      latent_image: ['60', 0],
      seed: params.seed + 1,
      steps: 20,
      cfg: cfg - 0.5,
      sampler_name: sampler,
      scheduler: 'karras',
      denoise: params.hiresFixDenoise || 0.45,
    },
  };

  // Update VAEDecode to take from hires KSampler instead of base KSampler
  workflow['7'] = {
    class_type: 'VAEDecode',
    inputs: { samples: ['61', 0], vae: ['1', 2] },
  };
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
  const cfg = params.cfg || 8.5;
  const sampler = params.samplerName || 'dpmpp_2m';

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
        steps: 40,
        cfg,
        sampler_name: sampler,
        scheduler: 'karras',
        denoise: 1.0,
      },
    },
    '7': {
      class_type: 'VAEDecode',
      inputs: { samples: ['6', 0], vae: ['1', 2] },
    },
  });

  // Hires fix: upscale latent and refine with second KSampler pass
  // Uses lastLora as model source since portrait workflow has no IPAdapter
  if (params.hiresFixEnabled) {
    applyHiresFix(workflow, params, lastLora, cfg, sampler);
  }

  // FaceDetailer pass — skip in debug mode to isolate its effect on output
  if (!params.skipFaceDetailer) {
    Object.assign(workflow, {
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
          steps: 25,
          cfg,
          sampler_name: sampler,
          scheduler: 'karras',
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
    });
  }

  // SaveImage — connect to FaceDetailer output (node 12) or VAEDecode (node 7) if skipped
  workflow['20'] = {
    class_type: 'SaveImage',
    inputs: {
      images: [params.skipFaceDetailer ? '7' : '12', 0],
      filename_prefix: prefix,
    },
  };

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
  const cfg = params.cfg || 8.5;
  const sampler = params.samplerName || 'dpmpp_2m';

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
        steps: 40,
        cfg,
        sampler_name: sampler,
        scheduler: 'karras',
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
        steps: 25,
        cfg,
        sampler_name: sampler,
        scheduler: 'karras',
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

  // Hires fix: upscale latent and refine with second KSampler pass
  // Uses '32' (IPAdapter output) as model source to preserve face identity
  if (params.hiresFixEnabled) {
    applyHiresFix(workflow, params, '32', cfg, sampler);
  }

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
  // Dual-character scenes use slightly lower CFG (8.0) because the prompt is
  // more complex (two character descriptions + scene) and needs room to breathe.
  const dualCfg = params.cfg || 8.0;

  const workflow = buildSingleCharacterWorkflow({
    ...params,
    cfg: dualCfg,
    negativePrompt: neg,
    ipadapterWeight: ipaWeight,
    filenamePrefix: prefix,
  });

  // Determine the last LoRA node ID for downstream references
  const loraCount = (params.loras && params.loras.length > 0)
    ? Math.min(params.loras.length, 6)
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
      steps: 25,
      cfg: dualCfg,
      sampler_name: params.samplerName || 'dpmpp_2m',
      scheduler: 'karras',
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

// ---------------------------------------------------------------------------
// Multi-Pass Workflow
// ---------------------------------------------------------------------------

interface MultiPassWorkflowParams {
  // Pass 1 — Composition (scene layout, poses, objects)
  /** Raw scene description: actions, poses, spatial layout, objects, setting, lighting.
   *  No character tags, no trigger words, no quality prefix. */
  scenePrompt: string;

  // Pass 2 — Character Identity
  /** Condensed identity prompt: "tok, female, Black South African, medium-brown skin, black braids" */
  primaryIdentityPrompt: string;
  /** For dual-character scenes: identity prompt for the second character */
  secondaryIdentityPrompt?: string;

  // Pass 3 — Detail & Beauty Refinement
  /** Full assembled prompt with quality prefix, all tags, enhancement */
  fullPrompt: string;

  // Pass 4 — Face Refinement
  /** Face-specific prompt for primary character's FaceDetailer */
  primaryFacePrompt: string;
  /** Face-specific prompt for secondary character's FaceDetailer */
  secondaryFacePrompt?: string;
  /** Seed for secondary character's FaceDetailer */
  secondarySeed?: number;

  // Standard params
  negativePrompt?: string;
  width: number;
  height: number;
  seed: number;
  filenamePrefix?: string;
  /** Quality/beauty LoRAs for Pass 3 (full stack from selectResources) */
  loras?: LoraInput[];
  /** Character LoRAs for Pass 2 */
  characterLoras?: LoraInput[];
  negativePromptAdditions?: string;
  checkpointName?: string;
}

/**
 * Build a LoRA chain at custom node IDs for multi-pass workflows.
 * Each pass needs its own checkpoint + LoRA chain because different passes
 * load different LoRA stacks.
 *
 * @param workflow - The workflow graph object to mutate
 * @param checkpointNodeId - Node ID for the CheckpointLoaderSimple
 * @param loraNodeIdPrefix - Numeric prefix for LoRA node IDs (e.g. 101 → "101","102",...)
 * @param loras - LoRA stack to load (empty array = no LoRAs, connect directly to checkpoint)
 * @param checkpointName - Model filename
 * @returns The node ID that downstream nodes should reference for model/clip
 */
function buildPassLoraChain(
  workflow: Record<string, any>,
  checkpointNodeId: string,
  loraNodeIdPrefix: number,
  loras: LoraInput[],
  checkpointName: string,
): string {
  // Checkpoint loader for this pass
  workflow[checkpointNodeId] = {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: checkpointName },
  };

  if (loras.length === 0) {
    return checkpointNodeId;
  }

  const capped = loras.slice(0, 6);
  let lastNodeId = checkpointNodeId;

  for (let i = 0; i < capped.length; i++) {
    const nodeId = String(loraNodeIdPrefix + i);
    const lora = capped[i];

    workflow[nodeId] = {
      class_type: 'LoraLoader',
      inputs: {
        lora_name: lora.filename,
        strength_model: lora.strengthModel,
        strength_clip: lora.strengthClip,
        model: [lastNodeId, 0],
        clip: [lastNodeId, 1],
      },
    };
    lastNodeId = nodeId;
  }

  return lastNodeId;
}

/**
 * Build a multi-pass workflow for story scene images.
 *
 * 4 sequential passes in a single ComfyUI graph (one RunPod job):
 *
 * Pass 1 — COMPOSITION: scene-only prompt at low resolution (512×768).
 *   Gets the layout, poses, objects, and spatial composition right without
 *   character identity noise competing for CLIP attention.
 *
 * Pass 2 — CHARACTER IDENTITY: LatentUpscale to target res → img2img with
 *   character LoRAs + condensed identity tags. Burns the character's face
 *   and body into the composed scene.
 *
 * Pass 3 — DETAIL & BEAUTY REFINEMENT: img2img with full LoRA stack and
 *   complete prompt including enhancement tags. Adds skin detail, eyes,
 *   cinematic lighting, body refinement.
 *
 * Pass 4 — FACE REFINEMENT: FaceDetailer pass(es) using the character-LoRA
 *   model from Pass 2 for LoRA-aware face inpainting.
 *
 * Node ID scheme:
 *   100s = Pass 1 (composition)
 *   200s = Pass 2 (character identity)
 *   300s = Pass 3 (detail refinement)
 *   400s = Pass 4 (face refinement)
 *   500  = SaveImage
 */
export function buildMultiPassWorkflow(params: MultiPassWorkflowParams): Record<string, any> {
  const ckpt = params.checkpointName || DEFAULT_MODEL;
  const baseNeg = params.negativePrompt || DEFAULT_NEGATIVE_PROMPT;
  const neg = buildNeg(baseNeg, params.negativePromptAdditions);
  const prefix = params.filenamePrefix || 'multipass';
  const hasDualCharacter = !!params.secondaryIdentityPrompt;

  // Use dual-character negative for two-person scenes
  const negBase = hasDualCharacter
    ? (params.negativePrompt || DEFAULT_NEGATIVE_PROMPT_DUAL)
    : (params.negativePrompt || DEFAULT_NEGATIVE_PROMPT);
  const negFull = buildNeg(negBase, params.negativePromptAdditions);

  // Composition resolution: half-resolution for fast layout generation
  const compWidth = Math.round(params.width / 1.6);   // 832→520, 1216→760
  const compHeight = Math.round(params.height / 1.6);  // 1216→760, 832→520

  const workflow: Record<string, any> = {};

  // =========================================================================
  // PASS 1 — COMPOSITION
  // Scene-only prompt, detail-tweaker LoRA only, full generation from noise
  // =========================================================================
  const detailTweakerOnly: LoraInput[] = [
    { filename: 'detail-tweaker-xl.safetensors', strengthModel: 0.5, strengthClip: 0.5 },
  ];
  const pass1Model = buildPassLoraChain(workflow, '100', 101, detailTweakerOnly, ckpt);

  // Pass 1 positive: scene-only, no character tags
  workflow['110'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: params.scenePrompt, clip: [pass1Model, 1] },
  };
  // Pass 1 negative
  workflow['111'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: neg + ', (bad anatomy, extra limbs:1.2)', clip: [pass1Model, 1] },
  };
  // Empty latent at composition resolution
  workflow['112'] = {
    class_type: 'EmptyLatentImage',
    inputs: { width: compWidth, height: compHeight, batch_size: 1 },
  };
  // KSampler — full generation
  workflow['113'] = {
    class_type: 'KSampler',
    inputs: {
      model: [pass1Model, 0],
      positive: ['110', 0],
      negative: ['111', 0],
      latent_image: ['112', 0],
      seed: params.seed,
      steps: 20,
      cfg: 11,
      sampler_name: 'dpmpp_2m',
      scheduler: 'karras',
      denoise: 1.0,
    },
  };

  // =========================================================================
  // PASS 2 — CHARACTER IDENTITY
  // Upscale to target resolution, apply character LoRAs via img2img
  // =========================================================================

  // Character LoRAs + melanin/skin (caller separates these from the quality stack)
  const pass2Loras = params.characterLoras || [];
  const pass2Model = buildPassLoraChain(workflow, '200', 201, pass2Loras, ckpt);

  // Latent upscale: bislerp from composition res to target res
  workflow['212'] = {
    class_type: 'LatentUpscale',
    inputs: {
      samples: ['113', 0],
      upscale_method: 'bislerp',
      width: params.width,
      height: params.height,
      crop: 'disabled',
    },
  };

  // Pass 2 positive: trigger words + condensed identity + scene prompt
  let pass2PositiveText: string;
  if (hasDualCharacter && params.secondaryIdentityPrompt) {
    // Spatial prompting for dual characters
    pass2PositiveText = `on the left side of image: ${params.primaryIdentityPrompt}. on the right side of image: ${params.secondaryIdentityPrompt}. ${params.scenePrompt}`;
  } else {
    pass2PositiveText = `${params.primaryIdentityPrompt}, ${params.scenePrompt}`;
  }

  workflow['210'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: pass2PositiveText, clip: [pass2Model, 1] },
  };
  workflow['211'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: negFull, clip: [pass2Model, 1] },
  };

  // KSampler — img2img on upscaled Pass 1 latent
  workflow['213'] = {
    class_type: 'KSampler',
    inputs: {
      model: [pass2Model, 0],
      positive: ['210', 0],
      negative: ['211', 0],
      latent_image: ['212', 0],
      seed: params.seed + 1,
      steps: 30,
      cfg: 8.5,
      sampler_name: 'dpmpp_2m',
      scheduler: 'karras',
      denoise: 0.5,
    },
  };

  // =========================================================================
  // PASS 3 — DETAIL & BEAUTY REFINEMENT
  // Full LoRA stack, full assembled prompt, low denoise
  // =========================================================================

  const pass3Loras = params.loras || detailTweakerOnly;
  const pass3Model = buildPassLoraChain(workflow, '300', 301, pass3Loras, ckpt);

  // Pass 3 positive: full assembled prompt with everything
  workflow['310'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: params.fullPrompt, clip: [pass3Model, 1] },
  };
  workflow['311'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: negFull, clip: [pass3Model, 1] },
  };

  // KSampler — img2img refinement on Pass 2 output
  workflow['313'] = {
    class_type: 'KSampler',
    inputs: {
      model: [pass3Model, 0],
      positive: ['310', 0],
      negative: ['311', 0],
      latent_image: ['213', 0],
      seed: params.seed + 2,
      steps: 25,
      cfg: 7.5,
      sampler_name: 'dpmpp_2m',
      scheduler: 'karras',
      denoise: 0.3,
    },
  };

  // =========================================================================
  // PASS 4 — FACE REFINEMENT (FaceDetailer)
  // Uses the Pass 2 model (character LoRAs active) for LoRA-aware inpainting
  // =========================================================================

  // VAE decode Pass 3 latent → pixel space for FaceDetailer
  workflow['400'] = {
    class_type: 'VAEDecode',
    inputs: { samples: ['313', 0], vae: ['200', 2] },
  };

  // Shared face detection models
  workflow['401'] = {
    class_type: 'UltralyticsDetectorProvider',
    inputs: { model_name: 'bbox/face_yolov8m.pt' },
  };
  workflow['402'] = {
    class_type: 'SAMLoader',
    inputs: { model_name: 'sam_vit_b_01ec64.pth', device_mode: 'AUTO' },
  };

  // Primary face prompt CLIP encode (uses Pass 2 model for LoRA-aware encoding)
  workflow['410'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: params.primaryFacePrompt, clip: [pass2Model, 1] },
  };

  // Primary FaceDetailer
  workflow['411'] = {
    class_type: 'FaceDetailer',
    inputs: {
      image: ['400', 0],
      model: [pass2Model, 0],
      clip: [pass2Model, 1],
      vae: ['200', 2],
      positive: ['410', 0],
      negative: ['211', 0],  // reuse Pass 2 negative
      bbox_detector: ['401', 0],
      sam_model_opt: ['402', 0],
      guide_size: 512,
      guide_size_for: true,
      max_size: 1024,
      seed: params.seed,
      steps: 25,
      cfg: 8.5,
      sampler_name: 'dpmpp_2m',
      scheduler: 'karras',
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
  };

  // For dual-character: second FaceDetailer chained after the first
  let finalImageNode = '411';

  if (hasDualCharacter && params.secondaryFacePrompt) {
    // Secondary face prompt
    workflow['420'] = {
      class_type: 'CLIPTextEncode',
      inputs: { text: params.secondaryFacePrompt, clip: [pass2Model, 1] },
    };

    // Secondary FaceDetailer — takes output from primary FaceDetailer
    workflow['421'] = {
      class_type: 'FaceDetailer',
      inputs: {
        image: ['411', 0],   // chain from primary FaceDetailer output
        model: [pass2Model, 0],
        clip: [pass2Model, 1],
        vae: ['200', 2],
        positive: ['420', 0],
        negative: ['211', 0],
        bbox_detector: ['401', 0],
        sam_model_opt: ['402', 0],
        guide_size: 512,
        guide_size_for: true,
        max_size: 1024,
        seed: params.secondarySeed ?? params.seed + 100,
        steps: 25,
        cfg: 8.5,
        sampler_name: 'dpmpp_2m',
        scheduler: 'karras',
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
    };

    finalImageNode = '421';
  }

  // =========================================================================
  // OUTPUT
  // =========================================================================
  workflow['500'] = {
    class_type: 'SaveImage',
    inputs: {
      images: [finalImageNode, 0],
      filename_prefix: prefix,
    },
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
  /** Override CFG scale (default 7.5) */
  cfg?: number;
  /** Override sampler name (default 'dpmpp_2m') */
  samplerName?: string;
  /** Skip the FaceDetailer pass (debug mode) */
  skipFaceDetailer?: boolean;
  /** Enable hires fix (two-pass generation with latent upscale) */
  hiresFixEnabled?: boolean;
  /** Hires fix upscale factor (default 1.25) */
  hiresFixScale?: number;
  /** Hires fix denoise strength (default 0.45) */
  hiresFixDenoise?: number;
  // Multi-pass specific fields
  /** Pass 1 scene-only prompt (no character tags) */
  scenePrompt?: string;
  /** Pass 2 condensed identity prompt for primary character */
  primaryIdentityPrompt?: string;
  /** Pass 2 condensed identity prompt for secondary character */
  secondaryIdentityPrompt?: string;
  /** Pass 3 full assembled prompt */
  fullPrompt?: string;
  /** Character LoRAs for Pass 2 (separate from quality LoRAs) */
  characterLoras?: LoraInput[];
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
        skipFaceDetailer: config.skipFaceDetailer,
        hiresFixEnabled: config.hiresFixEnabled,
        hiresFixScale: config.hiresFixScale,
        hiresFixDenoise: config.hiresFixDenoise,
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
        hiresFixEnabled: config.hiresFixEnabled,
        hiresFixScale: config.hiresFixScale,
        hiresFixDenoise: config.hiresFixDenoise,
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
        hiresFixEnabled: config.hiresFixEnabled,
        hiresFixScale: config.hiresFixScale,
        hiresFixDenoise: config.hiresFixDenoise,
      });

    case 'multi-pass':
      if (!config.scenePrompt || !config.primaryIdentityPrompt || !config.fullPrompt || !config.primaryFacePrompt) {
        throw new Error('Multi-pass workflow requires scenePrompt, primaryIdentityPrompt, fullPrompt, and primaryFacePrompt');
      }
      return buildMultiPassWorkflow({
        scenePrompt: config.scenePrompt,
        primaryIdentityPrompt: config.primaryIdentityPrompt,
        secondaryIdentityPrompt: config.secondaryIdentityPrompt,
        fullPrompt: config.fullPrompt,
        primaryFacePrompt: config.primaryFacePrompt,
        secondaryFacePrompt: config.secondaryFacePrompt,
        secondarySeed: config.secondarySeed,
        negativePrompt: config.negativePrompt,
        width: config.width,
        height: config.height,
        seed: config.seed,
        filenamePrefix: config.filenamePrefix,
        loras: config.loras,
        characterLoras: config.characterLoras,
        negativePromptAdditions: config.negativePromptAdditions,
        checkpointName: config.checkpointName,
      });

    default:
      throw new Error(`Unknown workflow type: ${config.type}`);
  }
}
