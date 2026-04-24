/**
 * Flux 2 Dev ComfyUI workflow builder.
 *
 * Flux 2 Dev is a distinct architecture from SDXL/Juggernaut:
 *   - Dual text encoders (T5-XXL + CLIP-L) via DualCLIPLoader
 *   - Own VAE (loaded separately, not bundled in the checkpoint)
 *   - No negative prompt (Flux doesn't use them effectively)
 *   - euler/normal sampler, ~25 steps, low CFG (3.5-4.5)
 *   - Character consistency via PuLID face injection (not LoRAs)
 *
 * Node architecture (base path):
 *   CheckpointLoaderSimple (UNET) → ModelSamplingFlux
 *   DualCLIPLoader → CLIPTextEncode(pos) + CLIPTextEncode(neg=empty)
 *   VAELoader
 *   [optional] PulidFluxInsightFaceLoader + PulidFluxEvaClipLoader + PulidFluxModelLoader
 *              → LoadImage → ApplyPulidFlux (chained per reference)
 *   [optional] ControlNet (Flux2Fun Controlnet Union) → ControlNetApplyAdvanced
 *   EmptyLatentImage → KSampler → VAEDecode → SaveImage
 *
 * Custom nodes required (all installed in the base Docker image):
 *   - "DualCLIPLoader" (built-in to modern ComfyUI)
 *   - "ModelSamplingFlux" (built-in)
 *   - "PulidFluxInsightFaceLoader" / "PulidFluxEvaClipLoader" /
 *     "PulidFluxModelLoader" / "ApplyPulidFlux"  — ComfyUI_PuLID_Flux_ll
 *   - "ControlNetApplyAdvanced" (built-in)
 */

const DEFAULT_CHECKPOINT = 'flux2-dev.safetensors';
const DEFAULT_VAE = 'flux2-vae.safetensors';
const DEFAULT_T5 = 't5xxl_fp16.safetensors';
const DEFAULT_CLIP_L = 'clip_l.safetensors';
const DEFAULT_CFG = 3.5;
const DEFAULT_STEPS = 25;
const DEFAULT_SAMPLER = 'euler';
const DEFAULT_SCHEDULER = 'normal';
const DEFAULT_CONTROLNET_MODEL = 'FLUX.2-dev-Fun-Controlnet-Union-2602.safetensors';

export interface Flux2ReferenceImage {
  /** Filename in the ComfyUI input directory (must be included in the RunPod `images` array). */
  name: string;
  /** Optional conditioning strength for this reference (0.0–1.0, default 1.0). */
  strength?: number;
}

export interface Flux2ControlNetConfig {
  /** Filename of the pose/depth/canny control image (must be in the job's images array). */
  controlImageName: string;
  /** Conditioning strength (default 0.70). */
  strength?: number;
  /** Which preprocessor to run on the control image: 'openpose' extracts skeleton via DWPose.
   *  If omitted, the control image is used as-is. */
  preprocessor?: 'openpose';
  /** Override the ControlNet model name if the base image ships an alternative. */
  controlNetModel?: string;
}

export interface Flux2WorkflowOptions {
  /** Full scene prompt already assembled (scene text + visual signature). */
  prompt: string;
  /** Image width (multiple of 8). */
  width: number;
  /** Image height (multiple of 8). */
  height: number;
  /** Random seed (-1 → ComfyUI picks). */
  seed: number;
  /** Reference images for character consistency (0-2 supported). */
  references?: Flux2ReferenceImage[];
  /** Optional pose/depth/canny conditioning. */
  controlNet?: Flux2ControlNetConfig;
  /** Sampler / schedule overrides. */
  steps?: number;
  cfg?: number;
  samplerName?: string;
  scheduler?: string;
  /** Filename prefix for SaveImage. */
  filenamePrefix: string;
  /** Override checkpoint/VAE/text-encoder filenames. */
  checkpointName?: string;
  vaeName?: string;
  t5Name?: string;
  clipLName?: string;
}

/**
 * Build a Flux 2 Dev ComfyUI workflow.
 *
 * Character identity comes from reference images (FluxReferenceApply) rather
 * than trained LoRAs — so the LoRA stack present in the Juggernaut workflow
 * is intentionally absent here.
 */
