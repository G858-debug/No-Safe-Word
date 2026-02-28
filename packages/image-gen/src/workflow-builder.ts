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
  'ugly, deformed, noisy, blurry, low contrast, cartoon, anime, sketch, painting, watermark, text, bad anatomy, bad hands, (wrong number of fingers, extra fingers, missing fingers:1.2), extra limbs, disfigured, mutation, poorly drawn face, poorly drawn hands, distorted face, cross-eyed, out of frame, cropped, worst quality, low quality, jpeg artifacts, airbrushed skin, plastic skin, smooth skin, artificial skin, waxy skin, doll-like, (overexposed:1.2), (underexposed:1.2), (oversaturated:1.2), flat lighting, harsh shadows, amateur photography, (extra people:1.3), wrong ethnicity, wrong race, (film grain:1.1), (noise:1.1), (grainy:1.1), (noisy skin:1.1)';

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

  // Pass 3 — Quality Refinement (gender-neutral LoRAs only)
  /** Full assembled prompt with quality prefix, all tags, enhancement */
  fullPrompt: string;

  // Pass 4 — Per-Character Person Inpainting
  /** Gender-specific LoRAs for primary character's person inpainting pass */
  primaryGenderLoras?: LoraInput[];
  /** Gender-specific LoRAs for secondary character's person inpainting pass */
  secondaryGenderLoras?: LoraInput[];
  /** Primary character's gender — controls inpainting prompt adjustments */
  primaryGender?: 'male' | 'female';
  /** Secondary character's gender */
  secondaryGender?: 'male' | 'female';

  // Pass 5 — Face Refinement
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
  /** Gender-neutral quality LoRAs for Pass 3 */
  loras?: LoraInput[];
  /** Character LoRAs for Pass 2 */
  characterLoras?: LoraInput[];
  negativePromptAdditions?: string;
  checkpointName?: string;
}

/**
 * Build a LoRA chain at custom node IDs for multi-pass workflows.
 * Different passes load different LoRA stacks but share a single checkpoint
 * to avoid VRAM exhaustion from multiple ~6.5GB model copies.
 *
 * @param workflow - The workflow graph object to mutate
 * @param sharedCheckpointNodeId - Node ID of the shared CheckpointLoaderSimple (must already exist in workflow)
 * @param loraNodeIdPrefix - Numeric prefix for LoRA node IDs (e.g. 101 → "101","102",...)
 * @param loras - LoRA stack to load (empty array = no LoRAs, connect directly to checkpoint)
 * @returns The node ID that downstream nodes should reference for model/clip
 */
