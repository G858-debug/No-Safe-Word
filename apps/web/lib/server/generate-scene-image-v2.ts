/**
 * V2 Scene Image Generation Logic
 *
 * Encapsulates the NB2-based scene generation pipeline.
 * Called from the batch generation route and the single-image regenerate
 * route when the series uses `nb2_uncanny` engine.
 *
 * SFW images (facebook_sfw, website_only):
 *   Stage A: NB2 generates the clothed scene
 *   Stage D: Flux Krea Dev img2img with body LoRAs enhances body proportions
 *
 * NSFW paired images (website_nsfw_paired):
 *   Stage A: NB2 generates clothed scene
 *   Stage B+C: Florence-2/SAM2 masking + UnCanny inpainting replaces clothing
 */

import { supabase } from "@no-safe-word/story-engine";
import {
  runNb2Scene,
  submitUncannyInpaintJob,
  buildKontextWorkflow,
  submitRunPodJob,
} from "@no-safe-word/image-gen";

// ── Types ──

export interface ScenePromptInput {
  id: string;
  image_type: string;
  position: number;
  character_id: string | null;
  character_name: string | null;
  secondary_character_id: string | null;
  secondary_character_name: string | null;
  prompt: string;
}

export interface V2SceneParams {
  imgPrompt: ScenePromptInput;
  seriesId: string;
  refUrlMap: Map<string, string[]>;
  seed: number;
  /** NSFW inpaint prompt — describes bare body replacing clothing */
  inpaintPrompt: string;
  /** SFW body enhancement denoise strength. Default: 0.30 */
  sfwDenoise?: number;
  /** NSFW mask query. Default: 'clothing' */
  maskQuery?: string;
  /** NSFW denoise strength. Default: 0.90 */
  denoiseStrength?: number;
  aspectRatio?: string;
}

export interface V2SceneResult {
  /** Image record ID for the NB2 base image */
  nb2ImageId: string;
  /** Supabase Storage URL for the NB2 base image */
  nb2StoredUrl: string | null;
  /** RunPod job ID for the enhancement/inpainting step */
  runpodJobId: string;
  /** Image record ID for the enhanced/inpainted image */
  enhancedImageId: string;
  /** Seed used for generation */
  seed: number;
}

// ── Helpers ──

/**
 * Build a map of character_id → reference image URLs from story_characters.
 * These URLs are passed to NB2 for multi-image character consistency.
 */
export async function buildRefUrlMap(
  seriesId: string,
): Promise<Map<string, string[]>> {
  const { data: storyChars } = await (supabase as any)
    .from("story_characters")
    .select("character_id, face_url, approved_image_id, approved_fullbody_image_id")
    .eq("series_id", seriesId) as {
      data: Array<{
        character_id: string;
        face_url: string | null;
        approved_image_id: string | null;
        approved_fullbody_image_id: string | null;
      }> | null;
    };

  const refUrlMap = new Map<string, string[]>();
  if (!storyChars) return refUrlMap;

  for (const sc of storyChars) {
    const urls: string[] = [];

    if (sc.face_url) {
      urls.push(sc.face_url);
    }

    if (sc.approved_image_id) {
      const { data: faceImg } = await supabase
        .from("images")
        .select("stored_url, sfw_url")
        .eq("id", sc.approved_image_id)
        .single();
      const url = faceImg?.stored_url || faceImg?.sfw_url;
      if (url) urls.push(url);
    }

    if (sc.approved_fullbody_image_id) {
      const { data: bodyImg } = await supabase
        .from("images")
        .select("stored_url, sfw_url")
        .eq("id", sc.approved_fullbody_image_id)
        .single();
      const url = bodyImg?.stored_url || bodyImg?.sfw_url;
      if (url) urls.push(url);
    }

    refUrlMap.set(sc.character_id, urls);
  }

  return refUrlMap;
}

// Default SFW body enhancement prompt for the Flux img2img pass
const DEFAULT_SFW_BODY_PROMPT =
  "Photorealistic photograph, voluptuous Black South African woman, very large natural breasts, " +
  "wide hips, huge round butt, narrow waist, soft stomach, fully clothed, " +
  "natural skin texture, high detail, cinematic lighting";

// ── Main Pipeline ──

/**
 * Generate a scene image using the V2 pipeline.
 *
 * SFW images: NB2 → Flux Krea Dev img2img with body LoRAs
 * NSFW images: NB2 → Florence-2/SAM2 masking → UnCanny inpainting
 */
