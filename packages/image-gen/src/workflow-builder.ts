/**
 * Juggernaut XL Ragnarok ComfyUI workflow builder.
 *
 * Builds SDXL-architecture workflows for Juggernaut Ragnarok (photorealistic).
 * See docs/skills/juggernaut-ragnarok/SKILL.md for checkpoint details.
 *
 * Node architecture:
 *   CheckpointLoaderSimple → LoRA chain → CLIPTextEncode (pos/neg)
 *   → EmptyLatentImage → KSampler → VAEDecode → SaveImage
 */

const DEFAULT_CHECKPOINT = 'Juggernaut-Ragnarok.safetensors';
const DEFAULT_CFG = 4.0;
const DEFAULT_STEPS = 35;
const DEFAULT_SAMPLER = 'dpmpp_2m_sde';
const DEFAULT_SCHEDULER = 'karras';

export interface ControlNetConfig {
  /** Image name for the pose skeleton or reference photo (must match an entry in the job's images array) */
  poseImageName: string;
  /** Conditioning strength (0.0–1.0, default 0.5) */
  strength?: number;
  /** Start applying ControlNet at this % of sampling steps (default 0.0) */
  startPercent?: number;
  /** Stop applying ControlNet at this % of sampling steps (default 1.0) */
  endPercent?: number;
  /** When true, the image is a reference photo — DWPreprocessor extracts the skeleton on the GPU.
   *  When false/undefined, the image is a pre-rendered skeleton PNG (existing behavior). */
  referenceImage?: boolean;
}

export interface WorkflowConfig {
  positivePrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  seed: number;
  steps?: number;
  cfg?: number;
  samplerName?: string;
  scheduler?: string;
  denoise?: number;
  filenamePrefix: string;
  /** Override checkpoint (default: Juggernaut-Ragnarok.safetensors) */
  checkpointName?: string;
  /** LoRA stack — character LoRAs only (no style LoRAs needed for Ragnarok) */
  loras?: Array<{
    filename: string;
    strengthModel: number;
    strengthClip: number;
  }>;
  /** Regional conditioning for dual-character scenes.
   *  When set, positivePrompt is used as the shared/global prompt (quality + scene),
   *  and each character gets area-constrained conditioning (left/right regions). */
  dualCharacterPrompts?: {
    char1Prompt: string;
    char2Prompt: string;
  };
  /** Regional overlap in pixels for dual-character scenes (default 64) */
  regionalOverlap?: number;
  /** ControlNet OpenPose conditioning for two-character pose guidance */
  controlNet?: ControlNetConfig;
}

/**
 * Build a ComfyUI workflow for Juggernaut XL Ragnarok (SDXL).
 *
 * Produces a text-to-image workflow with optional LoRA chain.
 * Character identity comes from trained SDXL LoRAs in the chain,
 * not from PuLID or face-swap post-processing.
 *
 * Style LoRA stack removed — Juggernaut Ragnarok handles photorealism natively.
 * Character LoRAs are the only LoRAs injected at inference time.
 * See docs/skills/juggernaut-ragnarok/SKILL.md for details.
 */
