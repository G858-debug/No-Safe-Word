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
    const overlap = 64; // ~5% of 1216 for smooth blending
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
      negative: ['102', 0],
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
