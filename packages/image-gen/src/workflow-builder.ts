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
  /** Redux conditioning strength — how much the reference image influences the output.
   *  Higher = stronger identity preservation, lower = more creative freedom.
   *  Range 0.0–1.0. Default: 0.65 */
  reduxStrength?: number;
  /**
   * Optional PuLID face identity refinement pass.
   * When set, a second KSampler pass is appended after the main generation.
   * The pass applies ApplyPulidFlux to the Flux model using the provided face
   * reference images, then re-samples with partial denoise to refine face identity
   * while preserving scene composition.
   *
   * Image names must match entries in the RunPod images[] array.
   */
  pulid?: {
    /** Primary character face reference image name (e.g. 'face_reference.png') */
    primaryFaceImageName: string;
    /** Secondary character face reference (dual scenes only) */
    secondaryFaceImageName?: string;
    /** PuLID model influence strength. Default: 0.85 */
    weight?: number;
    /** KSampler denoise for the refinement pass. Default: 0.5 */
    denoiseStrength?: number;
  };
}

/**
 * Build a Flux Kontext [dev] ComfyUI workflow.
 *
 * Architecture:
 * - LoadDiffusionModel (UNETLoader) instead of CheckpointLoaderSimple
 * - DualCLIPLoader for text encoders
 * - Redux conditioning for character identity (CLIPVision + StyleModel)
 * - No negative prompts, no IPAdapter, no FaceDetailer
 * - Character consistency comes from Redux semantic identity transfer
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

  // Pass modelRef to type-specific builders
  switch (config.type) {
    case 'portrait':
      return buildKontextPortraitWorkflow(workflow, config, modelRef);
    case 'single':
      return buildKontextSingleWorkflow(workflow, config, modelRef);
    case 'dual':
      return buildKontextDualWorkflow(workflow, config, modelRef);
    case 'img2img':
      return buildKontextImg2ImgWorkflow(workflow, config, modelRef);
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

  // Node 9: FluxGuidance — applies Flux-native guidance
  workflow['9'] = {
    class_type: 'FluxGuidance',
    inputs: {
      conditioning: ['4', 0],
      guidance: config.guidance ?? 2.5,
    },
  };

  // Node 10: ConditioningZeroOut — zero out negative
  workflow['10'] = {
    class_type: 'ConditioningZeroOut',
    inputs: {
      conditioning: ['4', 0],
    },
  };

  // Node 6: KSampler
  workflow['6'] = {
    class_type: 'KSampler',
    inputs: {
      model: modelRef,
      positive: ['9', 0],
      negative: ['10', 0],
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

/**
 * Single reference image — one character with Redux identity conditioning.
 *
 * Uses Flux Redux to transfer character identity from the reference image
 * via CLIPVision semantic encoding, NOT ReferenceLatent. This preserves
 * identity features (face, skin tone, hair) without constraining spatial
 * composition — so scene descriptions actually work.
 *
 * Redux chain:
 *   LoadImage(5) → CLIPVisionEncode(6) → StyleModelApply(8) → FluxGuidance(9)
 *   CLIPVisionLoader(7)   StyleModelLoader(15)
 *   ConditioningZeroOut(10)   EmptyLatentImage(11) → KSampler(12) → VAEDecode(13) → SaveImage(14)
 */
