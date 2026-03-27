/**
 * V2 Pipeline ComfyUI Workflow Builders
 *
 * Stage B: Florence-2 + SAM2 automated masking
 * Stage C: UnCanny (Chroma) inpainting on the masked region
 *
 * These workflows run on the existing RunPod serverless endpoint.
 * They are completely independent from the V1 Kontext workflow builder.
 *
 * Node names verified against:
 *   - https://github.com/kijai/ComfyUI-Florence2 (nodes.py)
 *   - https://github.com/kijai/ComfyUI-segment-anything-2 (nodes.py)
 */

// ── Stage B: Florence-2 → SAM2 Masking Workflow ──

export interface FlorenceSam2MaskConfig {
  /** Image name in RunPod images[] array (e.g. 'base_scene.jpg') */
  inputImageName: string;
  /** Text query for Florence-2 region detection (e.g. 'clothing', 'dress') */
  florenceQuery: string;
  /** Mask edge feathering radius in pixels */
  maskBlurRadius: number;
  /** Mask expansion in pixels to avoid edge artifacts */
  maskDilationPixels: number;
  /** Filename prefix for saved outputs */
  filenamePrefix: string;
}

/**
 * Build a ComfyUI workflow that:
 * 1. Loads the NB2 base image
 * 2. Runs Florence-2 caption_to_phrase_grounding to detect the target region
 * 3. Converts Florence-2 bounding boxes via Florence2toCoordinates bridge node
 * 4. Runs SAM2 segmentation for pixel-precise masking
 * 5. Expands and feathers the mask for natural blending
 * 6. Saves the mask for debugging
 *
 * Node IDs 100–119 reserved for this stage.
 *
 * Florence-2 → SAM2 connection chain:
 *   Florence2Run slot 3 (JSON with bboxes) →
 *   Florence2toCoordinates (extracts BBOX + center coords) →
 *   Sam2Segmentation (accepts BBOX for pixel-precise mask)
 */
export function buildFlorenceSam2MaskWorkflow(
  config: FlorenceSam2MaskConfig,
): Record<string, any> {
  const workflow: Record<string, any> = {};

  // Node 100: LoadImage — load the NB2 base scene image
  workflow['100'] = {
    class_type: 'LoadImage',
    inputs: {
      image: config.inputImageName,
    },
  };

  // Node 101: DownloadAndLoadFlorence2Model
  // Auto-downloads Florence-2-large on first use, cached in ComfyUI/models/LLM/
  // Verified: class_type='DownloadAndLoadFlorence2Model', returns FL2MODEL
  workflow['101'] = {
    class_type: 'DownloadAndLoadFlorence2Model',
    inputs: {
      model: 'microsoft/Florence-2-large',
      precision: 'fp16',
      attention: 'sdpa',
    },
  };

  // Node 102: Florence2Run — caption_to_phrase_grounding
  // Detects regions matching florenceQuery text and outputs structured bbox data.
  // Returns: IMAGE (0), MASK (1), STRING/caption (2), JSON/data (3)
  // For caption_to_phrase_grounding, slot 3 contains { bboxes: [[x1,y1,x2,y2],...], labels: [...] }
  // Verified: class_type='Florence2Run', task values are exact strings
  workflow['102'] = {
    class_type: 'Florence2Run',
    inputs: {
      image: ['100', 0],
      florence2_model: ['101', 0],
      text_input: config.florenceQuery,
      task: 'caption_to_phrase_grounding',
      fill_mask: true,
      keep_model_loaded: false,
      max_new_tokens: 1024,
      num_beams: 3,
      do_sample: true,
      output_mask_select: '',
      seed: 1,
    },
  };

  // Node 103: Florence2toCoordinates — bridge between Florence-2 and SAM2
  // Converts Florence-2 JSON bbox output into SAM2-compatible BBOX type.
  // Input: JSON (from Florence2Run slot 3)
  // Output: STRING/center_coordinates (0), BBOX/bboxes (1)
  // Verified: class_type='Florence2toCoordinates'
  workflow['103'] = {
    class_type: 'Florence2toCoordinates',
    inputs: {
      data: ['102', 3],  // Florence2Run JSON output (slot 3)
      index: '0',        // Use all detected regions (comma-separated indices)
      batch: false,
    },
  };

  // Node 104: DownloadAndLoadSAM2Model
  // Auto-downloads SAM2 model on first use.
  // Verified: class_type='DownloadAndLoadSAM2Model', model names include .safetensors
  workflow['104'] = {
    class_type: 'DownloadAndLoadSAM2Model',
    inputs: {
      model: 'sam2_hiera_large.safetensors',
      segmentor: 'single_image',
      device: 'cuda',
      precision: 'fp16',
    },
  };

  // Node 105: Sam2Segmentation — pixel-precise mask from Florence-2 bounding boxes
  // Takes BBOX from Florence2toCoordinates and produces a precise segmentation mask.
  // Much more accurate than Florence-2's rectangular bbox mask.
  // Verified: class_type='Sam2Segmentation', accepts bboxes (BBOX type)
  workflow['105'] = {
    class_type: 'Sam2Segmentation',
    inputs: {
      sam2_model: ['104', 0],
      image: ['100', 0],
      bboxes: ['103', 1],          // BBOX output from Florence2toCoordinates (slot 1)
      individual_objects: false,    // Merge all detected regions into one mask
      keep_model_loaded: false,
    },
  };

  // Node 106: GrowMask — dilate the mask edges
  // Dilation prevents hard edges at the mask boundary where inpainted
  // and original pixels meet.
  workflow['106'] = {
    class_type: 'GrowMask',
    inputs: {
      mask: ['105', 0],
      expand: config.maskDilationPixels,
      tapered_corners: true,
    },
  };

  // Node 107: MaskToImage — convert mask to image for blur processing
  workflow['107'] = {
    class_type: 'MaskToImage',
    inputs: {
      mask: ['106', 0],
    },
  };

  // Node 108: ImageBlur — feather mask edges for natural blending
  // Gaussian blur on the mask image creates smooth transitions between
  // the inpainted region and the original image.
  workflow['108'] = {
    class_type: 'ImageBlur',
    inputs: {
      image: ['107', 0],
      blur_radius: config.maskBlurRadius,
      sigma: Math.max(1, Math.floor(config.maskBlurRadius / 2)),
    },
  };

  // Node 109: ImageToMask — convert blurred image back to mask for inpainting
  workflow['109'] = {
    class_type: 'ImageToMask',
    inputs: {
      image: ['108', 0],
      channel: 'red',
    },
  };

  // Mask debug save removed — it was being returned as the final output
  // instead of the inpainted image. The mask is still generated internally
  // by the workflow for the inpainting step (node 109).

  return workflow;
}

