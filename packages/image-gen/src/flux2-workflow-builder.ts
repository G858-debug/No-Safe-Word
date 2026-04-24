/**
 * Flux 2 Dev ComfyUI workflow builder.
 *
 * Architecture (confirmed against the live RunPod volume):
 *   - UNETLoader — flux2-dev-fp8_scaled.safetensors (diffusion_models/)
 *   - DualCLIPLoader — t5xxl_fp8_e4m3fn_scaled.safetensors + clip_l.safetensors, type="flux"
 *   - VAELoader — flux2-vae.safetensors
 *   - ModelSamplingFlux — configures Flux sampling schedule (max_shift/base_shift)
 *   - PuLID face injection (ComfyUI_PuLID_Flux_ll) — compatible with KSampler path
 *   - KSampler — cfg=1.0, scheduler=simple, sampler=euler
 *
 * PuLID notes:
 *   ApplyPulidFlux works with the KSampler path. SamplerCustomAdvanced causes
 *   'NoneType' object is not callable at runtime — do not use it here.
 *
 * Models on the network volume (extra_model_paths.yaml):
 *   diffusion_models/flux2-dev-fp8_scaled.safetensors
 *   clip/t5xxl_fp8_e4m3fn_scaled.safetensors
 *   clip/clip_l.safetensors
 *   vae/flux2-vae.safetensors
 *   pulid/pulid_flux_v0.9.1.safetensors
 *   clip_vision/EVA02_CLIP_L_336_psz14_s6B.pt
 */

const DEFAULT_UNET = 'flux2-dev-fp8_scaled.safetensors';
const DEFAULT_T5 = 't5xxl_fp8_e4m3fn_scaled.safetensors';
const DEFAULT_CLIP_L = 'clip_l.safetensors';
const DEFAULT_VAE = 'flux2-vae.safetensors';
const DEFAULT_CFG = 1.0;
const DEFAULT_STEPS = 28;
const DEFAULT_SAMPLER = 'euler';
const DEFAULT_SCHEDULER = 'simple';
const DEFAULT_CONTROLNET_MODEL = 'FLUX.2-dev-Fun-Controlnet-Union-2602.safetensors';

export interface Flux2ReferenceImage {
  /** Filename in the ComfyUI input directory (must be included in the RunPod `images` array). */
  name: string;
  /** Optional PuLID conditioning strength (0.0–1.0, default 0.85). */
  strength?: number;
}

export interface Flux2ControlNetConfig {
  /** Filename of the pose/depth/canny control image (must be in the job's images array). */
  controlImageName: string;
  /** Conditioning strength (default 0.70). */
  strength?: number;
  /** Which preprocessor to run on the control image: 'openpose' extracts skeleton via DWPose. */
  preprocessor?: 'openpose';
  /** Override the ControlNet model name. */
  controlNetModel?: string;
}

export interface Flux2WorkflowOptions {
  /** Full scene prompt already assembled (scene text + visual signature). */
  prompt: string;
  /** Image width (multiple of 8). */
  width: number;
  /** Image height (multiple of 8). */
  height: number;
  /** Random seed. */
  seed: number;
  /** Reference images for PuLID face injection (0–2 supported). */
  references?: Flux2ReferenceImage[];
  /** Optional pose/depth/canny conditioning. */
  controlNet?: Flux2ControlNetConfig;
  steps?: number;
  cfg?: number;
  samplerName?: string;
  scheduler?: string;
  /** Filename prefix for SaveImage. */
  filenamePrefix: string;
  /** Model filename overrides. */
  unetName?: string;
  t5Name?: string;
  clipLName?: string;
  vaeName?: string;
}