export function buildWorkflow(config: WorkflowConfig): Record<string, any> {
  const workflow: Record<string, any> = {};

  // Node 100: CheckpointLoaderSimple — loads model + clip + vae
  workflow['100'] = {
    class_type: 'CheckpointLoaderSimple',
    inputs: {
      ckpt_name: config.checkpointName || DEFAULT_CHECKPOINT,
    },
  };

  // LoRA chain (nodes 110+) — max 8 LoRAs
  let modelRef: [string, number] = ['100', 0];
  let clipRef: [string, number] = ['100', 1];

  if (config.loras && config.loras.length > 0) {
    const capped = config.loras.slice(0, 8);
    for (let i = 0; i < capped.length; i++) {
      const nodeId = String(110 + i);
      const lora = capped[i];
      workflow[nodeId] = {
        class_type: 'LoraLoader',
        inputs: {
          lora_name: lora.filename,
          strength_model: lora.strengthModel,
          strength_clip: lora.strengthClip,
          model: modelRef,
          clip: clipRef,
        },
      };
      modelRef = [nodeId, 0];
      clipRef = [nodeId, 1];
    }
  }

  // Node 102: CLIPTextEncode (negative)
  workflow['102'] = {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: config.negativePrompt,
      clip: clipRef,
    },
  };

  // ── Positive conditioning: single vs dual-character ──
  let positiveRef: [string, number];

  if (config.dualCharacterPrompts) {
    // Regional conditioning: separate each character into left/right regions
    // with shared quality+scene prompt applied globally.
    const overlap = config.regionalOverlap ?? 64;
    const regionWidth = Math.ceil(config.width / 2) + overlap;
    // Round to nearest 8 (ComfyUI requirement)
    const regionW = Math.ceil(regionWidth / 8) * 8;
    const rightX = Math.floor((config.width - regionW) / 8) * 8;

    // Node 101: Shared prompt (quality + scene — applies globally)
    workflow['101'] = {
      class_type: 'CLIPTextEncode',
      inputs: { text: config.positivePrompt, clip: clipRef },
    };

    // Node 201: Character 1 text encoding
    workflow['201'] = {
      class_type: 'CLIPTextEncode',
      inputs: { text: config.dualCharacterPrompts.char1Prompt, clip: clipRef },
    };

    // Node 202: Character 1 → left region
    workflow['202'] = {
      class_type: 'ConditioningSetArea',
      inputs: {
        conditioning: ['201', 0],
        width: regionW,
        height: config.height,
        x: 0,
        y: 0,
        strength: 1.0,
      },
    };

    // Node 203: Character 2 text encoding
    workflow['203'] = {
      class_type: 'CLIPTextEncode',
      inputs: { text: config.dualCharacterPrompts.char2Prompt, clip: clipRef },
    };

    // Node 204: Character 2 → right region
    workflow['204'] = {
      class_type: 'ConditioningSetArea',
      inputs: {
        conditioning: ['203', 0],
        width: regionW,
        height: config.height,
        x: rightX,
        y: 0,
        strength: 1.0,
      },
    };

    // Node 210: Combine both character regions
    workflow['210'] = {
      class_type: 'ConditioningCombine',
      inputs: {
        conditioning_1: ['202', 0],
        conditioning_2: ['204', 0],
      },
    };

    // Node 211: Combine shared global + character regions
    workflow['211'] = {
      class_type: 'ConditioningCombine',
      inputs: {
        conditioning_1: ['101', 0],
        conditioning_2: ['210', 0],
      },
    };

    positiveRef = ['211', 0];
  } else {
    // Single-character: one positive prompt for the whole image
    workflow['101'] = {
      class_type: 'CLIPTextEncode',
      inputs: { text: config.positivePrompt, clip: clipRef },
    };
    positiveRef = ['101', 0];
  }

  // ── ControlNet OpenPose conditioning (nodes 300–302) ──
  // Inserts between the text conditioning chain and the KSampler.
  // ControlNetApplyAdvanced modifies both positive and negative conditioning
  // so the pose skeleton guides spatial composition during sampling.
  let negativeRef: [string, number] = ['102', 0];

  if (config.controlNet) {
    const cn = config.controlNet;

    // Node 300: LoadImage — pose skeleton PNG or reference photo
    workflow['300'] = {
      class_type: 'LoadImage',
      inputs: { image: cn.poseImageName },
    };

    // When referenceImage=true, extract OpenPose skeleton from the photo via DWPose
    let poseImageRef: [string, number] = ['300', 0];
    if (cn.referenceImage) {
      // Node 303: DWPreprocessor — extract skeleton from reference photo on GPU
      workflow['303'] = {
        class_type: 'DWPreprocessor',
        inputs: {
          image: ['300', 0],
          detect_hand: 'enable',
          detect_body: 'enable',
          detect_face: 'enable',
          resolution: Math.max(config.width, config.height),
          bbox_detector: 'yolox_l.onnx',
          pose_estimator: 'dw-ll_ucoco_384.onnx',
        },
      };
      poseImageRef = ['303', 0];
    }

    // Node 301: ControlNetLoader — OpenPose SDXL model
    workflow['301'] = {
      class_type: 'ControlNetLoader',
      inputs: { control_net_name: 'OpenPoseXL2.safetensors' },
    };

    // Node 302: ControlNetApplyAdvanced — merge pose conditioning into the prompt chain
    workflow['302'] = {
      class_type: 'ControlNetApplyAdvanced',
      inputs: {
        positive: positiveRef,
        negative: negativeRef,
        control_net: ['301', 0],
        image: poseImageRef,
        strength: cn.strength ?? 0.5,
        start_percent: cn.startPercent ?? 0.0,
        end_percent: cn.endPercent ?? 1.0,
      },
    };

    // Redirect KSampler inputs through the ControlNet-modified conditioning
    positiveRef = ['302', 0];
    negativeRef = ['302', 1];
  }

  // Node 103: EmptyLatentImage
  workflow['103'] = {
    class_type: 'EmptyLatentImage',
    inputs: {
      width: config.width,
      height: config.height,
      batch_size: 1,
    },
  };

  // Node 104: KSampler
  workflow['104'] = {
    class_type: 'KSampler',
    inputs: {
      model: modelRef,
      positive: positiveRef,
      negative: negativeRef,
      latent_image: ['103', 0],
      seed: config.seed,
      steps: config.steps ?? DEFAULT_STEPS,
      cfg: config.cfg ?? DEFAULT_CFG,
      sampler_name: config.samplerName ?? DEFAULT_SAMPLER,
      scheduler: config.scheduler ?? DEFAULT_SCHEDULER,
      denoise: config.denoise ?? 1.0,
    },
  };

  // Node 105: VAEDecode
  workflow['105'] = {
    class_type: 'VAEDecode',
    inputs: {
      samples: ['104', 0],
      vae: ['100', 2],
    },
  };

  // Node 106: SaveImage
  workflow['106'] = {
    class_type: 'SaveImage',
    inputs: {
      filename_prefix: config.filenamePrefix,
      images: ['105', 0],
    },
  };

  return workflow;
}