export async function generateV2Scene(
  params: V2SceneParams,
): Promise<V2SceneResult> {
  const {
    imgPrompt,
    seed,
    inpaintPrompt,
    aspectRatio = "3:4",
    refUrlMap,
  } = params;

  const isNsfwPaired = imgPrompt.image_type === "website_nsfw_paired";
  const mode = isNsfwPaired ? "nsfw" : "sfw";

  // Collect character reference URLs for NB2
  const referenceImageUrls: string[] = [];
  if (imgPrompt.character_id) {
    const urls = refUrlMap.get(imgPrompt.character_id);
    if (urls) referenceImageUrls.push(...urls);
  }
  if (imgPrompt.secondary_character_id) {
    const urls = refUrlMap.get(imgPrompt.secondary_character_id);
    if (urls) referenceImageUrls.push(...urls);
  }

  // ── Stage A: NB2 Scene Generation ──
  console.log(
    `[V2][${imgPrompt.id}] Stage A: NB2 generation with ` +
    `${referenceImageUrls.length} ref images, seed=${seed}`,
  );

  const nb2Result = await runNb2Scene({
    prompt: imgPrompt.prompt,
    referenceImageUrls,
    aspectRatio,
    seed,
    safetyTolerance: 6,
  });

  console.log(
    `[V2][${imgPrompt.id}] Stage A complete: ${Math.round(nb2Result.imageBuffer.length / 1024)}KB`,
  );

  // Create NB2 image record
  const { data: nb2ImageRow, error: nb2ImgError } = await supabase
    .from("images")
    .insert({
      character_id: imgPrompt.character_id || null,
      prompt: imgPrompt.prompt,
      negative_prompt: "",
      settings: {
        seed,
        engine: "replicate-nb2",
        pipelineVersion: "v2-stage-a",
        aspectRatio,
        referenceImageCount: referenceImageUrls.length,
      },
      mode: "sfw",
    })
    .select("id")
    .single();

  if (nb2ImgError || !nb2ImageRow) {
    throw new Error(`Failed to create NB2 image record: ${nb2ImgError?.message}`);
  }

  // Upload NB2 image to Supabase Storage
  const nb2StoragePath = `stories/v2-nb2/${nb2ImageRow.id}.png`;
  const { error: uploadError } = await supabase.storage
    .from("story-images")
    .upload(nb2StoragePath, nb2Result.imageBuffer, {
      contentType: "image/png",
      upsert: true,
    });

  let nb2StoredUrl: string | null = null;
  if (!uploadError) {
    const { data: publicUrl } = supabase.storage
      .from("story-images")
      .getPublicUrl(nb2StoragePath);
    nb2StoredUrl = publicUrl.publicUrl;

    await supabase
      .from("images")
      .update({ stored_url: nb2StoredUrl })
      .eq("id", nb2ImageRow.id);
  } else {
    console.warn(
      `[V2][${imgPrompt.id}] NB2 upload failed: ${uploadError.message}`,
    );
  }

  if (!nb2StoredUrl) {
    throw new Error(
      `[V2][${imgPrompt.id}] Cannot proceed: NB2 image upload failed.`,
    );
  }

  // ── Branch: SFW vs NSFW ──

  if (isNsfwPaired) {
    // ── NSFW: Florence-2/SAM2 masking + UnCanny inpainting ──
    return submitNsfwInpainting(params, imgPrompt, nb2ImageRow.id, nb2StoredUrl, seed, mode);
  } else {
    // ── SFW: Flux Krea Dev img2img with body LoRAs ──
    return submitSfwBodyEnhancement(params, imgPrompt, nb2ImageRow.id, nb2StoredUrl, nb2Result.imageBase64, seed);
  }
}

// ── SFW: Flux img2img body enhancement ──