export function buildFlux2Workflow(
  options: Flux2WorkflowOptions
): Record<string, any> {
  const workflow: Record<string, any> = {};

  const checkpointName = options.checkpointName || DEFAULT_CHECKPOINT;
  const vaeName = options.vaeName || DEFAULT_VAE;
  const t5Name = options.t5Name || DEFAULT_T5;
  const clipLName = options.clipLName || DEFAULT_CLIP_L;

  // ── Model loaders ──
  // Node 100: UNET / model weights
  workflow['100'] = {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: checkpointName },
  };

  // Node 101: DualCLIPLoader — T5-XXL + CLIP-L for Flux text encoding
  workflow['101'] = {
    class_type: 'DualCLIPLoader',
    inputs: {
      clip_name1: t5Name,
      clip_name2: clipLName,
      type: 'flux',
    },
  };

  // Node 102: VAELoader (Flux 2 uses its own VAE, not the bundled SDXL one)
  workflow['102'] = {
    class_type: 'VAELoader',
    inputs: { vae_name: vaeName },
  };

  // Node 103: ModelSamplingFlux — configures the Flux sampling schedule
  workflow['103'] = {
    class_type: 'ModelSamplingFlux',
    inputs: {
      model: ['100', 0],
      max_shift: 1.15,
      base_shift: 0.5,
      width: options.width,
      height: options.height,
    },
  };

  let modelRef: [string, number] = ['103', 0];
  const clipRef: [string, number] = ['101', 0];
  const vaeRef: [string, number] = ['102', 0];

  // ── Text encoding ──
  // Node 200: Positive prompt via dual CLIP
  workflow['200'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: options.prompt, clip: clipRef },
  };

  // Node 201: Negative (empty — Flux ignores it but ComfyUI requires the input)
  workflow['201'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: '', clip: clipRef },
  };

  let positiveRef: [string, number] = ['200', 0];
  let negativeRef: [string, number] = ['201', 0];

  // ── PuLID face identity conditioning (character consistency) ──
  // PuLID injects face identity from approved character portraits into the
  // model without LoRAs. Three shared loader nodes are added once, then
  // ApplyPulidFlux is chained per reference portrait (up to 2).
  //
  // Models on the network volume (mapped in extra_model_paths.yaml):
  //   pulid/pulid_flux_v0.9.1.safetensors
  //   clip_vision/EVA02_CLIP_L_336_psz14_s6B.pt
  //   InsightFace buffalo_l — pre-downloaded at image build time
  if (options.references && options.references.length > 0) {
    // Node 290: InsightFace loader (face detection)
    workflow['290'] = {
      class_type: 'PulidFluxInsightFaceLoader',
      inputs: { provider: 'CUDA' },
    };
    // Node 291: EVA-02 CLIP vision encoder
    workflow['291'] = {
      class_type: 'PulidFluxEvaClipLoader',
      inputs: { model: 'EVA02_CLIP_L_336_psz14_s6B.pt' },
    };
    // Node 292: PuLID model weights
    workflow['292'] = {
      class_type: 'PulidFluxModelLoader',
      inputs: { pulid_file: 'pulid_flux_v0.9.1.safetensors' },
    };

    const refs = options.references.slice(0, 2);
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i];
      const loadId = String(300 + i * 2);
      const applyId = String(301 + i * 2);
      workflow[loadId] = {
        class_type: 'LoadImage',
        inputs: { image: ref.name },
      };
      workflow[applyId] = {
        class_type: 'ApplyPulidFlux',
        inputs: {
          model: modelRef,
          pulid: ['292', 0],
          eva_clip: ['291', 0],
          face_cond_image: [loadId, 0],
          insightface: ['290', 0],
          weight: ref.strength ?? 0.85,
          start_at: 0.0,
          end_at: 1.0,
        },
      };
      modelRef = [applyId, 0];
    }
  }

  // ── ControlNet (optional — Flux2Fun Controlnet Union) ──
  if (options.controlNet) {
    const cn = options.controlNet;

    // Node 400: LoadImage — control image (pose photo, depth map, canny, …)
    workflow['400'] = {
      class_type: 'LoadImage',
      inputs: { image: cn.controlImageName },
    };

    // Optional preprocessor — DWPose for OpenPose skeletons
    let controlImageRef: [string, number] = ['400', 0];
    if (cn.preprocessor === 'openpose') {
      workflow['401'] = {
        class_type: 'DWPreprocessor',
        inputs: {
          image: ['400', 0],
          detect_hand: 'enable',
          detect_body: 'enable',
          detect_face: 'enable',
          resolution: Math.max(options.width, options.height),
          bbox_detector: 'yolox_l.onnx',
          pose_estimator: 'dw-ll_ucoco_384.onnx',
        },
      };
      controlImageRef = ['401', 0];
    }

    // Node 402: ControlNet model loader
    workflow['402'] = {
      class_type: 'ControlNetLoader',
      inputs: {
        control_net_name: cn.controlNetModel || DEFAULT_CONTROLNET_MODEL,
      },
    };

    // Node 403: Merge control-conditioning into the prompt chain
    workflow['403'] = {
      class_type: 'ControlNetApplyAdvanced',
      inputs: {
        positive: positiveRef,
        negative: negativeRef,
        control_net: ['402', 0],
        image: controlImageRef,
        strength: cn.strength ?? 0.7,
        start_percent: 0.0,
        end_percent: 1.0,
      },
    };

    positiveRef = ['403', 0];
    negativeRef = ['403', 1];
  }

  // ── Latent + sampler + decode ──
  // Node 500: EmptyLatentImage
  workflow['500'] = {
    class_type: 'EmptyLatentImage',
    inputs: {
      width: options.width,
      height: options.height,
      batch_size: 1,
    },
  };

  // Node 501: KSampler — Flux defaults (euler/normal, low CFG, ~25 steps)
  workflow['501'] = {
    class_type: 'KSampler',
    inputs: {
      model: modelRef,
      positive: positiveRef,
      negative: negativeRef,
      latent_image: ['500', 0],
      seed: options.seed,
      steps: options.steps ?? DEFAULT_STEPS,
      cfg: options.cfg ?? DEFAULT_CFG,
      sampler_name: options.samplerName ?? DEFAULT_SAMPLER,
      scheduler: options.scheduler ?? DEFAULT_SCHEDULER,
      denoise: 1.0,
    },
  };

  // Node 502: VAEDecode — uses the Flux 2 VAE, not the checkpoint's bundled VAE
  workflow['502'] = {
    class_type: 'VAEDecode',
    inputs: {
      samples: ['501', 0],
      vae: vaeRef,
    },
  };

  // Node 503: SaveImage
  workflow['503'] = {
    class_type: 'SaveImage',
    inputs: {
      filename_prefix: options.filenamePrefix,
      images: ['502', 0],
    },
  };

  return workflow;
}
