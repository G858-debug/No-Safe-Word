/**
 * V4 Scene Image Generation: Flux 2 Pro via Replicate
 *
 * Cloud-only pipeline — no LoRAs, no PuLID, no RunPod/ComfyUI.
 * Character consistency comes from multi-reference images passed
 * directly to the Flux 2 Pro API on Replicate.
 *
 * Synchronous: Replicate returns the image directly (no job polling).
 */

import { supabase } from "@no-safe-word/story-engine";
import { runFlux2Pro, rewriteNsfwPromptForFlux2Pro } from "@no-safe-word/image-gen";
import type { Flux2ProResult } from "@no-safe-word/image-gen";

// Re-export fetchCharacterDataMap from V1 — shared across all pipelines
export { fetchCharacterDataMap } from "./generate-scene-image";

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

export interface V4SceneResult {
  imageBuffer: Buffer;
  imageBase64: string;
  assembledPrompt: string;
  mode: "sfw" | "nsfw";
  seed: number;
  width: number;
  height: number;
  engine: "flux2_pro";
  referenceCount: number;
}

interface V4GenerateSceneParams {
  imgPrompt: ScenePromptInput;
  seriesId: string;
  seed: number;
}

// ── Helpers ──

/**
 * Fetch the approved face URL and body image URL for a character.
 * Face: story_characters.face_url (direct URL)
 * Body: story_characters.approved_fullbody_image_id → images.stored_url
 */
async function fetchCharacterRefUrls(
  seriesId: string,
  characterId: string,
  charName: string,
): Promise<string[]> {
  const { data: sc, error } = await (supabase as any)
    .from("story_characters")
    .select("face_url, approved_fullbody_image_id")
    .eq("series_id", seriesId)
    .eq("character_id", characterId)
    .single() as {
      data: {
        face_url: string | null;
        approved_fullbody_image_id: string | null;
      } | null;
      error: any;
    };

  if (error || !sc) {
    throw new Error(`Character "${charName}" not found in series — ensure they are linked.`);
  }

  const urls: string[] = [];

  // Face reference
  if (sc.face_url) {
    urls.push(sc.face_url);
  } else {
    console.warn(`[V4] Character "${charName}" has no face_url — skipping face ref`);
  }

  // Body reference
  if (sc.approved_fullbody_image_id) {
    const { data: img } = await supabase
      .from("images")
      .select("stored_url")
      .eq("id", sc.approved_fullbody_image_id)
      .single();

    if (img?.stored_url) {
      urls.push(img.stored_url);
    } else {
      console.warn(`[V4] Character "${charName}" body image has no stored_url — skipping body ref`);
    }
  }

  return urls;
}

// ── Main Pipeline ──

/**
 * Generate a scene image using Flux 2 Pro on Replicate.
 *
 * Flow:
 * 1. Fetch character face/body reference image URLs
 * 2. Determine SFW/NSFW → safety_tolerance
 * 3. Build prompt with identity anchor
 * 4. Call Flux 2 Pro API with refs + prompt
 * 5. Return image buffer + metadata
 */
export async function generateSceneImageV4(
  params: V4GenerateSceneParams,
): Promise<V4SceneResult> {
  const { imgPrompt, seriesId, seed } = params;
  const promptId = imgPrompt.id;

  // ── Mode ──
  const isNsfw = imgPrompt.image_type === "website_nsfw_paired";
  const mode: "sfw" | "nsfw" = isNsfw ? "nsfw" : "sfw";
  const safetyTolerance = isNsfw ? 5 : 2;

  // ── Dimensions ──
  const isDualCharacter = !!imgPrompt.secondary_character_id;
  const width = isDualCharacter ? 1920 : 1440;
  const height = isDualCharacter ? 1440 : 1920;

  // ── Reference images ──
  const refUrls: string[] = [];

  if (imgPrompt.character_id) {
    const charName = imgPrompt.character_name || "Unknown";
    const primaryRefs = await fetchCharacterRefUrls(seriesId, imgPrompt.character_id, charName);
    refUrls.push(...primaryRefs);
    console.log(`[V4][${promptId}] Primary character "${charName}": ${primaryRefs.length} ref(s)`);
  }

  if (imgPrompt.secondary_character_id) {
    const secondaryName = imgPrompt.secondary_character_name || "Unknown";
    const secondaryRefs = await fetchCharacterRefUrls(seriesId, imgPrompt.secondary_character_id, secondaryName);
    refUrls.push(...secondaryRefs);
    console.log(`[V4][${promptId}] Secondary character "${secondaryName}": ${secondaryRefs.length} ref(s)`);
  }

  // ── Prompt assembly ──
  const identityPrefix = refUrls.length > 0
    ? "The character(s) in this scene must match the appearance shown in the reference images exactly — same face, same skin tone, same body proportions. "
    : "";

  // Rewrite NSFW prompts to use artistic/photographic language that bypasses
  // Flux 2 Pro's model-level safety filter (which blocks direct nudity instructions)
  const scenePrompt = isNsfw
    ? rewriteNsfwPromptForFlux2Pro(imgPrompt.prompt)
    : imgPrompt.prompt;

  if (isNsfw && scenePrompt !== imgPrompt.prompt) {
    console.log(`[V4][${promptId}] NSFW prompt rewritten for Flux 2 Pro safety bypass`);
    console.log(`[V4][${promptId}] Original: ${imgPrompt.prompt.substring(0, 120)}...`);
    console.log(`[V4][${promptId}] Rewritten: ${scenePrompt.substring(0, 120)}...`);
  }

  const finalPrompt = identityPrefix + scenePrompt;

  // ── Generate ──
  console.log(
    `[V4][${promptId}] === GENERATION SUMMARY ===\n` +
    JSON.stringify({
      pipeline: "V4 (flux2_pro)",
      promptId,
      primaryCharacter: imgPrompt.character_id
        ? { id: imgPrompt.character_id, name: imgPrompt.character_name }
        : null,
      secondaryCharacter: imgPrompt.secondary_character_id
        ? { id: imgPrompt.secondary_character_id, name: imgPrompt.secondary_character_name }
        : null,
      refImages: refUrls.length,
      dimensions: `${width}x${height}`,
      safetyTolerance,
      mode,
      seed,
      promptLength: finalPrompt.length,
    }, null, 2),
  );

  const result: Flux2ProResult = await runFlux2Pro({
    prompt: finalPrompt,
    referenceImageUrls: refUrls,
    width,
    height,
    seed,
    safetyTolerance,
    outputFormat: "png",
  });

  return {
    imageBuffer: result.imageBuffer,
    imageBase64: result.imageBase64,
    assembledPrompt: finalPrompt,
    mode,
    seed,
    width,
    height,
    engine: "flux2_pro",
    referenceCount: refUrls.length,
  };
}