// ── Two-Pass Workflow (Scene Composition → Identity Refinement) ──

export interface TwoPassWorkflowConfig {
  /** Full scene composition prompt (no trigger words — all tokens for pose/scene) */
  scenePrompt: string;
  /** Identity refinement prompt (trigger words + scene context) */
  refinementPrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  seed: number;
  /** Pass 1 sampling params */
  steps?: number;
  cfg?: number;
  /** Pass 2 denoise — how much to refine (0.3 = subtle identity, 0.45 = stronger identity).
   *  Higher = more LoRA influence but more composition drift. */
  refinementDenoise?: number;
  /** Pass 2 steps (can be lower than pass 1 since we're refining, not generating) */
  refinementSteps?: number;
  filenamePrefix: string;
  /** Character LoRAs for pass 2 only (identity refinement) */
  loras?: Array<{
    filename: string;
    strengthModel: number;
    strengthClip: number;
  }>;
  /** ControlNet for pass 1 scene composition (pose guidance) */
  controlNet?: ControlNetConfig;
}

/**
 * Build a two-pass ComfyUI workflow for multi-person scenes.
 *
 * Separates the two competing concerns that cause LoRA-based multi-person
 * generation to fail:
 *
 * Pass 1 (Scene Composition): Generates the full scene WITHOUT character LoRAs.
 *   The entire CLIP token budget goes to pose, position, interaction, lighting,
 *   and setting. No LoRA weight competition.
 *
 * Pass 2 (Identity Refinement): Runs img2img on the Pass 1 output WITH character
 *   LoRAs at moderate denoise. The LoRAs subtly shift faces/bodies toward the
 *   trained character identity without destroying the scene composition.
 *
 * Both passes run as a single ComfyUI job (shared checkpoint, single GPU allocation).
 */
