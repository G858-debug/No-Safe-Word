/**
 * Flux 2 Dev ComfyUI workflow builder.
 *
 * Flux 2 Dev is a distinct architecture from SDXL/Juggernaut:
 *   - UNET-only loader (UNETLoader), NOT CheckpointLoaderSimple
 *   - Single CLIPLoader with Mistral 3 Small encoder (type: "flux2")
 *   - Own VAE (loaded separately)
 *   - No negative prompt — FluxGuidance replaces CFG conditioning
 *   - Advanced sampler chain: RandomNoise → BetaSamplingScheduler → BasicGuider → SamplerCustomAdvanced
 *   - Character consistency via PuLID face injection (not LoRAs)
 *
 * Node architecture (base path):
 *   UNETLoader → [PuLID chain (optional)]
 *   CLIPLoader → CLIPTextEncode → [ControlNet (optional)] → FluxGuidance → BasicGuider
 *   VAELoader
 *   EmptyFlux2LatentImage → RandomNoise + KSamplerSelect + BetaSamplingScheduler
 *   → SamplerCustomAdvanced → VAEDecode → SaveImage
 *
 * Custom nodes required (all installed in the base Docker image):
 *   - "PulidFluxInsightFaceLoader" / "PulidFluxEvaClipLoader" /
 *     "PulidFluxModelLoader" / "ApplyPulidFlux"  — ComfyUI_PuLID_Flux_ll
 *   - "ControlNetApplyAdvanced" (built-in)
 */

const DEFAULT_UNET = 'flux2-dev-fp8_scaled.safetensors';
const DEFAULT_CLIP = 'mistral_3_small_flux2_fp8.safetensors';
const DEFAULT_VAE = 'flux2-vae.safetensors';
const DEFAULT_CFG = 3.5;
const DEFAULT_STEPS = 28;
const DEFAULT_SAMPLER = 'euler';
const DEFAULT_CONTROLNET_MODEL = 'FLUX.2-dev-Fun-Controlnet-Union-2602.safetensors';

export interface Flux2ReferenceImage {
  /** Filename in the ComfyUI input directory (must be included in the RunPod `images` array). */
  name: string;
  /** Optional conditioning strength for this reference (0.0–1.0, default 0.85). */
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
  /** Reference images for character consistency via PuLID (0-2 supported). */
  references?: Flux2ReferenceImage[];
  /** Optional pose/depth/canny conditioning. */
  controlNet?: Flux2ControlNetConfig;
  /** Sampler / step overrides. */
  steps?: number;
  cfg?: number;
  samplerName?: string;
  /** Filename prefix for SaveImage. */
  filenamePrefix: string;
  /** Override model filenames. */
  unetName?: string;
  clipName?: string;
  vaeName?: string;
}

/**
 * Build a Flux 2 Dev ComfyUI workflow.
 *
 * Character identity comes from PuLID face injection rather than trained LoRAs.
 * Uses the advanced Flux 2 sampler chain (BetaSamplingScheduler + SamplerCustomAdvanced).
 */