export function buildFlux2Workflow(
  options: Flux2WorkflowOptions
): Record<string, any> {
  const workflow: Record<string, any> = {};

  const unetName   = options.unetName   || DEFAULT_UNET;
  const t5Name     = options.t5Name     || DEFAULT_T5;
  const clipLName  = options.clipLName  || DEFAULT_CLIP_L;
  const vaeName    = options.vaeName    || DEFAULT_VAE;

  // ── Model loaders ──
  workflow['100'] = {
    class_type: 'UNETLoader',
    inputs: { unet_name: unetName, weight_dtype: 'fp8_e4m3fn' },
  };

  workflow['101'] = {
    class_type: 'DualCLIPLoader',
    inputs: {
      clip_name1: t5Name,
      clip_name2: clipLName,
      type: 'flux',
    },
  };

  workflow['102'] = {
    class_type: 'VAELoader',
    inputs: { vae_name: vaeName },
  };

  // Node 103: ModelSamplingFlux — configures Flux sampling schedule for KSampler
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
  const vaeRef:  [string, number] = ['102', 0];

  // ── PuLID face identity conditioning ──
  // ApplyPulidFlux is chained on the ModelSamplingFlux output.
  // Compatible with KSampler; do NOT use with SamplerCustomAdvanced.
  if (options.references && options.references.length > 0) {
    workflow['290'] = {
      class_type: 'PulidFluxInsightFaceLoader',
      inputs: { provider: 'CUDA' },
    };
    workflow['291'] = {
      class_type: 'PulidFluxEvaClipLoader',
      inputs: { model: 'EVA02_CLIP_L_336_psz14_s6B.pt' },
    };
    workflow['292'] = {
      class_type: 'PulidFluxModelLoader',
      inputs: { pulid_file: 'pulid_flux_v0.9.1.safetensors' },
    };

    const refs = options.references.slice(0, 2);
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i];
      const loadId  = String(300 + i * 2);
      const applyId = String(301 + i * 2);
      workflow[loadId] = {
        class_type: 'LoadImage',
        inputs: { image: ref.name },
      };
      workflow[applyId] = {
        class_type: 'ApplyPulidFlux',
        inputs: {
          model:         modelRef,
          pulid_flux:    ['292', 0],
          eva_clip:      ['291', 0],
          image:         [loadId, 0],
          face_analysis: ['290', 0],
          weight:        ref.strength ?? 0.85,
          start_at:      0.0,
          end_at:        1.0,
        },
      };
      modelRef = [applyId, 0];
    }
  }

  // ── Text encoding ──
  workflow['200'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: options.prompt, clip: clipRef },
  };
  workflow['201'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: '', clip: clipRef },
  };

  let positiveRef: [string, number] = ['200', 0];
  let negativeRef: [string, number] = ['201', 0];

  // ── ControlNet (optional) ──
  if (options.controlNet) {
    const cn = options.controlNet;
    workflow['400'] = {
      class_type: 'LoadImage',
      inputs: { image: cn.controlImageName },
    };

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

    workflow['402'] = {
      class_type: 'ControlNetLoader',
      inputs: { control_net_name: cn.controlNetModel || DEFAULT_CONTROLNET_MODEL },
    };
    workflow['403'] = {
      class_type: 'ControlNetApplyAdvanced',
      inputs: {
        positive:      positiveRef,
        negative:      negativeRef,
        control_net:   ['402', 0],
        image:         controlImageRef,
        strength:      cn.strength ?? 0.7,
        start_percent: 0.0,
        end_percent:   1.0,
      },
    };

    positiveRef = ['403', 0];
    negativeRef = ['403', 1];
  }

  // ── Latent + KSampler + decode ──
  workflow['500'] = {
    class_type: 'EmptyLatentImage',
    inputs: { width: options.width, height: options.height, batch_size: 1 },
  };

  workflow['501'] = {
    class_type: 'KSampler',
    inputs: {
      model:        modelRef,
      positive:     positiveRef,
      negative:     negativeRef,
      latent_image: ['500', 0],
      seed:         options.seed,
      steps:        options.steps    ?? DEFAULT_STEPS,
      cfg:          options.cfg      ?? DEFAULT_CFG,
      sampler_name: options.samplerName ?? DEFAULT_SAMPLER,
      scheduler:    options.scheduler   ?? DEFAULT_SCHEDULER,
      denoise:      1.0,
    },
  };

  workflow['502'] = {
    class_type: 'VAEDecode',
    inputs: { samples: ['501', 0], vae: vaeRef },
  };

  workflow['503'] = {
    class_type: 'SaveImage',
    inputs: { filename_prefix: options.filenamePrefix, images: ['502', 0] },
  };

  return workflow;
}