export function buildTwoPassWorkflow(config: TwoPassWorkflowConfig): Record<string, any> {
  const workflow: Record<string, any> = {};

  // ═══ SHARED: Checkpoint (loaded once, used by both passes) ═══
  workflow['100'] = {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: DEFAULT_CHECKPOINT },
  };

  // ═══ PASS 1: Scene Composition (no LoRAs) ═══

  // Node 101: Scene prompt (full CLIP budget — no trigger words)
  workflow['101'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: config.scenePrompt, clip: ['100', 1] },
  };

  // Node 102: Negative prompt
  workflow['102'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: config.negativePrompt, clip: ['100', 1] },
  };

  // ── ControlNet for Pass 1 (pose guidance) ──
  let pass1PositiveRef: [string, number] = ['101', 0];
  let pass1NegativeRef: [string, number] = ['102', 0];

  if (config.controlNet) {
    const cn = config.controlNet;

    workflow['300'] = {
      class_type: 'LoadImage',
      inputs: { image: cn.poseImageName },
    };

    let poseImageRef: [string, number] = ['300', 0];
    if (cn.referenceImage) {
      workflow['303'] = {
        class_type: 'DWPreprocessor',
        inputs: {
          image: ['300', 0],
          detect_hand: 'enable',
          detect_body: 'enable',
          detect_face: 'enable',
          resolution: Math.max(config.width, config.height),
          bbox_detector: 'yolox_l.onnx',
          pose_estimator: 'dw-ll_ucoco_384.onnx',
        },
      };
      poseImageRef = ['303', 0];
    }

    workflow['301'] = {
      class_type: 'ControlNetLoader',
      inputs: { control_net_name: 'OpenPoseXL2.safetensors' },
    };

    workflow['302'] = {
      class_type: 'ControlNetApplyAdvanced',
      inputs: {
        positive: pass1PositiveRef,
        negative: pass1NegativeRef,
        control_net: ['301', 0],
        image: poseImageRef,
        strength: cn.strength ?? 0.5,
        start_percent: cn.startPercent ?? 0.0,
        end_percent: cn.endPercent ?? 1.0,
      },
    };

    pass1PositiveRef = ['302', 0];
    pass1NegativeRef = ['302', 1];
  }

  // Node 103: Empty latent
  workflow['103'] = {
    class_type: 'EmptyLatentImage',
    inputs: { width: config.width, height: config.height, batch_size: 1 },
  };

  // Node 104: KSampler — Pass 1 (scene composition, raw model, no LoRAs)
  workflow['104'] = {
    class_type: 'KSampler',
    inputs: {
      model: ['100', 0], // Raw checkpoint — NO LoRAs
      positive: pass1PositiveRef,
      negative: pass1NegativeRef,
      latent_image: ['103', 0],
      seed: config.seed,
      steps: config.steps ?? DEFAULT_STEPS,
      cfg: config.cfg ?? DEFAULT_CFG,
      sampler_name: DEFAULT_SAMPLER,
      scheduler: DEFAULT_SCHEDULER,
      denoise: 1.0,
    },
  };

  // Node 105: VAEDecode — produce Pass 1 image (used as input for Pass 2)
  workflow['105'] = {
    class_type: 'VAEDecode',
    inputs: { samples: ['104', 0], vae: ['100', 2] },
  };

  // ═══ PASS 2: Identity Refinement (with character LoRAs) ═══

  // LoRA chain for Pass 2 — modifies the SAME base model with character identity
  let pass2ModelRef: [string, number] = ['100', 0];
  let pass2ClipRef: [string, number] = ['100', 1];

  if (config.loras && config.loras.length > 0) {
    const capped = config.loras.slice(0, 8);
    for (let i = 0; i < capped.length; i++) {
      const nodeId = String(410 + i);
      const lora = capped[i];
      workflow[nodeId] = {
        class_type: 'LoraLoader',
        inputs: {
          lora_name: lora.filename,
          strength_model: lora.strengthModel,
          strength_clip: lora.strengthClip,
          model: pass2ModelRef,
          clip: pass2ClipRef,
        },
      };
      pass2ModelRef = [nodeId, 0];
      pass2ClipRef = [nodeId, 1];
    }
  }

  // Node 401: Refinement prompt (includes trigger words for LoRA activation)
  workflow['401'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: config.refinementPrompt, clip: pass2ClipRef },
  };

  // Node 402: Negative for Pass 2
  workflow['402'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: config.negativePrompt, clip: pass2ClipRef },
  };

  // Node 403: VAEEncode — encode Pass 1 image into latent space for refinement
  workflow['403'] = {
    class_type: 'VAEEncode',
    inputs: { pixels: ['105', 0], vae: ['100', 2] },
  };

  // Node 404: KSampler — Pass 2 (identity refinement, LoRA-modified model)
  workflow['404'] = {
    class_type: 'KSampler',
    inputs: {
      model: pass2ModelRef,
      positive: ['401', 0],
      negative: ['402', 0],
      latent_image: ['403', 0],
      seed: config.seed + 1, // Different seed for variety in refinement
      steps: config.refinementSteps ?? 20,
      cfg: config.cfg ?? DEFAULT_CFG,
      sampler_name: DEFAULT_SAMPLER,
      scheduler: DEFAULT_SCHEDULER,
      denoise: config.refinementDenoise ?? 0.35,
    },
  };

  // Node 405: VAEDecode — final image
  workflow['405'] = {
    class_type: 'VAEDecode',
    inputs: { samples: ['404', 0], vae: ['100', 2] },
  };

  // Node 406: SaveImage — output the final refined image
  workflow['406'] = {
    class_type: 'SaveImage',
    inputs: { filename_prefix: config.filenamePrefix, images: ['405', 0] },
  };

  return workflow;
}

