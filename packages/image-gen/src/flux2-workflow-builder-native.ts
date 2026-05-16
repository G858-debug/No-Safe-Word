/**
 * Flux 2 Dev native multi-reference workflow builder.
 *
 * Replaces the PuLID-based builder with ComfyUI built-in nodes only:
 *   VAEEncode → ReferenceLatent per reference image (no custom nodes)
 *   FluxGuidance → BasicGuider → SamplerCustomAdvanced → VAEDecode
 *
 * No custom nodes required. No PuLID, no InsightFace, no EVA-CLIP.
 * Reference images are encoded as latents and attached to the conditioning
 * stream — Flux 2 reads reference_latents natively in its forward pass.
 *
 * Models (must match flux2-workflow-builder.ts):
 *   diffusion_models/flux2-dev-fp8_scaled.safetensors
 *   clip/mistral_3_small_flux2_fp8.safetensors
 *   vae/flux2-vae.safetensors
 */

import type { Flux2WorkflowOptions } from "./flux2-workflow-builder";

// Model filenames — must match flux2-workflow-builder.ts DEFAULT_* constants.
const NATIVE_UNET = "flux2-dev-fp8_scaled.safetensors";
const NATIVE_CLIP = "mistral_3_small_flux2_fp8.safetensors";
const NATIVE_VAE  = "flux2-vae.safetensors";

const NATIVE_STEPS        = 28;
const NATIVE_GUIDANCE     = 3.5;
const NATIVE_SAMPLER      = "euler";
const NATIVE_WEIGHT_DTYPE = "fp8_e4m3fn";
const NATIVE_DENOISE      = 1.0;

export function buildFlux2NativeWorkflow(
  options: Flux2WorkflowOptions
): Record<string, any> {
  const workflow: Record<string, any> = {};

  const unetName = options.unetName || NATIVE_UNET;
  const clipName = options.clipName || NATIVE_CLIP;
  const vaeName  = options.vaeName  || NATIVE_VAE;

  // ── Model loaders ──────────────────────────────────────────────────────
  workflow["100"] = {
    class_type: "UNETLoader",
    inputs: { unet_name: unetName, weight_dtype: NATIVE_WEIGHT_DTYPE },
  };
  workflow["101"] = {
    class_type: "CLIPLoader",
    inputs: { clip_name: clipName, type: "flux2" },
  };
  workflow["102"] = {
    class_type: "VAELoader",
    inputs: { vae_name: vaeName },
  };

  // ── Text encoding ──────────────────────────────────────────────────────
  workflow["200"] = {
    class_type: "CLIPTextEncode",
    inputs: { text: options.prompt, clip: ["101", 0] },
  };

  // ── Reference image chain ──────────────────────────────────────────────
  // Each reference: LoadImage → VAEEncode → ReferenceLatent (chains the
  // conditioning from the previous node).
  //
  // Node IDs: 300 + i*10 = LoadImage
  //           301 + i*10 = VAEEncode
  //           302 + i*10 = ReferenceLatent
  //
  // If no references, FluxGuidance reads directly from CLIPTextEncode (200).
  const refs = options.references ?? [];

  let condRef: [string, number] = ["200", 0];

  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    const loadId  = String(300 + i * 10);
    const encId   = String(301 + i * 10);
    const refId   = String(302 + i * 10);

    workflow[loadId] = {
      class_type: "LoadImage",
      inputs: { image: ref.name },
    };
    workflow[encId] = {
      class_type: "VAEEncode",
      inputs: { pixels: [loadId, 0], vae: ["102", 0] },
    };
    workflow[refId] = {
      class_type: "ReferenceLatent",
      // conditioning: the previous cond output; latent: this ref's VAEEncode output.
      inputs: { conditioning: condRef, latent: [encId, 0] },
    };

    condRef = [refId, 0];
  }

  // ── FluxGuidance (applied to final condRef after all references) ────────
  workflow["400"] = {
    class_type: "FluxGuidance",
    inputs: { conditioning: condRef, guidance: NATIVE_GUIDANCE },
  };

  // ── Latent canvas ───────────────────────────────────────────────────────
  workflow["500"] = {
    class_type: "EmptyFlux2LatentImage",
    inputs: { width: options.width, height: options.height, batch_size: 1 },
  };

  // ── Sampler chain (SamplerCustomAdvanced, no KSampler) ─────────────────
  workflow["501"] = {
    class_type: "Flux2Scheduler",
    inputs: {
      model:   ["100", 0],
      steps:   options.steps ?? NATIVE_STEPS,
      denoise: NATIVE_DENOISE,
    },
  };
  workflow["502"] = {
    class_type: "KSamplerSelect",
    inputs: { sampler_name: NATIVE_SAMPLER },
  };
  workflow["503"] = {
    class_type: "RandomNoise",
    inputs: { noise_seed: options.seed },
  };
  workflow["504"] = {
    class_type: "BasicGuider",
    inputs: { model: ["100", 0], conditioning: ["400", 0] },
  };
  workflow["505"] = {
    class_type: "SamplerCustomAdvanced",
    inputs: {
      noise:        ["503", 0],
      guider:       ["504", 0],
      sampler:      ["502", 0],
      sigmas:       ["501", 0],
      latent_image: ["500", 0],
    },
  };

  // ── Decode + save ───────────────────────────────────────────────────────
  workflow["600"] = {
    class_type: "VAEDecode",
    inputs: { samples: ["505", 0], vae: ["102", 0] },
  };
  workflow["601"] = {
    class_type: "SaveImage",
    inputs: { filename_prefix: options.filenamePrefix, images: ["600", 0] },
  };

  return workflow;
}