function buildPassLoraChain(
  workflow: Record<string, any>,
  sharedCheckpointNodeId: string,
  loraNodeIdPrefix: number,
  loras: LoraInput[],
): string {
  if (loras.length === 0) {
    return sharedCheckpointNodeId;
  }

  const capped = loras.slice(0, 6);
  let lastNodeId = sharedCheckpointNodeId;

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
 * Build a 6-pass multi-pass workflow for story scene images.
 *
 * Pass 1 — COMPOSITION: scene-only prompt at low resolution.
 * Pass 2 — CHARACTER IDENTITY: upscale + character LoRAs (no body/gender LoRAs).
 * Pass 3 — QUALITY REFINEMENT: gender-neutral LoRAs only.
 * Pass 4a — PRIMARY PERSON INPAINT: person detection → inpaint with primary char LoRA + gender LoRAs.
 * Pass 4b — SECONDARY PERSON INPAINT (dual-character only): same for secondary character.
 * Pass 5a — PRIMARY FACE: FaceDetailer with primary char LoRA.
 * Pass 5b — SECONDARY FACE (dual-character only): FaceDetailer with secondary char LoRA.
 *
 * Node ID scheme:
 *   100s = Pass 1 (composition)
 *   200s = Pass 2 (character identity)
 *   300s = Pass 3 (quality refinement)
 *   400s = Pass 4 (person inpainting — 404-412 primary, 416-432 secondary)
 *   500s = Pass 5 (face refinement — 510-511 primary, 520-521 secondary)
 *   600  = SaveImage
 */
export function buildMultiPassWorkflow(params: MultiPassWorkflowParams): Record<string, any> {
  const ckpt = params.checkpointName || DEFAULT_MODEL;
  const prefix = params.filenamePrefix || 'multipass';
  const hasDualCharacter = !!params.secondaryIdentityPrompt;

  const negBase = hasDualCharacter
    ? (params.negativePrompt || DEFAULT_NEGATIVE_PROMPT_DUAL)
    : (params.negativePrompt || DEFAULT_NEGATIVE_PROMPT);
  const negFull = buildNeg(negBase, params.negativePromptAdditions);

  // Composition resolution: reduced for fast layout generation
  const compWidth = Math.round(params.width / 1.6);
  const compHeight = Math.round(params.height / 1.6);

  const workflow: Record<string, any> = {};

  // Single shared checkpoint — all passes reference this node for model/clip/vae.
  // This avoids loading 6+ copies of the ~6.5GB checkpoint into VRAM.
  const CKPT_NODE = '100';
  workflow[CKPT_NODE] = {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: ckpt },
  };

  // =========================================================================
  // PASS 1 — COMPOSITION
  // Scene-only prompt, detail-tweaker only, full generation from noise
  // =========================================================================
  const detailTweakerOnly: LoraInput[] = [
    { filename: 'detail-tweaker-xl.safetensors', strengthModel: 0.5, strengthClip: 0.5 },
  ];
  const pass1Model = buildPassLoraChain(workflow, CKPT_NODE, 101, detailTweakerOnly);

  workflow['110'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: params.scenePrompt, clip: [pass1Model, 1] },
  };
  workflow['111'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: negFull + ', (bad anatomy, extra limbs:1.2)', clip: [pass1Model, 1] },
  };
  workflow['112'] = {
    class_type: 'EmptyLatentImage',
    inputs: { width: compWidth, height: compHeight, batch_size: 1 },
  };
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
  // Upscale to target res, apply ONLY the PRIMARY character LoRA.
  // Secondary character LoRA is deferred to Pass 4b/5b to avoid
  // cross-contamination (e.g. female LoRA overpowering male character).
  // =========================================================================
  const pass2Loras = params.characterLoras?.slice(0, 1) || [];
  const pass2Model = buildPassLoraChain(workflow, CKPT_NODE, 201, pass2Loras);

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

  let pass2PositiveText: string;
  if (hasDualCharacter) {
    // Only embed primary character identity in Pass 2.
    // Secondary character is described generically here to reserve spatial
    // placement; their LoRA activates later in Pass 4b/5b.
    pass2PositiveText = `${params.primaryIdentityPrompt}, ${params.scenePrompt}, two people in scene`;
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
  workflow['213'] = {
    class_type: 'KSampler',
    inputs: {
      model: [pass2Model, 0],
      positive: ['210', 0],
      negative: ['211', 0],
      latent_image: ['212', 0],
      seed: params.seed + 1,
      steps: 35,
      cfg: 8.5,
      sampler_name: 'dpmpp_2m',
      scheduler: 'karras',
      denoise: 0.55,
    },
  };

  // =========================================================================
  // PASS 3 — QUALITY REFINEMENT
  // Gender-NEUTRAL LoRAs only: detail-tweaker, realistic-skin, melanin-mix,
  // cinecolor, eyes-detail, etc. NO curvy-body, NO braids, NO better-bodies.
  // =========================================================================
  const pass3Loras = params.loras || detailTweakerOnly;
  const pass3Model = buildPassLoraChain(workflow, CKPT_NODE, 301, pass3Loras);

  workflow['310'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: params.fullPrompt, clip: [pass3Model, 1] },
  };
  workflow['311'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: negFull, clip: [pass3Model, 1] },
  };
  workflow['313'] = {
    class_type: 'KSampler',
    inputs: {
      model: [pass3Model, 0],
      positive: ['310', 0],
      negative: ['311', 0],
      latent_image: ['213', 0],
      seed: params.seed + 2,
      steps: 25,
      cfg: 7.0,
      sampler_name: 'dpmpp_2m',
      scheduler: 'karras',
      denoise: 0.25,
    },
  };

  // =========================================================================
  // PASS 4 — PER-CHARACTER PERSON INPAINTING
  // Uses person detection (full body bbox) to isolate each character,
  // then inpaints with that character's LoRA + gender-specific body LoRAs.
  // This ensures female LoRAs only touch female characters and vice versa.
  // =========================================================================

  // VAE decode Pass 3 latent → pixel space for person detection
  workflow['400'] = {
    class_type: 'VAEDecode',
    inputs: { samples: ['313', 0], vae: ['100', 2] },
  };

  // Person detection model (full body, not just face)
  workflow['401'] = {
    class_type: 'UltralyticsDetectorProvider',
    inputs: { model_name: 'segm/person_yolov8m-seg.pt' },
  };
  // SAM for precise masking
  workflow['402'] = {
    class_type: 'SAMLoader',
    inputs: { model_name: 'sam_vit_b_01ec64.pth', device_mode: 'AUTO' },
  };

  // --- Pass 4a: Primary character person inpaint ---
  const pass4aLoras: LoraInput[] = [
    ...(params.characterLoras?.slice(0, 1) || []),  // Primary char LoRA only
    ...(params.primaryGenderLoras || []),
  ];
  const pass4aModel = buildPassLoraChain(workflow, CKPT_NODE, 404, pass4aLoras);

  workflow['410'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: `${params.primaryIdentityPrompt}, ${params.scenePrompt}`, clip: [pass4aModel, 1] },
  };
  workflow['411'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: negFull, clip: [pass4aModel, 1] },
  };

  // Primary person inpainting via FaceDetailer with person detection model
  workflow['412'] = {
    class_type: 'FaceDetailer',
    inputs: {
      image: ['400', 0],
      model: [pass4aModel, 0],
      clip: [pass4aModel, 1],
      vae: ['100', 2],
      positive: ['410', 0],
      negative: ['411', 0],
      bbox_detector: ['401', 0],
      sam_model_opt: ['402', 0],
      guide_size: 768,
      guide_size_for: true,
      max_size: 1024,
      seed: params.seed + 3,
      steps: 25,
      cfg: 7.5,
      sampler_name: 'dpmpp_2m',
      scheduler: 'karras',
      denoise: 0.30,
      feather: 8,
      noise_mask: true,
      force_inpaint: true,
      bbox_threshold: 0.5,
      bbox_dilation: 15,
      bbox_crop_factor: 1.5,
      sam_detection_hint: 'center-1',
      sam_dilation: 0,
      sam_threshold: 0.93,
      sam_bbox_expansion: 0,
      sam_mask_hint_threshold: 0.7,
      sam_mask_hint_use_negative: 'False',
      drop_size: 20,
      wildcard: '',
      cycle: 1,
      inpaint_model: false,
      noise_mask_feather: 20,
    },
  };

  let lastPersonNode = '412';

  // --- Pass 4b: Secondary character person inpaint (dual-character only) ---
  let pass4bModel: string | undefined;

  if (hasDualCharacter) {
    const pass4bLoras: LoraInput[] = [
      ...(params.characterLoras?.slice(1, 2) || []),  // Secondary char LoRA only
      ...(params.secondaryGenderLoras || []),
    ];
    pass4bModel = buildPassLoraChain(workflow, CKPT_NODE, 416, pass4bLoras);

    // Fixed nodes start at 430 to avoid collision with LoRA chain (416+N)
    // when 5+ LoRAs are loaded (char LoRA + 4 female gender LoRAs in NSFW)
    workflow['430'] = {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: params.secondaryIdentityPrompt
          ? `${params.secondaryIdentityPrompt}, ${params.scenePrompt}`
          : params.scenePrompt,
        clip: [pass4bModel, 1],
      },
    };
    workflow['431'] = {
      class_type: 'CLIPTextEncode',
      inputs: { text: negFull, clip: [pass4bModel, 1] },
    };

    workflow['432'] = {
      class_type: 'FaceDetailer',
      inputs: {
        image: ['412', 0],
        model: [pass4bModel, 0],
        clip: [pass4bModel, 1],
        vae: ['100', 2],
        positive: ['430', 0],
        negative: ['431', 0],
        bbox_detector: ['401', 0],
        sam_model_opt: ['402', 0],
        guide_size: 768,
        guide_size_for: true,
        max_size: 1024,
        seed: params.secondarySeed ?? params.seed + 100,
        steps: 25,
        cfg: 7.5,
        sampler_name: 'dpmpp_2m',
        scheduler: 'karras',
        denoise: 0.30,
        feather: 8,
        noise_mask: true,
        force_inpaint: true,
        bbox_threshold: 0.5,
        bbox_dilation: 15,
        bbox_crop_factor: 1.5,
        sam_detection_hint: 'center-1',
        sam_dilation: 0,
        sam_threshold: 0.93,
        sam_bbox_expansion: 0,
        sam_mask_hint_threshold: 0.7,
        sam_mask_hint_use_negative: 'False',
        drop_size: 20,
        wildcard: '',
        cycle: 1,
        inpaint_model: false,
        noise_mask_feather: 20,
      },
    };

    lastPersonNode = '432';
  }

  // =========================================================================
  // PASS 5 — FACE REFINEMENT (FaceDetailer)
  // Uses face detection (not person) for tight face-only inpainting.
  // Each character gets their own FaceDetailer pass with their character LoRA.
  // =========================================================================

  workflow['500'] = {
    class_type: 'UltralyticsDetectorProvider',
    inputs: { model_name: 'bbox/face_yolov8m.pt' },
  };
  workflow['501'] = {
    class_type: 'SAMLoader',
    inputs: { model_name: 'sam_vit_b_01ec64.pth', device_mode: 'AUTO' },
  };

  // --- Pass 5a: Primary face ---
  // Reuse Pass 4a's model (has primary character LoRA loaded)
  workflow['510'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: params.primaryFacePrompt, clip: [pass4aModel, 1] },
  };
  workflow['511'] = {
    class_type: 'FaceDetailer',
    inputs: {
      image: [lastPersonNode, 0],
      model: [pass4aModel, 0],
      clip: [pass4aModel, 1],
      vae: ['100', 2],
      positive: ['510', 0],
      negative: ['411', 0],
      bbox_detector: ['500', 0],
      sam_model_opt: ['501', 0],
      guide_size: 512,
      guide_size_for: true,
      max_size: 1024,
      seed: params.seed + 4,
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

  let finalImageNode = '511';

  // --- Pass 5b: Secondary face (dual-character only) ---
  if (hasDualCharacter && params.secondaryFacePrompt) {
    const secondaryModelForFace = pass4bModel || pass2Model;

    workflow['520'] = {
      class_type: 'CLIPTextEncode',
      inputs: { text: params.secondaryFacePrompt, clip: [secondaryModelForFace, 1] },
    };
    workflow['521'] = {
      class_type: 'FaceDetailer',
      inputs: {
        image: ['511', 0],
        model: [secondaryModelForFace, 0],
        clip: [secondaryModelForFace, 1],
        vae: ['100', 2],
        positive: ['520', 0],
        negative: ['211', 0],
        bbox_detector: ['500', 0],
        sam_model_opt: ['501', 0],
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

    finalImageNode = '521';
  }

  // =========================================================================
  // PASS 7 — CLEANUP / DENOISE
  // Ultra-low denoise pass with base checkpoint only (zero LoRAs) to smooth
  // any grain or noise accumulated across earlier passes without altering
  // composition, identity, or detail.
  // =========================================================================
  // Reuse shared checkpoint (CKPT_NODE) — no extra model load needed
  workflow['701'] = {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: 'photorealistic, sharp focus, clean skin, professional photography, 8k uhd',
      clip: [CKPT_NODE, 1],
    },
  };
  workflow['702'] = {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: '(film grain:1.3), (noise:1.3), (grainy:1.3), (noisy skin:1.3), blurry, jpeg artifacts, low quality',
      clip: [CKPT_NODE, 1],
    },
  };
  workflow['703'] = {
    class_type: 'VAEEncode',
    inputs: { pixels: [finalImageNode, 0], vae: [CKPT_NODE, 2] },
  };
  workflow['704'] = {
    class_type: 'KSampler',
    inputs: {
      model: [CKPT_NODE, 0],
      positive: ['701', 0],
      negative: ['702', 0],
      latent_image: ['703', 0],
      seed: params.seed + 10,
      steps: 15,
      cfg: 5.0,
      sampler_name: 'dpmpp_2m',
      scheduler: 'karras',
      denoise: 0.06,
    },
  };
  workflow['705'] = {
    class_type: 'VAEDecode',
    inputs: { samples: ['704', 0], vae: [CKPT_NODE, 2] },
  };

  // =========================================================================
  // OUTPUT
  // =========================================================================
  workflow['600'] = {
    class_type: 'SaveImage',
    inputs: {
      images: ['705', 0],
      filename_prefix: prefix,
    },
  };

  // Validate all node references point to existing nodes
  const nodeIds = new Set(Object.keys(workflow));
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (!node.inputs) continue;
    for (const [inputName, inputVal] of Object.entries(node.inputs)) {
      if (Array.isArray(inputVal) && inputVal.length === 2 && typeof inputVal[0] === 'string') {
        const refId = inputVal[0] as string;
        if (!nodeIds.has(refId)) {
          console.error(`[MultiPass] BROKEN REFERENCE: Node ${nodeId} (${node.class_type}).${inputName} → node ${refId} does not exist`);
        }
      }
    }
  }

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
  /** Gender-specific LoRAs for primary character's person inpainting pass */
  primaryGenderLoras?: LoraInput[];
  /** Gender-specific LoRAs for secondary character's person inpainting pass */
  secondaryGenderLoras?: LoraInput[];
  /** Primary character's gender */
  primaryGender?: 'male' | 'female';
  /** Secondary character's gender */
  secondaryGender?: 'male' | 'female';
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
        primaryGenderLoras: config.primaryGenderLoras,
        secondaryGenderLoras: config.secondaryGenderLoras,
        primaryGender: config.primaryGender,
        secondaryGender: config.secondaryGender,
      });

    default:
      throw new Error(`Unknown workflow type: ${config.type}`);
  }
}