// ── Stage C: UnCanny Inpainting Workflow ──

export interface UncannyInpaintWorkflowConfig {
  /** Original NB2 base image name in RunPod images[] array */
  inputImageName: string;
  /** Inpainting prompt — describes what replaces the masked region */
  inpaintPrompt: string;
  /** Random seed for reproducibility */
  seed: number;
  /** Denoise strength for inpainting (0.85–0.95 recommended) */
  denoiseStrength: number;
  /** Filename prefix for saved output */
  filenamePrefix: string;
  /** UnCanny model filename on the network volume */
  uncannyModelName: string;
}

/**
 * Build a combined Florence-2/SAM2 masking + UnCanny inpainting workflow.
 *
 * This is a single ComfyUI workflow that runs both stages sequentially:
 * - Nodes 100–110: Florence-2 + SAM2 masking (Stage B)
 * - Nodes 200–211: UnCanny inpainting (Stage C)
 *
 * Running as one workflow avoids a second RunPod job submission and
 * the latency of transferring the mask image between jobs.
 *
 * Architecture notes:
 * - UnCanny is a Chroma fine-tune (Flux.1-schnell based, 8.9B params)
 * - Uses UNETLoader with fp8_e4m3fn (same pattern as Flux Krea Dev)
 * - Same DualCLIPLoader (t5xxl + clip_l) and VAE (ae.safetensors) as Flux
 * - No negative prompts — Chroma handles this internally
 * - VAEEncodeForInpaint takes original image + mask → masked latent
 * - ImageCompositeMasked composites inpainted region back onto original
 */