// ── Image Editing Workflow Builders ──
// See docs/skills/image-editing-workflows/SKILL.md for details

export interface InpaintWorkflowConfig {
  /** The original generated image (base64) */
  originalImageBase64: string;
  /** Binary mask — white = regenerate, black = keep (base64) */
  maskBase64: string;
  positivePrompt: string;
  negativePrompt: string;
  /** Denoise strength for the masked region (0.5–0.8) */
  denoise: number;
  seed: number;
  width: number;
  height: number;
  filenamePrefix: string;
  loras?: Array<{ filename: string; strengthModel: number; strengthClip: number }>;
}

/**
 * Build a ComfyUI inpainting workflow.
 *
 * Uses SetLatentNoiseMask to regenerate only the masked region
 * while preserving the rest of the image.
 */
export function buildInpaintWorkflow(config: InpaintWorkflowConfig): Record<string, any> {
  const workflow: Record<string, any> = {};

  // Node 100: CheckpointLoaderSimple
  workflow['100'] = {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: DEFAULT_CHECKPOINT },
  };

  // LoRA chain
  let modelRef: [string, number] = ['100', 0];
  let clipRef: [string, number] = ['100', 1];
  if (config.loras && config.loras.length > 0) {
    for (let i = 0; i < config.loras.length; i++) {
      const nodeId = String(110 + i);
      const lora = config.loras[i];
      workflow[nodeId] = {
        class_type: 'LoraLoader',
        inputs: { lora_name: lora.filename, strength_model: lora.strengthModel, strength_clip: lora.strengthClip, model: modelRef, clip: clipRef },
      };
      modelRef = [nodeId, 0];
      clipRef = [nodeId, 1];
    }
  }

  // Node 150: LoadImage (original)
  workflow['150'] = {
    class_type: 'LoadImage',
    inputs: { image: config.originalImageBase64 },
  };

  // Node 151: LoadImage (mask)
  workflow['151'] = {
    class_type: 'LoadImage',
    inputs: { image: config.maskBase64 },
  };

  // Node 152: VAEEncode the original image
  workflow['152'] = {
    class_type: 'VAEEncode',
    inputs: { pixels: ['150', 0], vae: ['100', 2] },
  };

  // Node 153: SetLatentNoiseMask — apply the mask to the latent
  workflow['153'] = {
    class_type: 'SetLatentNoiseMask',
    inputs: { samples: ['152', 0], mask: ['151', 1] },
  };

  // Node 101: CLIPTextEncode (positive)
  workflow['101'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: config.positivePrompt, clip: clipRef },
  };

  // Node 102: CLIPTextEncode (negative)
  workflow['102'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: config.negativePrompt, clip: clipRef },
  };

  // Node 104: KSampler — regenerate masked region
  workflow['104'] = {
    class_type: 'KSampler',
    inputs: {
      model: modelRef,
      positive: ['101', 0],
      negative: ['102', 0],
      latent_image: ['153', 0],
      seed: config.seed,
      steps: DEFAULT_STEPS,
      cfg: DEFAULT_CFG,
      sampler_name: DEFAULT_SAMPLER,
      scheduler: DEFAULT_SCHEDULER,
      denoise: config.denoise,
    },
  };

  // Node 105: VAEDecode
  workflow['105'] = {
    class_type: 'VAEDecode',
    inputs: { samples: ['104', 0], vae: ['100', 2] },
  };

  // Node 106: SaveImage
  workflow['106'] = {
    class_type: 'SaveImage',
    inputs: { filename_prefix: config.filenamePrefix, images: ['105', 0] },
  };

  return workflow;
}