function buildKontextSingleWorkflow(
  workflow: Record<string, any>,
  config: KontextWorkflowConfig,
  modelRef: [string, number],
): Record<string, any> {
  if (!config.primaryRefImageName) {
    throw new Error('Kontext single workflow requires primaryRefImageName');
  }

  const reduxStrength = config.reduxStrength ?? 0.65;

  // Node 5: LoadImage — primary character reference
  workflow['5'] = {
    class_type: 'LoadImage',
    inputs: {
      image: config.primaryRefImageName,
    },
  };

  // Node 6: CLIPVisionEncode — encode reference image semantically (identity, not composition)
  workflow['6'] = {
    class_type: 'CLIPVisionEncode',
    inputs: {
      clip_vision: ['7', 0],   // CLIPVisionLoader output
      image: ['5', 0],         // Reference image
      crop: 'center',          // Center-crop to CLIP Vision input size
    },
  };

  // Node 7: CLIPVisionLoader — load SigCLIP Vision encoder for Redux
  workflow['7'] = {
    class_type: 'CLIPVisionLoader',
    inputs: {
      clip_name: 'sigclip_vision_patch14_384.safetensors',
    },
  };

  // Node 15: StyleModelLoader — load the Flux Redux style model
  workflow['15'] = {
    class_type: 'StyleModelLoader',
    inputs: {
      style_model_name: 'flux1-redux-dev.safetensors',
    },
  };

  // Node 8: StyleModelApply — merge reference identity into text conditioning
  workflow['8'] = {
    class_type: 'StyleModelApply',
    inputs: {
      conditioning: ['4', 0],        // Text conditioning from CLIPTextEncode
      style_model: ['15', 0],        // Redux style model
      clip_vision_output: ['6', 0],  // CLIPVision encoding of reference
      strength: reduxStrength,
      strength_type: 'multiply',     // Multiply strength scaling
    },
  };

  // Node 9: FluxGuidance — applies Flux-native guidance
  workflow['9'] = {
    class_type: 'FluxGuidance',
    inputs: {
      conditioning: ['8', 0],  // Redux-conditioned output
      guidance: config.guidance ?? 2.5,
    },
  };

  // Node 10: ConditioningZeroOut — Flux has no negative prompt, so zero it out
  workflow['10'] = {
    class_type: 'ConditioningZeroOut',
    inputs: {
      conditioning: ['4', 0],  // Zero out the text-only conditioning for negative
    },
  };

  // Node 11: EmptyLatentImage — clean latent at the desired output dimensions
  workflow['11'] = {
    class_type: 'EmptyLatentImage',
    inputs: {
      width: config.width,
      height: config.height,
      batch_size: 1,
    },
  };

  // Node 12: KSampler — generates with Redux-conditioned prompt at correct dimensions
  workflow['12'] = {
    class_type: 'KSampler',
    inputs: {
      model: modelRef,
      positive: ['9', 0],      // FluxGuidance output (Redux identity + text + guidance)
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

  // ---- Optional PuLID face identity refinement pass (nodes 300–307) ----
  // When pulid config is set, append a second KSampler pass that patches the
  // Flux model with ApplyPulidFlux using the character's approved face reference.
  // The main generation output (node 13) is re-encoded as the starting latent,
  // then re-sampled at partial denoise to refine face identity while preserving
  // scene composition. Node 14 (SaveImage) is only added when PuLID is NOT used;
  // the PuLID pass adds its own SaveImage at node 307.
  if (config.pulid) {
    const pulidWeight = config.pulid.weight ?? 0.85;
    const pulidDenoise = config.pulid.denoiseStrength ?? 0.5;

    // Node 300: LoadImage — primary character face reference
    workflow['300'] = {
      class_type: 'LoadImage',
      inputs: { image: config.pulid.primaryFaceImageName },
    };

    // Node 301: PulidModelLoader
    workflow['301'] = {
      class_type: 'PulidModelLoader',
      inputs: { pulid_file: 'pulid_flux_v0.9.1.safetensors' },
    };

    // Node 302: PulidEvaClipLoader (no required inputs)
    workflow['302'] = {
      class_type: 'PulidEvaClipLoader',
      inputs: {},
    };

    // Node 315: PulidInsightFaceLoader — face detection/alignment (reuses InsightFace)
    workflow['315'] = {
      class_type: 'PulidInsightFaceLoader',
      inputs: { provider: 'CUDA' },
    };

    // Node 303: ApplyPulid — patch Flux model with face identity
    workflow['303'] = {
      class_type: 'ApplyPulid',
      inputs: {
        model: modelRef,
        pulid: ['301', 0],
        eva_clip: ['302', 0],
        face_analysis: ['315', 0],
        image: ['300', 0],
        method: 'fidelity',
        weight: pulidWeight,
        start_at: 0.0,
        end_at: 1.0,
      },
    };

    // Node 304: VAEEncode — re-encode main generation output as latent for refinement
    workflow['304'] = {
      class_type: 'VAEEncode',
      inputs: {
        pixels: ['13', 0],
        vae: ['3', 0],
      },
    };

    // Node 305: KSampler — refinement pass with PuLID-patched model
    workflow['305'] = {
      class_type: 'KSampler',
      inputs: {
        model: ['303', 0],
        positive: ['9', 0],    // Reuse main FluxGuidance conditioning
        negative: ['10', 0],   // Reuse zeroed negative
        latent_image: ['304', 0],
        seed: config.seed + 1,
        steps: 20,
        cfg: 1.0,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: pulidDenoise,
      },
    };

    // Node 306: VAEDecode
    workflow['306'] = {
      class_type: 'VAEDecode',
      inputs: {
        samples: ['305', 0],
        vae: ['3', 0],
      },
    };

    // Node 307: SaveImage (final output — replaces node 14)
    workflow['307'] = {
      class_type: 'SaveImage',
      inputs: {
        filename_prefix: config.filenamePrefix,
        images: ['306', 0],
      },
    };
  } else {
    // Node 14: SaveImage (no PuLID — direct output from main KSampler)
    workflow['14'] = {
      class_type: 'SaveImage',
      inputs: {
        filename_prefix: config.filenamePrefix,
        images: ['13', 0],
      },
    };
  }

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
      positive: ['4', 0],       // Text conditioning only (no Redux for img2img)
      negative: ['4', 0],       // Flux has no negative prompt — mirror positive as a no-op
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

// ============================================================
// SDXL Workflow Builder (RealVisXL — character approval pipeline)
// ============================================================

export interface SdxlWorkflowConfig {
  positivePrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  seed: number;
  steps?: number;          // default 30
  cfg?: number;            // default 7.0
  filenamePrefix: string;
  checkpointName: string;  // e.g. 'realvisxlV50_v50Bakedvae.safetensors'
  loras?: Array<{
    filename: string;
    strengthModel: number;
    strengthClip: number;
  }>;
  /** When set, adds ReActor face-swap post-processing after VAEDecode.
   *  The value is the image filename passed in RunPod's images[] array (e.g. 'source_face.png').
   *  The approved face portrait is swapped onto the generated body. */
  reactorSourceImageName?: string;
}

/**
 * Build an SDXL ComfyUI workflow (CheckpointLoaderSimple architecture).
 *
 * Used for character approval face/body generation with RealVisXL V5.0.
 * Completely different node architecture from Flux/Kontext:
 * - CheckpointLoaderSimple (not UNETLoader + DualCLIPLoader + VAELoader)
 * - Two CLIPTextEncode nodes (positive + negative — SDXL supports negative prompts)
 * - KSampler with cfg: 7.0, scheduler: karras, sampler: dpmpp_2m
 */
export function buildSdxlWorkflow(config: SdxlWorkflowConfig): Record<string, any> {
  const workflow: Record<string, any> = {};

  // Node 100: CheckpointLoaderSimple — loads checkpoint (model, clip, vae)
  workflow['100'] = {
    class_type: 'CheckpointLoaderSimple',
    inputs: {
      ckpt_name: config.checkpointName,
    },
  };

  // ---- Optional LoRA chain (nodes 110+) ----
  // LoRAs modify both model and clip, so CLIPTextEncode nodes must be built
  // AFTER the LoRA chain using the final clipRef.
  let modelRef: [string, number] = ['100', 0];
  let clipRef: [string, number] = ['100', 1];

  if (config.loras && config.loras.length > 0) {
    const capped = config.loras.slice(0, 6);
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

  // Node 101: CLIPTextEncode (positive) — uses LoRA-modified clip if LoRAs present
  workflow['101'] = {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: config.positivePrompt,
      clip: clipRef,
    },
  };

  // Node 102: CLIPTextEncode (negative) — uses LoRA-modified clip if LoRAs present
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

  // Node 104: KSampler — SDXL sampling with karras scheduler
  workflow['104'] = {
    class_type: 'KSampler',
    inputs: {
      model: modelRef,
      positive: ['101', 0],
      negative: ['102', 0],
      latent_image: ['103', 0],
      seed: config.seed,
      steps: config.steps ?? 30,
      cfg: config.cfg ?? 7.0,
      sampler_name: 'dpmpp_2m',
      scheduler: 'karras',
      denoise: 1.0,
    },
  };

  // Node 105: VAEDecode — vae from checkpoint output 2
  workflow['105'] = {
    class_type: 'VAEDecode',
    inputs: {
      samples: ['104', 0],
      vae: ['100', 2],
    },
  };

  // ---- Optional ReActor face-swap (nodes 120-121) ----
  // When reactorSourceImageName is set, insert ReActor between VAEDecode and SaveImage.
  // The approved face portrait (source) is swapped onto the generated body (target).
  let saveImageInput: [string, number] = ['105', 0];

  if (config.reactorSourceImageName) {
    // Node 121: LoadImage — approved face portrait (source face for swap)
    workflow['121'] = {
      class_type: 'LoadImage',
      inputs: {
        image: config.reactorSourceImageName,
      },
    };

    // Node 120: ReActorFaceSwap — swap detected face in body output with source face
    workflow['120'] = {
      class_type: 'ReActorFaceSwap',
      inputs: {
        input_image: ['105', 0],        // SDXL body output (VAEDecode)
        source_image: ['121', 0],       // Approved face portrait
        swap_model: 'inswapper_128.onnx',
        facedetection: 'retinaface_resnet50',
        face_restore_model: 'none',
        face_restore_visibility: 1,
        codeformer_weight: 0.5,
        detect_gender_input: 'no',
        detect_gender_source: 'no',
        input_faces_index: '0',
        source_faces_index: '0',
        console_log_level: 1,
      },
    };

    saveImageInput = ['120', 0];
  }

  // Node 106: SaveImage
  workflow['106'] = {
    class_type: 'SaveImage',
    inputs: {
      filename_prefix: config.filenamePrefix,
      images: saveImageInput,
    },
  };

  return workflow;
}

/**
 * Dual reference images — both characters combined into a single reference image server-side.
 * The route concatenates both portraits before calling this builder,
 * so the workflow receives a single pre-combined image via primaryRefImageName.
 *
 * Uses the same Redux conditioning chain as the single workflow —
 * CLIPVision extracts semantic identity from both characters in the combined reference.
 */
function buildKontextDualWorkflow(
  workflow: Record<string, any>,
  config: KontextWorkflowConfig,
  modelRef: [string, number],
): Record<string, any> {
  if (!config.primaryRefImageName) {
    throw new Error('Kontext dual workflow requires primaryRefImageName (pre-combined reference image)');
  }

  const reduxStrength = config.reduxStrength ?? 0.65;

  // Node 5: LoadImage — combined reference (both characters side by side)
  workflow['5'] = {
    class_type: 'LoadImage',
    inputs: {
      image: config.primaryRefImageName,
    },
  };

  // Node 6: CLIPVisionEncode — encode combined reference semantically
  workflow['6'] = {
    class_type: 'CLIPVisionEncode',
    inputs: {
      clip_vision: ['7', 0],
      image: ['5', 0],
      crop: 'center',
    },
  };

  // Node 7: CLIPVisionLoader — SigCLIP Vision encoder
  workflow['7'] = {
    class_type: 'CLIPVisionLoader',
    inputs: {
      clip_name: 'sigclip_vision_patch14_384.safetensors',
    },
  };

  // Node 15: StyleModelLoader — Flux Redux style model
  workflow['15'] = {
    class_type: 'StyleModelLoader',
    inputs: {
      style_model_name: 'flux1-redux-dev.safetensors',
    },
  };

  // Node 8: StyleModelApply — merge reference identity into text conditioning
  workflow['8'] = {
    class_type: 'StyleModelApply',
    inputs: {
      conditioning: ['4', 0],
      style_model: ['15', 0],
      clip_vision_output: ['6', 0],
      strength: reduxStrength,
      strength_type: 'multiply',
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

  // Node 12: KSampler — Redux-conditioned generation at correct dimensions
  workflow['12'] = {
    class_type: 'KSampler',
    inputs: {
      model: modelRef,
      positive: ['9', 0],
      negative: ['10', 0],
      latent_image: ['11', 0],
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

  // ---- Optional PuLID face identity refinement — dual scene (two sequential passes) ----
  // Pass 1 refines the primary character's face; pass 2 refines the secondary.
  // Both passes apply PuLID to the same base modelRef (not compounded) to prevent
  // one character's identity from contaminating the other.
  // Note: without spatial masking, each pass affects the full image. The second pass
  // may slightly alter the first character's face. Spatial masking can be added later.
  if (config.pulid) {
    const pulidWeight = config.pulid.weight ?? 0.85;
    const pulidDenoise = config.pulid.denoiseStrength ?? 0.5;

    // Shared nodes — PuLID model + EVA CLIP + InsightFace loaded once, reused by both passes
    workflow['301'] = {
      class_type: 'PulidModelLoader',
      inputs: { pulid_file: 'pulid_flux_v0.9.1.safetensors' },
    };
    workflow['302'] = {
      class_type: 'PulidEvaClipLoader',
      inputs: {},
    };
    workflow['315'] = {
      class_type: 'PulidInsightFaceLoader',
      inputs: { provider: 'CUDA' },
    };

    // ── Pass 1: Primary character face ──
    workflow['300'] = {
      class_type: 'LoadImage',
      inputs: { image: config.pulid.primaryFaceImageName },
    };
    workflow['303'] = {
      class_type: 'ApplyPulid',
      inputs: {
        model: modelRef,
        pulid: ['301', 0],
        eva_clip: ['302', 0],
        face_analysis: ['315', 0],
        image: ['300', 0],
        method: 'fidelity',
        weight: pulidWeight,
        start_at: 0.0,
        end_at: 1.0,
      },
    };
    workflow['304'] = {
      class_type: 'VAEEncode',
      inputs: { pixels: ['13', 0], vae: ['3', 0] },
    };
    workflow['305'] = {
      class_type: 'KSampler',
      inputs: {
        model: ['303', 0],
        positive: ['9', 0],
        negative: ['10', 0],
        latent_image: ['304', 0],
        seed: config.seed + 1,
        steps: 20,
        cfg: 1.0,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: pulidDenoise,
      },
    };
    workflow['306'] = {
      class_type: 'VAEDecode',
      inputs: { samples: ['305', 0], vae: ['3', 0] },
    };

    if (config.pulid.secondaryFaceImageName) {
      // ── Pass 2: Secondary character face ──
      workflow['310'] = {
        class_type: 'LoadImage',
        inputs: { image: config.pulid.secondaryFaceImageName },
      };
      workflow['311'] = {
        class_type: 'ApplyPulid',
        inputs: {
          model: modelRef,    // Apply to base model, not pass-1 patched model
          pulid: ['301', 0],
          eva_clip: ['302', 0],
          face_analysis: ['315', 0],
          image: ['310', 0],
          method: 'fidelity',
          weight: pulidWeight,
          start_at: 0.0,
          end_at: 1.0,
        },
      };
      workflow['312'] = {
        class_type: 'VAEEncode',
        inputs: { pixels: ['306', 0], vae: ['3', 0] },  // pass-1 output as input
      };
      workflow['313'] = {
        class_type: 'KSampler',
        inputs: {
          model: ['311', 0],
          positive: ['9', 0],
          negative: ['10', 0],
          latent_image: ['312', 0],
          seed: config.seed + 2,
          steps: 20,
          cfg: 1.0,
          sampler_name: 'euler',
          scheduler: 'simple',
          denoise: pulidDenoise,
        },
      };
      workflow['314'] = {
        class_type: 'VAEDecode',
        inputs: { samples: ['313', 0], vae: ['3', 0] },
      };
      workflow['14'] = {
        class_type: 'SaveImage',
        inputs: { filename_prefix: config.filenamePrefix, images: ['314', 0] },
      };
    } else {
      // Only primary face — single PuLID pass on dual scene
      workflow['14'] = {
        class_type: 'SaveImage',
        inputs: { filename_prefix: config.filenamePrefix, images: ['306', 0] },
      };
    }
  } else {
    // Node 14: SaveImage (no PuLID)
    workflow['14'] = {
      class_type: 'SaveImage',
      inputs: {
        filename_prefix: config.filenamePrefix,
        images: ['13', 0],
      },
    };
  }

  return workflow;
}

// ============================================================
// Combined SDXL body + Flux PuLID portrait workflow
// ============================================================

export interface SdxlPulidPortraitConfig {
  // SDXL body generation section
  positivePrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  seed: number;
  checkpointName: string;
  loras?: Array<{ filename: string; strengthModel: number; strengthClip: number }>;
  filenamePrefix: string;
  // Flux + PuLID face injection section
  /** Approved face portrait image name — must match images[].name in RunPod request */
  faceRefImageName: string;
  /** PuLID model influence strength. Default: 0.95 */
  pulidWeight?: number;
  /** KSampler denoise for PuLID pass — preserves SDXL body, repaints face. Default: 0.65 */
  pulidDenoise?: number;
  /** SFW mode for Flux model selection. Default: false (use NSFW checkpoint for body portraits) */
  sfwMode?: boolean;
}

/**
 * Build a combined SDXL body + Flux PuLID portrait workflow.
 *
 * Architecture (one ComfyUI graph, one RunPod job):
 *
 *   SDXL section (nodes 100–115):
 *     CheckpointLoaderSimple → LoRA chain → CLIPTextEncode × 2
 *     → EmptyLatentImage → KSampler → VAEDecode (body pixels)
 *
 *   Flux + PuLID section (nodes 1–4, 200–209):
 *     UNETLoader + DualCLIPLoader + VAELoader → CLIPTextEncode
 *     PuLIDModelLoader + EVACLIPLoader + LoadImage(face_ref)
 *     → ApplyPulidFlux (patches Flux model with face identity)
 *     → VAEEncode(SDXL body) → KSampler(denoise=0.65) → VAEDecode → SaveImage
 *
 * ComfyUI unloads SDXL before loading Flux, so VRAM is not additive.
 * The SDXL body is never saved — it's an intermediate pixel buffer only.
 */
export function buildSdxlPulidPortraitWorkflow(
  config: SdxlPulidPortraitConfig,
): Record<string, any> {
  const workflow: Record<string, any> = {};
  const pulidWeight = config.pulidWeight ?? 0.95;
  const pulidDenoise = config.pulidDenoise ?? 0.65;

  const fluxModelName = config.sfwMode === false
    ? (process.env.KONTEXT_NSFW_MODEL || process.env.KONTEXT_MODEL || 'flux1KreaDev_fp8E4m3fn.safetensors')
    : (process.env.KONTEXT_MODEL || 'flux1KreaDev_fp8E4m3fn.safetensors');

  // ── SDXL section ──────────────────────────────────────────────────────

  // Node 100: CheckpointLoaderSimple — RealVisXL V5.0
  workflow['100'] = {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: config.checkpointName },
  };

  // LoRA chain (nodes 110+) — curvy-body, melanin, skin LoRAs etc.
  let sdxlModelRef: [string, number] = ['100', 0];
  let sdxlClipRef: [string, number] = ['100', 1];

  if (config.loras && config.loras.length > 0) {
    const capped = config.loras.slice(0, 6);
    for (let i = 0; i < capped.length; i++) {
      const nodeId = String(110 + i);
      const lora = capped[i];
      workflow[nodeId] = {
        class_type: 'LoraLoader',
        inputs: {
          lora_name: lora.filename,
          strength_model: lora.strengthModel,
          strength_clip: lora.strengthClip,
          model: sdxlModelRef,
          clip: sdxlClipRef,
        },
      };
      sdxlModelRef = [nodeId, 0];
      sdxlClipRef = [nodeId, 1];
    }
  }

  // Node 101: CLIPTextEncode positive (SDXL body prompt)
  workflow['101'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: config.positivePrompt, clip: sdxlClipRef },
  };

  // Node 102: CLIPTextEncode negative
  workflow['102'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: config.negativePrompt, clip: sdxlClipRef },
  };

  // Node 103: EmptyLatentImage
  workflow['103'] = {
    class_type: 'EmptyLatentImage',
    inputs: { width: config.width, height: config.height, batch_size: 1 },
  };

  // Node 104: KSampler — SDXL body generation
  workflow['104'] = {
    class_type: 'KSampler',
    inputs: {
      model: sdxlModelRef,
      positive: ['101', 0],
      negative: ['102', 0],
      latent_image: ['103', 0],
      seed: config.seed,
      steps: 30,
      cfg: 7.0,
      sampler_name: 'dpmpp_2m',
      scheduler: 'karras',
      denoise: 1.0,
    },
  };

  // Node 105: VAEDecode — SDXL body → pixel buffer (intermediate, not saved)
  workflow['105'] = {
    class_type: 'VAEDecode',
    inputs: {
      samples: ['104', 0],
      vae: ['100', 2],  // SDXL checkpoint VAE output
    },
  };

  // ── Flux + PuLID section ──────────────────────────────────────────────

  // Node 1: UNETLoader — Flux Krea Dev (NSFW for body portraits)
  workflow['1'] = {
    class_type: 'UNETLoader',
    inputs: { unet_name: fluxModelName, weight_dtype: 'fp8_e4m3fn' },
  };

  // Node 2: DualCLIPLoader — T5 + CLIP-L text encoders
  workflow['2'] = {
    class_type: 'DualCLIPLoader',
    inputs: {
      clip_name1: 't5xxl_fp8_e4m3fn_scaled.safetensors',
      clip_name2: 'clip_l.safetensors',
      type: 'flux',
    },
  };

  // Node 3: VAELoader — Flux VAE
  workflow['3'] = {
    class_type: 'VAELoader',
    inputs: { vae_name: 'ae.safetensors' },
  };

  // Node 4: CLIPTextEncode — minimal Flux prompt (PuLID carries identity)
  workflow['4'] = {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: 'A full body portrait photograph, fully clothed, photorealistic, high quality.',
      clip: ['2', 0],
    },
  };

  // Node 200: LoadImage — approved face portrait (identity reference for PuLID)
  workflow['200'] = {
    class_type: 'LoadImage',
    inputs: { image: config.faceRefImageName },
  };

  // Node 201: PulidModelLoader
  workflow['201'] = {
    class_type: 'PulidModelLoader',
    inputs: { pulid_file: 'pulid_flux_v0.9.1.safetensors' },
  };

  // Node 202: PulidEvaClipLoader (no required inputs)
  workflow['202'] = {
    class_type: 'PulidEvaClipLoader',
    inputs: {},
  };

  // Node 220: PulidInsightFaceLoader — face detection/alignment
  workflow['220'] = {
    class_type: 'PulidInsightFaceLoader',
    inputs: { provider: 'CUDA' },
  };

  // Node 203: ApplyPulid — patch Flux model with face identity
  workflow['203'] = {
    class_type: 'ApplyPulid',
    inputs: {
      model: ['1', 0],
      pulid: ['201', 0],
      eva_clip: ['202', 0],
      face_analysis: ['220', 0],
      image: ['200', 0],
      method: 'fidelity',
      weight: pulidWeight,
      start_at: 0.0,
      end_at: 1.0,
    },
  };

  // Node 204: VAEEncode — encode SDXL body pixels using Flux VAE
  workflow['204'] = {
    class_type: 'VAEEncode',
    inputs: {
      pixels: ['105', 0],  // SDXL body pixel output
      vae: ['3', 0],       // Flux VAE
    },
  };

  // Node 205: FluxGuidance
  workflow['205'] = {
    class_type: 'FluxGuidance',
    inputs: { conditioning: ['4', 0], guidance: 2.5 },
  };

  // Node 206: ConditioningZeroOut — Flux has no negative prompt
  workflow['206'] = {
    class_type: 'ConditioningZeroOut',
    inputs: { conditioning: ['4', 0] },
  };

  // Node 207: KSampler — Flux img2img with PuLID identity injection
  workflow['207'] = {
    class_type: 'KSampler',
    inputs: {
      model: ['203', 0],         // PuLID-patched Flux model
      positive: ['205', 0],
      negative: ['206', 0],
      latent_image: ['204', 0],  // SDXL body as starting latent
      seed: config.seed + 1,
      steps: 20,
      cfg: 1.0,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: pulidDenoise,
    },
  };

  // Node 208: VAEDecode
  workflow['208'] = {
    class_type: 'VAEDecode',
    inputs: { samples: ['207', 0], vae: ['3', 0] },
  };

  // Node 209: SaveImage — final portrait output
  workflow['209'] = {
    class_type: 'SaveImage',
    inputs: {
      filename_prefix: config.filenamePrefix,
      images: ['208', 0],
    },
  };

  return workflow;
}