export function buildUncannyInpaintWorkflow(config: {
  /** Florence-2 + SAM2 masking config */
  mask: FlorenceSam2MaskConfig;
  /** UnCanny inpainting config */
  inpaint: UncannyInpaintWorkflowConfig;
}): Record<string, any> {
  // Start with the masking workflow (nodes 100–110)
  const workflow = buildFlorenceSam2MaskWorkflow(config.mask);

  const { inpaint } = config;

  // ---- UnCanny Inpainting Nodes (200+) ----

  // Node 200: UNETLoader — Load the UnCanny (Chroma) diffusion model
  // Chroma uses the same UNETLoader as Flux, with fp8 quantisation
  workflow['200'] = {
    class_type: 'UNETLoader',
    inputs: {
      unet_name: inpaint.uncannyModelName,
      weight_dtype: 'fp8_e4m3fn',
    },
  };

  // Node 201: DualCLIPLoader — same text encoders as Flux
  // Chroma inherits the Flux.1-schnell architecture, same CLIP stack
  workflow['201'] = {
    class_type: 'DualCLIPLoader',
    inputs: {
      clip_name1: 't5xxl_fp8_e4m3fn_scaled.safetensors',
      clip_name2: 'clip_l.safetensors',
      type: 'flux',
    },
  };

  // Node 202: VAELoader — same VAE as Flux (ae.safetensors)
  workflow['202'] = {
    class_type: 'VAELoader',
    inputs: {
      vae_name: 'ae.safetensors',
    },
  };

  // Node 203: CLIPTextEncode — encode the inpainting prompt
  // Standard ComfyUI text encoder, works with Flux/Chroma CLIP stack
  workflow['203'] = {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: inpaint.inpaintPrompt,
      clip: ['201', 0],
    },
  };

  // Node 204: FluxGuidance — apply guidance to the inpaint prompt conditioning
  workflow['204'] = {
    class_type: 'FluxGuidance',
    inputs: {
      conditioning: ['203', 0],
      guidance: 3.5,
    },
  };

  // Node 205: ConditioningZeroOut — zero out negative (Chroma has no negative prompt)
  workflow['205'] = {
    class_type: 'ConditioningZeroOut',
    inputs: {
      conditioning: ['203', 0],
    },
  };

  // Node 206: LoadImage — load the original NB2 base image for inpainting
  // Same image as node 100 but referenced explicitly for the inpaint VAE encoder
  workflow['206'] = {
    class_type: 'LoadImage',
    inputs: {
      image: inpaint.inputImageName,
    },
  };

  // Node 207: VAEEncodeForInpaint — encode original image with mask into latent space
  // The mask (from node 109, post-blur) defines the inpaint region.
  // Pixels inside the mask become noise; pixels outside are preserved.
  workflow['207'] = {
    class_type: 'VAEEncodeForInpaint',
    inputs: {
      pixels: ['206', 0],
      vae: ['202', 0],
      mask: ['109', 0], // Post-blur feathered mask from Stage B
      grow_mask_by: 0,  // Already grown in Stage B via GrowMask node
    },
  };

  // Node 208: KSampler — inpaint within the masked region
  // denoise controls how much of the masked region is regenerated:
  //   0.85–0.95 = strong regeneration (good for clothing→skin replacement)
  //   < 0.8 = too much original bleeds through
  workflow['208'] = {
    class_type: 'KSampler',
    inputs: {
      model: ['200', 0],
      positive: ['204', 0],     // FluxGuidance output
      negative: ['205', 0],     // Zeroed-out conditioning
      latent_image: ['207', 0], // VAEEncodeForInpaint output
      seed: inpaint.seed,
      steps: 20,
      cfg: 1.0,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: inpaint.denoiseStrength,
    },
  };

  // Node 209: VAEDecode — decode the inpainted latent back to pixel space
  workflow['209'] = {
    class_type: 'VAEDecode',
    inputs: {
      samples: ['208', 0],
      vae: ['202', 0],
    },
  };

  // Node 210: ImageCompositeMasked — composite inpainted region onto original
  // This ensures ONLY the masked region is replaced. Everything outside the mask
  // is pixel-perfect from the original NB2 image.
  workflow['210'] = {
    class_type: 'ImageCompositeMasked',
    inputs: {
      destination: ['206', 0], // Original NB2 image
      source: ['209', 0],      // Inpainted region
      mask: ['109', 0],        // Feathered mask from Stage B
      x: 0,
      y: 0,
      resize_source: false,
    },
  };

  // Node 211: SaveImage — save the final composited result
  workflow['211'] = {
    class_type: 'SaveImage',
    inputs: {
      filename_prefix: inpaint.filenamePrefix,
      images: ['210', 0],
    },
  };

  return workflow;
}