export interface Img2ImgWorkflowConfig {
  /** The original generated image (base64) */
  originalImageBase64: string;
  positivePrompt: string;
  negativePrompt: string;
  /** Denoise strength — 0.2 subtle, 0.3 moderate, 0.4 significant. NEVER above 0.5 */
  denoise: number;
  seed: number;
  width: number;
  height: number;
  filenamePrefix: string;
  loras?: Array<{ filename: string; strengthModel: number; strengthClip: number }>;
}

/**
 * Build a ComfyUI img2img refinement workflow.
 *
 * Takes an existing image and refines it at low denoise to preserve composition.
 */
export function buildImg2ImgWorkflow(config: Img2ImgWorkflowConfig): Record<string, any> {
  const workflow: Record<string, any> = {};

  // Node 100: CheckpointLoaderSimple
  workflow['100'] = {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: DEFAULT_CHECKPOINT },
  };

  // LoRA chain
  let modelRef: [string, number] = ['100', 0];
  let clipRef: [string, number] = ['100', 1];
  if (config.loras && config.loras.length > 0) {
    for (let i = 0; i < config.loras.length; i++) {
      const nodeId = String(110 + i);
      const lora = config.loras[i];
      workflow[nodeId] = {
        class_type: 'LoraLoader',
        inputs: { lora_name: lora.filename, strength_model: lora.strengthModel, strength_clip: lora.strengthClip, model: modelRef, clip: clipRef },
      };
      modelRef = [nodeId, 0];
      clipRef = [nodeId, 1];
    }
  }

  // Node 150: LoadImage (init image)
  workflow['150'] = {
    class_type: 'LoadImage',
    inputs: { image: config.originalImageBase64 },
  };

  // Node 152: VAEEncode the init image into latent space
  workflow['152'] = {
    class_type: 'VAEEncode',
    inputs: { pixels: ['150', 0], vae: ['100', 2] },
  };

  // Node 101: CLIPTextEncode (positive)
  workflow['101'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: config.positivePrompt, clip: clipRef },
  };

  // Node 102: CLIPTextEncode (negative)
  workflow['102'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: config.negativePrompt, clip: clipRef },
  };

  // Node 104: KSampler — refine at low denoise
  workflow['104'] = {
    class_type: 'KSampler',
    inputs: {
      model: modelRef,
      positive: ['101', 0],
      negative: ['102', 0],
      latent_image: ['152', 0],
      seed: config.seed,
      steps: DEFAULT_STEPS,
      cfg: DEFAULT_CFG,
      sampler_name: DEFAULT_SAMPLER,
      scheduler: DEFAULT_SCHEDULER,
      denoise: Math.min(config.denoise, 0.5), // Clamp to prevent identity destruction
    },
  };

  // Node 105: VAEDecode
  workflow['105'] = {
    class_type: 'VAEDecode',
    inputs: { samples: ['104', 0], vae: ['100', 2] },
  };

  // Node 106: SaveImage
  workflow['106'] = {
    class_type: 'SaveImage',
    inputs: { filename_prefix: config.filenamePrefix, images: ['105', 0] },
  };

  return workflow;
}

