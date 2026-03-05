interface LoraInput {
  filename: string;
  strengthModel: number;
  strengthClip: number;
}

export type KontextWorkflowType = 'portrait' | 'single' | 'dual';

export interface KontextWorkflowConfig {
  type: KontextWorkflowType;
  positivePrompt: string;
  width: number;
  height: number;
  seed: number;
  filenamePrefix: string;
  /** true = use SFW checkpoint, false = use NSFW checkpoint */
  sfwMode: boolean;
  /** Primary character reference image filename (must match images[].name in RunPod request) */
  primaryRefImageName?: string;
  /** Secondary character reference image filename (dual scenes only) */
  secondaryRefImageName?: string;
  /** Optional LoRA stack for Flux — injected between model loaders and sampler */
  loras?: LoraInput[];
}

/**
 * Build a Flux Kontext [dev] ComfyUI workflow.
 *
 * Architecture:
 * - LoadDiffusionModel (UNETLoader) instead of CheckpointLoaderSimple
 * - DualCLIPLoader for text encoders
 * - Reference image conditioning via ReferenceLatent + FluxGuidance
 * - No negative prompts, no IPAdapter, no FaceDetailer
 * - Character consistency comes from feeding approved portrait as input image
 */
export function buildKontextWorkflow(config: KontextWorkflowConfig): Record<string, any> {
  // Use the same Kontext model for both SFW and NSFW — there is no separate
  // NSFW variant. The fp8 model handles all content types.
  const modelName = process.env.KONTEXT_SFW_MODEL || 'flux1-dev-kontext_fp8_scaled.safetensors';

  const workflow: Record<string, any> = {};

  // ---- Shared nodes (all workflow types) ----

  // Node 1: UNETLoader — Load the Kontext diffusion model
  workflow['1'] = {
    class_type: 'UNETLoader',
    inputs: {
      unet_name: modelName,
      weight_dtype: 'fp8_e4m3fn',
    },
  };

  // Node 2: DualCLIPLoader — Load text encoders for Flux
  workflow['2'] = {
    class_type: 'DualCLIPLoader',
    inputs: {
      clip_name1: 't5xxl_fp8_e4m3fn_scaled.safetensors',
      clip_name2: 'clip_l.safetensors',
      type: 'flux',
    },
  };

  // Node 3: VAELoader
  workflow['3'] = {
    class_type: 'VAELoader',
    inputs: {
      vae_name: 'ae.safetensors',
    },
  };

  // ---- Optional LoRA chain (nodes 50+) ----
  // Chains between UNETLoader/DualCLIPLoader and CLIPTextEncode/KSampler.
  // First LoRA takes model from node 1 (UNETLoader output 0) and clip from
  // node 2 (DualCLIPLoader output 0). Subsequent LoRAs chain from the previous.
  let modelRef: [string, number] = ['1', 0];
  let clipRef: [string, number] = ['2', 0];

  if (config.loras && config.loras.length > 0) {
    const capped = config.loras.slice(0, 6);
    for (let i = 0; i < capped.length; i++) {
      const nodeId = String(50 + i);
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

  // Node 4: CLIPTextEncode — Positive prompt (uses LoRA-modified clip if LoRAs present)
  workflow['4'] = {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: config.positivePrompt,
      clip: clipRef,
    },
  };

  // Pass modelRef to type-specific builders so KSampler uses the LoRA-modified model
  switch (config.type) {
    case 'portrait':
      return buildKontextPortraitWorkflow(workflow, config, modelRef);
    case 'single':
      return buildKontextSingleWorkflow(workflow, config, modelRef);
    case 'dual':
      return buildKontextDualWorkflow(workflow, config, modelRef);
    default:
      throw new Error(`Unknown Kontext workflow type: ${config.type}`);
  }
}

/** Text-to-image portrait — no reference image */
function buildKontextPortraitWorkflow(
  workflow: Record<string, any>,
  config: KontextWorkflowConfig,
  modelRef: [string, number],
): Record<string, any> {
  // Node 5: EmptyLatentImage
  workflow['5'] = {
    class_type: 'EmptyLatentImage',
    inputs: {
      width: config.width,
      height: config.height,
      batch_size: 1,
    },
  };

  // Node 6: KSampler — Kontext text-to-image uses CFG 1.0, guidance comes from model
  workflow['6'] = {
    class_type: 'KSampler',
    inputs: {
      model: modelRef,
      positive: ['4', 0],
      negative: ['4', 0], // Kontext: same positive for negative (effectively no negative)
      latent_image: ['5', 0],
      seed: config.seed,
      steps: 20,
      cfg: 1.0,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 1.0,
    },
  };

  // Node 7: VAEDecode
  workflow['7'] = {
    class_type: 'VAEDecode',
    inputs: {
      samples: ['6', 0],
      vae: ['3', 0],
    },
  };

  // Node 8: SaveImage
  workflow['8'] = {
    class_type: 'SaveImage',
    inputs: {
      filename_prefix: config.filenamePrefix,
      images: ['7', 0],
    },
  };

  return workflow;
}

/** Single reference image — one character with portrait as reference.
 *  Uses the official Kontext conditioning chain:
 *    LoadImage → VAEEncode → ReferenceLatent (binds identity into conditioning)
 *    CLIPTextEncode → ReferenceLatent → FluxGuidance (applies Flux-native guidance)
 *    ConditioningZeroOut (zeros out negative — Flux has no negative prompt)
 *    KSampler receives identity-conditioned prompt + reference latent */
function buildKontextSingleWorkflow(
  workflow: Record<string, any>,
  config: KontextWorkflowConfig,
  modelRef: [string, number],
): Record<string, any> {
  if (!config.primaryRefImageName) {
    throw new Error('Kontext single workflow requires primaryRefImageName');
  }

  // Node 5: LoadImage — primary character reference
  workflow['5'] = {
    class_type: 'LoadImage',
    inputs: {
      image: config.primaryRefImageName,
    },
  };

  // Node 6: FluxKontextImageScale — Kontext-aware scaling that preserves aspect ratio.
  // Unlike ImageScale with crop:disabled, this won't stretch the reference image.
  workflow['6'] = {
    class_type: 'FluxKontextImageScale',
    inputs: {
      image: ['5', 0],
    },
  };

  // Node 7: VAEEncode — encode scaled reference image to latent for identity conditioning
  workflow['7'] = {
    class_type: 'VAEEncode',
    inputs: {
      pixels: ['6', 0],
      vae: ['3', 0],
    },
  };

  // Node 8: ReferenceLatent — binds reference image identity into the text conditioning.
  // Takes text conditioning + encoded reference latent, outputs identity-aware CONDITIONING.
  workflow['8'] = {
    class_type: 'ReferenceLatent',
    inputs: {
      conditioning: ['4', 0],  // Text conditioning from CLIPTextEncode
      latent: ['7', 0],        // Encoded reference image from VAEEncode
    },
  };

  // Node 9: FluxGuidance — applies Flux-native guidance (replaces CFG for Flux models)
  workflow['9'] = {
    class_type: 'FluxGuidance',
    inputs: {
      conditioning: ['8', 0],  // Identity-conditioned output from ReferenceLatent
      guidance: 2.5,
    },
  };

  // Node 10: ConditioningZeroOut — Flux has no negative prompt, so zero it out
  workflow['10'] = {
    class_type: 'ConditioningZeroOut',
    inputs: {
      conditioning: ['4', 0],  // Original text conditioning → zeroed for negative
    },
  };

  // Node 11: EmptyLatentImage — clean latent at the desired output dimensions.
  // Separate from the reference VAEEncode so output isn't distorted by ref aspect ratio.
  workflow['11'] = {
    class_type: 'EmptyLatentImage',
    inputs: {
      width: config.width,
      height: config.height,
      batch_size: 1,
    },
  };

  // Node 12: KSampler — generates with identity-conditioned prompt at correct dimensions
  workflow['12'] = {
    class_type: 'KSampler',
    inputs: {
      model: modelRef,
      positive: ['9', 0],      // FluxGuidance output (identity + text + guidance)
      negative: ['10', 0],     // Zeroed-out conditioning
      latent_image: ['11', 0], // Clean latent at correct output dimensions
      seed: config.seed,
      steps: 20,
      cfg: 1.0,                // CFG 1.0 — guidance handled by FluxGuidance node
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 1.0,
    },
  };

  // Node 13: VAEDecode
  workflow['13'] = {
    class_type: 'VAEDecode',
    inputs: {
      samples: ['12', 0],
      vae: ['3', 0],
    },
  };

  // Node 14: SaveImage
  workflow['14'] = {
    class_type: 'SaveImage',
    inputs: {
      filename_prefix: config.filenamePrefix,
      images: ['13', 0],
    },
  };

  return workflow;
}

/** Dual reference images — both characters combined into a single reference image server-side.
 *  The route concatenates both portraits horizontally before calling this builder,
 *  so the workflow receives a single pre-combined image via primaryRefImageName.
 *  Uses the same official Kontext conditioning chain as the single workflow. */
function buildKontextDualWorkflow(
  workflow: Record<string, any>,
  config: KontextWorkflowConfig,
  modelRef: [string, number],
): Record<string, any> {
  if (!config.primaryRefImageName) {
    throw new Error('Kontext dual workflow requires primaryRefImageName (pre-combined reference image)');
  }

  // Node 5: LoadImage — combined reference (both characters side by side)
  workflow['5'] = {
    class_type: 'LoadImage',
    inputs: {
      image: config.primaryRefImageName,
    },
  };

  // Node 6: FluxKontextImageScale — Kontext-aware scaling that preserves aspect ratio
  workflow['6'] = {
    class_type: 'FluxKontextImageScale',
    inputs: {
      image: ['5', 0],
    },
  };

  // Node 7: VAEEncode — encode reference to latent for identity conditioning
  workflow['7'] = {
    class_type: 'VAEEncode',
    inputs: {
      pixels: ['6', 0],
      vae: ['3', 0],
    },
  };

  // Node 8: ReferenceLatent — binds both characters' identity into conditioning
  workflow['8'] = {
    class_type: 'ReferenceLatent',
    inputs: {
      conditioning: ['4', 0],
      latent: ['7', 0],
    },
  };

  // Node 9: FluxGuidance — Flux-native guidance
  workflow['9'] = {
    class_type: 'FluxGuidance',
    inputs: {
      conditioning: ['8', 0],
      guidance: 2.5,
    },
  };

  // Node 10: ConditioningZeroOut — zero out negative (Flux has no negative prompt)
  workflow['10'] = {
    class_type: 'ConditioningZeroOut',
    inputs: {
      conditioning: ['4', 0],
    },
  };

  // Node 11: EmptyLatentImage — clean latent at correct output dimensions
  workflow['11'] = {
    class_type: 'EmptyLatentImage',
    inputs: {
      width: config.width,
      height: config.height,
      batch_size: 1,
    },
  };

  // Node 12: KSampler — identity-conditioned generation at correct dimensions
  workflow['12'] = {
    class_type: 'KSampler',
    inputs: {
      model: modelRef,
      positive: ['9', 0],
      negative: ['10', 0],
      latent_image: ['11', 0], // Clean latent at correct output dimensions
      seed: config.seed,
      steps: 20,
      cfg: 1.0,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 1.0,
    },
  };

  // Node 13: VAEDecode
  workflow['13'] = {
    class_type: 'VAEDecode',
    inputs: {
      samples: ['12', 0],
      vae: ['3', 0],
    },
  };

  // Node 14: SaveImage
  workflow['14'] = {
    class_type: 'SaveImage',
    inputs: {
      filename_prefix: config.filenamePrefix,
      images: ['13', 0],
    },
  };

  return workflow;
}
