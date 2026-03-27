/**
 * V2 Scene Image Generation Logic
 *
 * Encapsulates the NB2 → Florence-2/SAM2 → UnCanny inpainting pipeline
 * for scene image generation. Called from the batch generation route and
 * the single-image regenerate route when the series uses `nb2_uncanny` engine.
 *
 * For SFW images (facebook_sfw, website_only):
 *   Stage A only — NB2 generates the clothed scene, stored immediately.
 *
 * For NSFW paired images (website_nsfw_paired):
 *   Stage A: NB2 generates clothed scene → stored as sfw_image_id
 *   Stage B+C: Florence-2/SAM2 masking + UnCanny inpainting → RunPod job → image_id
 */

import { supabase } from "@no-safe-word/story-engine";
import {
  runNb2Scene,
  submitUncannyInpaintJob,
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
  /** SFW inpaint prompt — describes voluptuous figure in clothing */
  sfwInpaintPrompt?: string;
  maskQuery?: string;
  denoiseStrength?: number;
  aspectRatio?: string;
}

export interface V2SceneResult {
  /** Image record ID for the NB2 base image (pre-inpainting) */
  nb2ImageId: string;
  /** Supabase Storage URL for the NB2 base image */
  nb2StoredUrl: string | null;
  /** RunPod job ID for Stage B+C inpainting */
  runpodJobId: string;
  /** Image record ID for the inpainted image (SFW enhanced or NSFW) */
  inpaintedImageId: string;
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

// ── Main Pipeline ──

/**
 * Generate a scene image using the V2 pipeline.
 *
 * For SFW-only images: runs NB2 (Stage A) and returns immediately.
 * For NSFW paired images: runs NB2 (Stage A), then submits inpainting
 * (Stage B+C) to RunPod asynchronously.
 */
export async function generateV2Scene(
  params: V2SceneParams,
): Promise<V2SceneResult> {
  const {
    imgPrompt,
    seed,
    inpaintPrompt,
    sfwInpaintPrompt,
    aspectRatio = "3:4",
    refUrlMap,
  } = params;

  const isNsfwPaired = imgPrompt.image_type === "website_nsfw_paired";
  const mode = isNsfwPaired ? "nsfw" : "sfw";

  // SFW: mask the body to enhance curves through clothing (lower denoise preserves scene)
  // NSFW: mask clothing to replace with bare skin (higher denoise for full replacement)
  const effectiveMaskQuery = isNsfwPaired
    ? (params.maskQuery || "clothing")
    : "woman's body";
  const effectiveInpaintPrompt = isNsfwPaired
    ? inpaintPrompt
    : (sfwInpaintPrompt || "voluptuous woman, very large natural breasts, wide hips, huge round butt, narrow waist, fitted clothing showing curves");
  const effectiveDenoise = isNsfwPaired
    ? (params.denoiseStrength ?? 0.90)
    : (params.denoiseStrength ?? 0.70);

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

  // ── Stage B+C: Masking + Inpainting (ALL images) ──
  // SFW: enhances body curves through clothing
  // NSFW: replaces clothing with bare skin
  if (!nb2StoredUrl) {
    throw new Error(
      `[V2][${imgPrompt.id}] Cannot submit inpainting: NB2 image upload failed. ` +
      `Stage B+C requires a stored URL for the base image.`,
    );
  }

  const inpaintSeed = seed + 1000;

  const { jobId, seed: usedSeed } = await submitUncannyInpaintJob({
    baseImageUrl: nb2StoredUrl,
    maskQuery: effectiveMaskQuery,
    inpaintPrompt: effectiveInpaintPrompt,
    seed: inpaintSeed,
    denoiseStrength: effectiveDenoise,
    filenamePrefix: `uncanny_v2_${imgPrompt.id.substring(0, 8)}`,
  });

  console.log(
    `[V2][${imgPrompt.id}] Stage B+C submitted: job=${jobId}, ` +
    `mode=${mode}, maskQuery="${effectiveMaskQuery}", denoise=${effectiveDenoise}`,
  );

  // Create image record for the inpainted result
  const { data: inpaintedImageRow, error: inpaintImgError } = await supabase
    .from("images")
    .insert({
      character_id: imgPrompt.character_id || null,
      prompt: effectiveInpaintPrompt,
      negative_prompt: "",
      settings: {
        seed: usedSeed,
        engine: "runpod-uncanny-v2",
        pipelineVersion: "v2",
        maskQuery: effectiveMaskQuery,
        denoiseStrength: effectiveDenoise,
        nb2ImageId: nb2ImageRow.id,
        nb2Seed: seed,
      },
      mode,
    })
    .select("id")
    .single();

  if (inpaintImgError || !inpaintedImageRow) {
    throw new Error(`Failed to create inpainted image record: ${inpaintImgError?.message}`);
  }

  // Create generation job for polling
  await supabase.from("generation_jobs").insert({
    job_id: `runpod-${jobId}`,
    image_id: inpaintedImageRow.id,
    status: "pending",
    cost: 0,
  });

  return {
    nb2ImageId: nb2ImageRow.id,
    nb2StoredUrl,
    runpodJobId: `runpod-${jobId}`,
    inpaintedImageId: inpaintedImageRow.id,
    seed,
  };
}