export interface UpscaleWorkflowConfig {
  /** The image to upscale (base64) */
  originalImageBase64: string;
  /** Upscale factor (1.5 recommended) */
  scaleFactor: number;
  positivePrompt: string;
  negativePrompt: string;
  seed: number;
  filenamePrefix: string;
  loras?: Array<{ filename: string; strengthModel: number; strengthClip: number }>;
}

/**
 * Build a ComfyUI upscale workflow.
 *
 * Uses 4xNMKD-Siax_200k upscaler followed by a KSampler refinement pass
 * at denoise 0.3 / 15 steps to add detail the upscaler misses.
 */
export function buildUpscaleWorkflow(config: UpscaleWorkflowConfig): Record<string, any> {
  const workflow: Record<string, any> = {};

  // Node 100: CheckpointLoaderSimple
  workflow['100'] = {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: DEFAULT_CHECKPOINT },
  };

  // LoRA chain
  let modelRef: [string, number] = ['100', 0];
  let clipRef: [string, number] = ['100', 1];
  if (config.loras && config.loras.length > 0) {
    for (let i = 0; i < config.loras.length; i++) {
      const nodeId = String(110 + i);
      const lora = config.loras[i];
      workflow[nodeId] = {
        class_type: 'LoraLoader',
        inputs: { lora_name: lora.filename, strength_model: lora.strengthModel, strength_clip: lora.strengthClip, model: modelRef, clip: clipRef },
      };
      modelRef = [nodeId, 0];
      clipRef = [nodeId, 1];
    }
  }

  // Node 150: LoadImage
  workflow['150'] = {
    class_type: 'LoadImage',
    inputs: { image: config.originalImageBase64 },
  };

  // Node 160: UpscaleModelLoader — 4xNMKD-Siax_200k
  workflow['160'] = {
    class_type: 'UpscaleModelLoader',
    inputs: { model_name: '4xNMKD-Siax_200k.pth' },
  };

  // Node 161: ImageUpscaleWithModel
  workflow['161'] = {
    class_type: 'ImageUpscaleWithModel',
    inputs: { upscale_model: ['160', 0], image: ['150', 0] },
  };

  // Node 162: ImageScale — scale down to target size (upscaler does 4x, we want scaleFactor)
  const targetScale = config.scaleFactor / 4.0; // 4xNMKD does 4x, so we scale to desired ratio
  workflow['162'] = {
    class_type: 'ImageScale',
    inputs: {
      image: ['161', 0],
      upscale_method: 'lanczos',
      width: Math.round(832 * config.scaleFactor), // Assumes portrait base
      height: Math.round(1216 * config.scaleFactor),
      crop: 'disabled',
    },
  };

  // Node 163: VAEEncode the upscaled image
  workflow['163'] = {
    class_type: 'VAEEncode',
    inputs: { pixels: ['162', 0], vae: ['100', 2] },
  };

  // Node 101: CLIPTextEncode (positive)
  workflow['101'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: config.positivePrompt, clip: clipRef },
  };

  // Node 102: CLIPTextEncode (negative)
  workflow['102'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: config.negativePrompt, clip: clipRef },
  };

  // Node 104: KSampler — refinement pass at low denoise
  workflow['104'] = {
    class_type: 'KSampler',
    inputs: {
      model: modelRef,
      positive: ['101', 0],
      negative: ['102', 0],
      latent_image: ['163', 0],
      seed: config.seed,
      steps: 15,
      cfg: DEFAULT_CFG,
      sampler_name: DEFAULT_SAMPLER,
      scheduler: DEFAULT_SCHEDULER,
      denoise: 0.3,
    },
  };

  // Node 105: VAEDecode
  workflow['105'] = {
    class_type: 'VAEDecode',
    inputs: { samples: ['104', 0], vae: ['100', 2] },
  };

  // Node 106: SaveImage
  workflow['106'] = {
    class_type: 'SaveImage',
    inputs: { filename_prefix: config.filenamePrefix, images: ['105', 0] },
  };

  return workflow;
}