export function buildFlux2Workflow(
  options: Flux2WorkflowOptions
): Record<string, any> {
  const workflow: Record<string, any> = {};

  const unetName = options.unetName || DEFAULT_UNET;
  const clipName = options.clipName || DEFAULT_CLIP;
  const vaeName = options.vaeName || DEFAULT_VAE;

  // ── Model loaders ──
  // Node 100: UNET weights (Flux 2 Dev FP8)
  workflow['100'] = {
    class_type: 'UNETLoader',
    inputs: { unet_name: unetName, weight_dtype: 'fp8_e4m3fn' },
  };

  // Node 101: CLIPLoader — Mistral 3 Small (Flux 2's text encoder, type "flux2")
  workflow['101'] = {
    class_type: 'CLIPLoader',
    inputs: { clip_name: clipName, type: 'flux2' },
  };

  // Node 102: VAELoader
  workflow['102'] = {
    class_type: 'VAELoader',
    inputs: { vae_name: vaeName },
  };

  let modelRef: [string, number] = ['100', 0];
  const clipRef: [string, number] = ['101', 0];
  const vaeRef: [string, number] = ['102', 0];

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
          pulid_flux: ['292', 0],
          eva_clip: ['291', 0],
          image: [loadId, 0],
          face_analysis: ['290', 0],
          weight: ref.strength ?? 0.85,
          start_at: 0.0,
          end_at: 1.0,
        },
      };
      modelRef = [applyId, 0];
    }
  }

  // ── Text encoding ──
  // Node 200: Positive prompt via Mistral CLIP
  workflow['200'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: options.prompt, clip: clipRef },
  };

  let conditioningRef: [string, number] = ['200', 0];

  // ── ControlNet (optional — Flux2Fun Controlnet Union) ──
  // Applied before FluxGuidance so the control signal feeds into conditioning.
  if (options.controlNet) {
    const cn = options.controlNet;

    // Node 400: LoadImage — control image (pose photo, depth map, canny, …)
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
      inputs: {
        control_net_name: cn.controlNetModel || DEFAULT_CONTROLNET_MODEL,
      },
    };

    // Empty conditioning for the ControlNet negative (Flux has no negative prompt)
    workflow['203'] = {
      class_type: 'CLIPTextEncode',
      inputs: { text: '', clip: clipRef },
    };

    workflow['403'] = {
      class_type: 'ControlNetApplyAdvanced',
      inputs: {
        positive: conditioningRef,
        negative: ['203', 0],
        control_net: ['402', 0],
        image: controlImageRef,
        strength: cn.strength ?? 0.7,
        start_percent: 0.0,
        end_percent: 1.0,
      },
    };

    conditioningRef = ['403', 0];
  }

  // Node 201: FluxGuidance — replaces CFG in Flux 2 (no negative prompt)
  workflow['201'] = {
    class_type: 'FluxGuidance',
    inputs: {
      conditioning: conditioningRef,
      guidance: options.cfg ?? DEFAULT_CFG,
    },
  };

  // ── Latent + advanced sampler chain ──
  // Node 500: EmptyFlux2LatentImage
  workflow['500'] = {
    class_type: 'EmptyFlux2LatentImage',
    inputs: {
      width: options.width,
      height: options.height,
      batch_size: 1,
    },
  };

  // Node 501: RandomNoise
  workflow['501'] = {
    class_type: 'RandomNoise',
    inputs: { noise_seed: options.seed },
  };

  // Node 502: KSamplerSelect
  workflow['502'] = {
    class_type: 'KSamplerSelect',
    inputs: { sampler_name: options.samplerName ?? DEFAULT_SAMPLER },
  };

  // Node 503: BetaSamplingScheduler (Flux 2 native scheduler)
  workflow['503'] = {
    class_type: 'BetaSamplingScheduler',
    inputs: {
      model: modelRef,
      steps: options.steps ?? DEFAULT_STEPS,
      alpha: 0.6,
      beta: 0.95,
    },
  };

  // Node 504: BasicGuider — wires model + conditioning
  workflow['504'] = {
    class_type: 'BasicGuider',
    inputs: {
      model: modelRef,
      conditioning: ['201', 0],
    },
  };

  // Node 505: SamplerCustomAdvanced
  workflow['505'] = {
    class_type: 'SamplerCustomAdvanced',
    inputs: {
      noise: ['501', 0],
      guider: ['504', 0],
      sampler: ['502', 0],
      sigmas: ['503', 0],
      latent_image: ['500', 0],
    },
  };

  // Node 506: VAEDecode
  workflow['506'] = {
    class_type: 'VAEDecode',
    inputs: {
      samples: ['505', 0],
      vae: vaeRef,
    },
  };

  // Node 507: SaveImage
  workflow['507'] = {
    class_type: 'SaveImage',
    inputs: {
      filename_prefix: options.filenamePrefix,
      images: ['506', 0],
    },
  };

  return workflow;
}