async function submitSfwBodyEnhancement(
  params: V2SceneParams,
  imgPrompt: ScenePromptInput,
  nb2ImageId: string,
  nb2StoredUrl: string,
  nb2ImageBase64: string,
  seed: number,
): Promise<V2SceneResult> {
  const sfwDenoise = params.sfwDenoise ?? 0.30;
  const enhanceSeed = seed + 2000;

  // Build Flux img2img workflow with body shape LoRAs
  const bodyPrompt = DEFAULT_SFW_BODY_PROMPT;

  const workflow = buildKontextWorkflow({
    type: 'img2img',
    positivePrompt: bodyPrompt,
    width: 0,   // img2img uses source image dimensions
    height: 0,
    seed: enhanceSeed,
    denoiseStrength: sfwDenoise,
    filenamePrefix: `v2_sfw_${imgPrompt.id.substring(0, 8)}`,
    loras: [
      { filename: 'flux_realism_lora.safetensors', strengthModel: 0.7, strengthClip: 0.7 },
      { filename: 'bodylicious-flux.safetensors', strengthModel: 0.85, strengthClip: 0.85 },
      { filename: 'flux-add-details.safetensors', strengthModel: 0.5, strengthClip: 0.5 },
    ],
    guidance: 3.5,
  });

  console.log(
    `[V2][${imgPrompt.id}] SFW body enhancement: Flux img2img, ` +
    `denoise=${sfwDenoise}, seed=${enhanceSeed}, 3 LoRAs (realism+bodylicious+details)`,
  );

  // Submit to RunPod with NB2 image as input
  const images = [{ name: 'input.jpg', image: nb2ImageBase64 }];
  const { jobId } = await submitRunPodJob(workflow, images);

  console.log(`[V2][${imgPrompt.id}] SFW RunPod job: ${jobId}`);

  // Create image record for the enhanced result
  const { data: enhancedRow, error: enhancedError } = await supabase
    .from("images")
    .insert({
      character_id: imgPrompt.character_id || null,
      prompt: bodyPrompt,
      negative_prompt: "",
      settings: {
        seed: enhanceSeed,
        engine: "runpod-flux-img2img",
        pipelineVersion: "v2-sfw-enhanced",
        denoiseStrength: sfwDenoise,
        nb2ImageId,
        nb2Seed: seed,
        loras: ["flux_realism_lora", "bodylicious-flux", "flux-add-details"],
      },
      mode: "sfw",
    })
    .select("id")
    .single();

  if (enhancedError || !enhancedRow) {
    throw new Error(`Failed to create enhanced image record: ${enhancedError?.message}`);
  }

  await supabase.from("generation_jobs").insert({
    job_id: `runpod-${jobId}`,
    image_id: enhancedRow.id,
    status: "pending",
    cost: 0,
  });

  return {
    nb2ImageId,
    nb2StoredUrl,
    runpodJobId: `runpod-${jobId}`,
    enhancedImageId: enhancedRow.id,
    seed,
  };
}

// ── NSFW: UnCanny inpainting ──

async function submitNsfwInpainting(
  params: V2SceneParams,
  imgPrompt: ScenePromptInput,
  nb2ImageId: string,
  nb2StoredUrl: string,
  seed: number,
  mode: string,
): Promise<V2SceneResult> {
  const maskQuery = params.maskQuery || "clothing";
  const denoiseStrength = params.denoiseStrength ?? 0.90;
  const inpaintSeed = seed + 1000;

  const { jobId, seed: usedSeed } = await submitUncannyInpaintJob({
    baseImageUrl: nb2StoredUrl,
    maskQuery,
    inpaintPrompt: params.inpaintPrompt,
    seed: inpaintSeed,
    denoiseStrength,
    filenamePrefix: `uncanny_v2_${imgPrompt.id.substring(0, 8)}`,
  });

  console.log(
    `[V2][${imgPrompt.id}] NSFW inpainting submitted: job=${jobId}, ` +
    `maskQuery="${maskQuery}", denoise=${denoiseStrength}`,
  );

  const { data: nsfwRow, error: nsfwError } = await supabase
    .from("images")
    .insert({
      character_id: imgPrompt.character_id || null,
      prompt: params.inpaintPrompt,
      negative_prompt: "",
      settings: {
        seed: usedSeed,
        engine: "runpod-uncanny-v2",
        pipelineVersion: "v2-nsfw",
        maskQuery,
        denoiseStrength,
        nb2ImageId,
        nb2Seed: seed,
      },
      mode,
    })
    .select("id")
    .single();

  if (nsfwError || !nsfwRow) {
    throw new Error(`Failed to create NSFW image record: ${nsfwError?.message}`);
  }

  await supabase.from("generation_jobs").insert({
    job_id: `runpod-${jobId}`,
    image_id: nsfwRow.id,
    status: "pending",
    cost: 0,
  });

  return {
    nb2ImageId,
    nb2StoredUrl,
    runpodJobId: `runpod-${jobId}`,
    enhancedImageId: nsfwRow.id,
    seed,
  };
}
