interface LoraInput {
  filename: string;
  strengthModel: number;
  strengthClip: number;
}

export type KontextWorkflowType = 'portrait' | 'single' | 'dual' | 'img2img';

export interface KontextWorkflowConfig {
  type: KontextWorkflowType;
  positivePrompt: string;
  width: number;
  height: number;
  seed: number;
  filenamePrefix: string;
  /** Primary character reference image filename (must match images[].name in RunPod request) */
  primaryRefImageName?: string;
  /** Secondary character reference image filename (dual scenes only) */
  secondaryRefImageName?: string;
  /** Optional LoRA stack for Flux — injected between model loaders and sampler */
  loras?: LoraInput[];
  /** FluxGuidance strength — higher values give more weight to text vs reference image.
   *  Range 2.0–4.0. Default: 2.5 */
  guidance?: number;
  /**
   * img2img only — denoise strength for the KSampler.
   * 1.0 = full generation from noise (same as text-to-image).
   * 0.72 = strong stylistic conversion while preserving pose/composition.
   * Default: 0.72
   */
  denoiseStrength?: number;
  /** SFW mode: true → SFW checkpoint (KONTEXT_MODEL), false → NSFW checkpoint (KONTEXT_NSFW_MODEL).
   *  Defaults to true (SFW) when not specified. */
  sfwMode?: boolean;
  /** Optional Redux reference image filename for style/identity conditioning.
   *  When set, a Redux conditioning pass (nodes 30–35) merges visual identity
   *  from this image into the text conditioning before generation. */
  reduxRefImageName?: string;
  /** Redux conditioning strength — how much the Redux reference influences the output.
   *  Range 0.0–1.0. Default: 0.65 */
  reduxStrength?: number;
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
  // SFW/NSFW checkpoint switching:
  //   sfwMode: true  (default) → KONTEXT_MODEL (Krea Dev SFW or base)
  //   sfwMode: false           → KONTEXT_NSFW_MODEL (Krea Dev Uncensored)
  const modelName = config.sfwMode === false
    ? (process.env.KONTEXT_NSFW_MODEL || process.env.KONTEXT_MODEL || 'flux1KreaDev_fp8E4m3fn.safetensors')
    : (process.env.KONTEXT_MODEL || 'flux1KreaDev_fp8E4m3fn.safetensors');

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
  //
  // LoRA Slot Priority Order (max 6 slots, nodes 50–55):
  //
  //   Slot 1: Realism LoRA (always loaded — quality backbone)
  //   Slot 2: Detail/Style LoRA (Detail, Fashion Editorial SFW, Boudoir NSFW)
  //   Slot 3: Skin texture LoRA (Beauty Skin / Oiled / Sweat — situational)
  //   Slot 4: Body shape LoRA (BodyLicious or Hourglass — female only)
  //   Slot 5: Kissing / NSFW anatomy LoRA (situational)
  //   Slot 6: RefControl pose LoRA (optional)
  //
  // Budget cap: MAX_TOTAL_STRENGTH = 4.0 (all strengths scaled proportionally if exceeded)
  // Gender: Female body LoRAs only loaded when hasFemaleCharacter is true
  // Selection logic lives in selectKontextResources() in lora-registry.ts.
  // This builder just chains whatever LoRAs are passed in config.loras[].
  //
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

  // ---- Optional Redux conditioning pass (nodes 30–35) ----
  // When reduxRefImageName is provided, Flux Redux transfers visual identity
  // from a hero reference image into the generation via style model conditioning.
  // The Redux conditioning is combined with the text conditioning before passing
  // to the type-specific builders.
  //
  // conditioningRef tracks the conditioning output — defaults to CLIPTextEncode (node 4),
  // but changes to ConditioningCombine (node 35) when Redux is active.
  let conditioningRef: [string, number] = ['4', 0];

  if (config.reduxRefImageName) {
    const reduxStrength = config.reduxStrength ?? 0.65;

    // Node 30: LoadImage — Redux hero reference image
    workflow['30'] = {
      class_type: 'LoadImage',
      inputs: {
        image: config.reduxRefImageName,
      },
    };

    // Node 31: CLIPVisionLoader — load SigCLIP Vision encoder for Redux
    workflow['31'] = {
      class_type: 'CLIPVisionLoader',
      inputs: {
        clip_name: 'sigclip_vision_patch14_384.safetensors',
      },
    };

    // Node 32: CLIPVisionEncode — encode the reference image with CLIP Vision
    workflow['32'] = {
      class_type: 'CLIPVisionEncode',
      inputs: {
        clip_vision: ['31', 0],
        image: ['30', 0],
      },
    };

    // Node 33: StyleModelLoader — load the Flux Redux style model
    workflow['33'] = {
      class_type: 'StyleModelLoader',
      inputs: {
        style_model_name: 'flux1-redux-dev.safetensors',
      },
    };

    // Node 34: StyleModelApply — apply Redux style conditioning
    workflow['34'] = {
      class_type: 'StyleModelApply',
      inputs: {
        conditioning: ['4', 0],          // Text conditioning from CLIPTextEncode
        style_model: ['33', 0],           // Loaded Redux style model
        clip_vision_output: ['32', 0],    // CLIP Vision encoding of reference
        strength: reduxStrength,
      },
    };

    conditioningRef = ['34', 0];
  }

