/**
 * Pony V6 / CyberRealistic Pony Semi-Realistic ComfyUI workflow builder.
 *
 * Builds SDXL-architecture workflows for CyberRealistic Pony Semi-Realistic v4.5.
 * Based on the existing buildSdxlWorkflow() pattern in workflow-builder.ts
 * but with Pony-specific defaults and no ReActor/PuLID.
 *
 * Node architecture:
 *   CheckpointLoaderSimple → LoRA chain → CLIPTextEncode (pos/neg)
 *   → EmptyLatentImage → KSampler → VAEDecode → SaveImage
 */

const PONY_CHECKPOINT = 'CyberRealistic_PonySemi_V4.5.safetensors';
const PONY_DEFAULT_CFG = 5.5;
const PONY_DEFAULT_STEPS = 30;
const PONY_DEFAULT_SAMPLER = 'dpmpp_2m_sde';
const PONY_DEFAULT_SCHEDULER = 'karras';

export interface PonyWorkflowConfig {
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
  /** Override checkpoint (default: CyberRealistic_PonySemi_V4.5.safetensors) */
  checkpointName?: string;
  /** LoRA stack — character LoRAs first, then style LoRAs */
  loras?: Array<{
    filename: string;
    strengthModel: number;
    strengthClip: number;
  }>;
}

/**
 * Build a ComfyUI workflow for CyberRealistic Pony Semi-Realistic v4.5 (SDXL).
 *
 * Produces a text-to-image workflow with optional LoRA chain.
 * Character identity comes from trained SDXL LoRAs in the chain,
 * not from PuLID or face-swap post-processing.
 */
export function buildPonyWorkflow(config: PonyWorkflowConfig): Record<string, any> {
  const workflow: Record<string, any> = {};

  // Node 100: CheckpointLoaderSimple — loads model + clip + vae
  workflow['100'] = {
    class_type: 'CheckpointLoaderSimple',
    inputs: {
      ckpt_name: config.checkpointName || PONY_CHECKPOINT,
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

  // Node 101: CLIPTextEncode (positive)
  workflow['101'] = {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: config.positivePrompt,
      clip: clipRef,
    },
  };

  // Node 102: CLIPTextEncode (negative)
  workflow['102'] = {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: config.negativePrompt,
      clip: clipRef,
    },
  };

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
      positive: ['101', 0],
      negative: ['102', 0],
      latent_image: ['103', 0],
      seed: config.seed,
      steps: config.steps ?? PONY_DEFAULT_STEPS,
      cfg: config.cfg ?? PONY_DEFAULT_CFG,
      sampler_name: config.samplerName ?? PONY_DEFAULT_SAMPLER,
      scheduler: config.scheduler ?? PONY_DEFAULT_SCHEDULER,
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