  // Pass modelRef and conditioningRef to type-specific builders
  switch (config.type) {
    case 'portrait':
      return buildKontextPortraitWorkflow(workflow, config, modelRef, conditioningRef);
    case 'single':
      return buildKontextSingleWorkflow(workflow, config, modelRef, conditioningRef);
    case 'dual':
      return buildKontextDualWorkflow(workflow, config, modelRef, conditioningRef);
    case 'img2img':
      return buildKontextImg2ImgWorkflow(workflow, config, modelRef, conditioningRef);
    default:
      throw new Error(`Unknown Kontext workflow type: ${config.type}`);
  }
}

/** Text-to-image portrait — no reference image */
function buildKontextPortraitWorkflow(
  workflow: Record<string, any>,
  config: KontextWorkflowConfig,
  modelRef: [string, number],
  conditioningRef: [string, number],
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
      positive: conditioningRef,
      negative: conditioningRef, // Kontext: same positive for negative (effectively no negative)
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
  conditioningRef: [string, number],
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
      conditioning: conditioningRef,  // Text (or Redux-combined) conditioning
      latent: ['7', 0],               // Encoded reference image from VAEEncode
    },
  };

  // Node 9: FluxGuidance — applies Flux-native guidance (replaces CFG for Flux models)
  workflow['9'] = {
    class_type: 'FluxGuidance',
    inputs: {
      conditioning: ['8', 0],  // Identity-conditioned output from ReferenceLatent
      guidance: config.guidance ?? 2.5,
    },
  };

  // Node 10: ConditioningZeroOut — Flux has no negative prompt, so zero it out
  workflow['10'] = {
    class_type: 'ConditioningZeroOut',
    inputs: {
      conditioning: conditioningRef,  // Same base conditioning → zeroed for negative
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

/**
 * img2img — converts a source image (e.g. anime) to photorealistic using Flux Kontext.
 *
 * The source image is passed via the RunPod `images[]` array as "input.jpg".
 * Unlike the portrait/single/dual workflows that start from EmptyLatentImage,
 * here the encoded source image IS the starting latent — with partial denoise to
 * preserve pose and composition while the model re-renders in the target style.
 *
 * Node IDs 20–25 to avoid collisions with shared nodes (1–4, 50+) and
 * reference-workflow nodes (5–14).
 */
function buildKontextImg2ImgWorkflow(
  workflow: Record<string, any>,
  config: KontextWorkflowConfig,
  modelRef: [string, number],
  conditioningRef: [string, number],
): Record<string, any> {
  const denoise = config.denoiseStrength ?? 0.72;

  // Node 20: LoadImage — source image supplied via RunPod images[] array
  workflow['20'] = {
    class_type: 'LoadImage',
    inputs: {
      image: 'input.jpg',
    },
  };

  // Node 21: FluxKontextImageScale — Kontext-aware scaling (preserves aspect ratio)
  workflow['21'] = {
    class_type: 'FluxKontextImageScale',
    inputs: {
      image: ['20', 0],
    },
  };

  // Node 22: VAEEncode — encode source image to latent; this becomes the starting noise
  workflow['22'] = {
    class_type: 'VAEEncode',
    inputs: {
      pixels: ['21', 0],
      vae: ['3', 0],
    },
  };

  // Node 23: KSampler — partial denoise from source latent.
  // denoise < 1.0 means the sampler starts mid-trajectory, preserving
  // the source structure while re-rendering style via the text prompt.
  workflow['23'] = {
    class_type: 'KSampler',
    inputs: {
      model: modelRef,
      positive: conditioningRef,
      negative: conditioningRef, // Flux has no negative prompt — mirror positive as a no-op
      latent_image: ['22', 0],
      seed: config.seed,
      steps: 25,
      cfg: 1.0,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise,
    },
  };

  // Node 24: VAEDecode
  workflow['24'] = {
    class_type: 'VAEDecode',
    inputs: {
      samples: ['23', 0],
      vae: ['3', 0],
    },
  };

  // Node 25: SaveImage
  workflow['25'] = {
    class_type: 'SaveImage',
    inputs: {
      filename_prefix: config.filenamePrefix,
      images: ['24', 0],
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
  conditioningRef: [string, number],
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
      conditioning: conditioningRef,  // Text (or Redux-combined) conditioning
      latent: ['7', 0],
    },
  };

  // Node 9: FluxGuidance — Flux-native guidance
  workflow['9'] = {
    class_type: 'FluxGuidance',
    inputs: {
      conditioning: ['8', 0],
      guidance: config.guidance ?? 2.5,
    },
  };

  // Node 10: ConditioningZeroOut — zero out negative (Flux has no negative prompt)
  workflow['10'] = {
    class_type: 'ConditioningZeroOut',
    inputs: {
      conditioning: conditioningRef,  // Same base conditioning → zeroed
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
