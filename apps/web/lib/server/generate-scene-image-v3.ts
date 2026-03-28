/**
 * V3 Scene Image Generation: Flux Krea + PuLID (No LoRA Training)
 *
 * V3 eliminates character LoRA training. Face consistency comes exclusively
 * from PuLID using the approved face portrait. Body shape is described via
 * an approved body_prompt text rather than a body reference image.
 *
 * All prompts are enhanced by Claude before generation (mandatory).
 */

import { supabase } from "@no-safe-word/story-engine";
import {
  imageUrlToBase64,
  buildKontextWorkflow,
  buildKontextIdentityPrefix,
  selectKontextResources,
  buildFluxPrompt,
  injectFluxFemaleEnhancement,
  rewritePromptForFlux,
  detectSceneDarkness,
  enhancePromptForScene,
} from "@no-safe-word/image-gen";
import { concatImagesHorizontally, compressImageForPayload } from "./image-concat";
import type { KontextWorkflowType } from "@no-safe-word/image-gen";
import type { CharacterData } from "@no-safe-word/shared";

// Re-export fetchCharacterDataMap from V1 — it's shared across all pipelines
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

export interface V3SceneGenerationResult {
  workflow: Record<string, any>;
  images: Array<{ name: string; image: string }>;
  assembledPrompt: string;
  effectiveKontextType: KontextWorkflowType;
  mode: "sfw" | "nsfw";
  seed: number;
  width: number;
  height: number;
}

interface V3GenerateSceneParams {
  imgPrompt: ScenePromptInput;
  seriesId: string;
  characterDataMap: Map<string, CharacterData>;
  seed: number;
}

// Empty character for prompts not linked to a character
const emptyCharacter: CharacterData = {
  name: "",
  gender: "female",
  ethnicity: "",
  bodyType: "",
  hairColor: "",
  hairStyle: "",
  eyeColor: "",
  skinTone: "",
  distinguishingFeatures: "",
  clothing: "",
  pose: "",
  expression: "",
  age: "",
};

// ── Helpers ──

/** Fetch face URL and body prompt from story_characters for V3 gate check */
async function fetchV3CharacterData(
  seriesId: string,
  characterId: string,
  charName: string,
): Promise<{
  faceUrl: string;
  bodyPrompt: string;
  approvedImageId: string;
}> {
  const { data: sc, error } = await (supabase as any)
    .from("story_characters")
    .select("approved_image_id, face_url, body_prompt, body_prompt_status")
    .eq("series_id", seriesId)
    .eq("character_id", characterId)
    .single() as { data: {
      approved_image_id: string | null;
      face_url: string | null;
      body_prompt: string | null;
      body_prompt_status: string;
    } | null; error: any };

  if (error || !sc) {
    throw new Error(`Character "${charName}" not found in series — ensure they are linked.`);
  }

  if (!sc.approved_image_id) {
    throw new Error(
      `Character "${charName}" face is not approved. ` +
      `Approve a face portrait in Character Approval before generating scenes.`,
    );
  }

  if (!sc.face_url) {
    throw new Error(
      `Character "${charName}" has no face reference URL. ` +
      `Re-approve the face portrait to generate a face_url.`,
    );
  }

  if (sc.body_prompt_status !== "approved" || !sc.body_prompt) {
    throw new Error(
      `Character "${charName}" body prompt is not approved. ` +
      `Review and approve the body description in Character Approval before generating scenes.`,
    );
  }

  return {
    faceUrl: sc.face_url,
    bodyPrompt: sc.body_prompt,
    approvedImageId: sc.approved_image_id,
  };
}

// ── Main Pipeline ──

/**
 * Build the full generation payload for a V3 scene image.
 *
 * V3 pipeline: PuLID for face identity (no character LoRA),
 * approved body_prompt for body description, Claude enhancement
 * for all prompts, BodyLicious at 0.85 for female body shape.
 */
export async function buildV3SceneGenerationPayload(
  params: V3GenerateSceneParams,
): Promise<V3SceneGenerationResult> {
  const { imgPrompt, seriesId, characterDataMap, seed } = params;
  const promptId = imgPrompt.id;

  // ── Mode & type ──
  const isNsfw = imgPrompt.image_type === "website_nsfw_paired";
  const mode: "sfw" | "nsfw" = isNsfw ? "nsfw" : "sfw";
  const sfwMode = !isNsfw;

  const charData = imgPrompt.character_id
    ? characterDataMap.get(imgPrompt.character_id) || emptyCharacter
    : emptyCharacter;

  const hasSecondary = !!imgPrompt.secondary_character_id;

  const kontextType: KontextWorkflowType = !imgPrompt.character_id
    ? "portrait"
    : hasSecondary
      ? "dual"
      : "single";

  // ── V3 gate check + reference data ──
  // No character LoRA needed — just face approval + body prompt approval
  let kontextImages: Array<{ name: string; image: string }> = [];
  let primaryFaceUrl: string | null = null;
  let secondaryFaceUrl: string | null = null;
  let primaryBodyPrompt: string | null = null;
  let secondaryBodyPrompt: string | null = null;

  if (kontextType !== "portrait" && imgPrompt.character_id) {
    const charName =
      characterDataMap.get(imgPrompt.character_id)?.name ||
      imgPrompt.character_name ||
      "Unknown";

    const primaryData = await fetchV3CharacterData(seriesId, imgPrompt.character_id, charName);
    primaryFaceUrl = primaryData.faceUrl;
    primaryBodyPrompt = primaryData.bodyPrompt;

    // Fetch approved face image for Redux reference (face-only, no body stitch in V3)
    const { data: faceImg } = await supabase
      .from("images")
      .select("stored_url, sfw_url")
      .eq("id", primaryData.approvedImageId)
      .single();

    if (faceImg) {
      const urls = [faceImg.stored_url, faceImg.sfw_url].filter(Boolean) as string[];
      for (const url of urls) {
        try {
          const faceBase64 = await imageUrlToBase64(url);
          kontextImages.push({ name: "primary_ref.jpg", image: faceBase64 });
          console.log(`[V3][${promptId}] Primary face reference for "${charName}" (Redux ref)`);
          break;
        } catch (err) {
          console.warn(`[V3][${promptId}] Failed to fetch face image for "${charName}": ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    // PuLID face reference (separate, compressed)
    const rawFaceBase64 = await imageUrlToBase64(primaryData.faceUrl);
    const primaryFaceRefBase64 = await compressImageForPayload(rawFaceBase64, 1024, 85);
    kontextImages.push({ name: "face_reference.jpg", image: primaryFaceRefBase64 });
    console.log(`[V3][${promptId}] PuLID face reference added for "${charName}" (${Math.round(primaryFaceRefBase64.length / 1024)}KB)`);
  }

  // Fetch secondary character data for dual scenes
  if (kontextType === "dual" && imgPrompt.secondary_character_id) {
    const secondaryName =
      characterDataMap.get(imgPrompt.secondary_character_id)?.name ||
      imgPrompt.secondary_character_name ||
      "Unknown";

    const secondaryData = await fetchV3CharacterData(
      seriesId,
      imgPrompt.secondary_character_id,
      secondaryName,
    );
    secondaryFaceUrl = secondaryData.faceUrl;
    secondaryBodyPrompt = secondaryData.bodyPrompt;

    // Secondary face for Redux reference
    const { data: faceImg2 } = await supabase
      .from("images")
      .select("stored_url, sfw_url")
      .eq("id", secondaryData.approvedImageId)
      .single();

    if (faceImg2) {
      const urls = [faceImg2.stored_url, faceImg2.sfw_url].filter(Boolean) as string[];
      for (const url of urls) {
        try {
          const faceBase64 = await imageUrlToBase64(url);
          kontextImages.push({ name: "secondary_ref.jpg", image: faceBase64 });
          console.log(`[V3][${promptId}] Secondary face reference for "${secondaryName}" (Redux ref)`);
          break;
        } catch (err) {
          console.warn(`[V3][${promptId}] Failed to fetch secondary face image: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    // PuLID secondary face reference
    const rawSecondaryFace = await imageUrlToBase64(secondaryData.faceUrl);
    const secondaryFaceRefBase64 = await compressImageForPayload(rawSecondaryFace, 1024, 85);
    kontextImages.push({ name: "secondary_face_reference.jpg", image: secondaryFaceRefBase64 });
    console.log(`[V3][${promptId}] PuLID secondary face reference added for "${secondaryName}" (${Math.round(secondaryFaceRefBase64.length / 1024)}KB)`);
  }

  // ── Dual scene: combine Redux refs ──
  let effectiveKontextType = kontextType;

  if (kontextType === "dual") {
    const primaryRef = kontextImages.find((i) => i.name === "primary_ref.jpg");
    const secondaryRef = kontextImages.find((i) => i.name === "secondary_ref.jpg");

    if (!primaryRef || !secondaryRef) {
      throw new Error(
        `Dual scene requires both face references. ` +
        `Primary: ${primaryRef ? "OK" : "MISSING"}, Secondary: ${secondaryRef ? "OK" : "MISSING"}.`,
      );
    }

    const combined = await concatImagesHorizontally(primaryRef.image, secondaryRef.image);

    // Keep PuLID face references (separate from Redux combined ref)
    const faceRefs = kontextImages.filter(
      (i) => i.name !== "primary_ref.jpg" && i.name !== "secondary_ref.jpg",
    );
    kontextImages = [{ name: "combined_ref.jpg", image: combined }, ...faceRefs];
    console.log(`[V3][${promptId}] Combined face refs for dual scene (preserved ${faceRefs.length} PuLID face ref(s))`);
  }

  const refImageName =
    effectiveKontextType === "portrait"
      ? undefined
      : kontextImages[0]?.name || "primary_ref.jpg";

  // ── Dimensions ──
  const isLandscape = /\b(wide|establishing|panoram)/i.test(imgPrompt.prompt);
  const kontextWidth = isLandscape ? 1216 : 832;
  const kontextHeight = isLandscape ? 832 : 1216;

  // ── Identity prefix with body prompt override ──
  let identityPrefix = "";

  if (imgPrompt.character_id) {
    identityPrefix = await buildKontextIdentityPrefix(charData, {
      bodyPromptOverride: primaryBodyPrompt || undefined,
    });
    if (identityPrefix) {
      console.log(`[V3][${promptId}] Identity prefix for primary: ${identityPrefix.trim()}`);
    }
  }

  if (imgPrompt.secondary_character_id) {
    const secondaryCharData = characterDataMap.get(imgPrompt.secondary_character_id);
    if (secondaryCharData) {
      const secondaryPrefix = await buildKontextIdentityPrefix(secondaryCharData, {
        bodyPromptOverride: secondaryBodyPrompt || undefined,
      });
      if (secondaryPrefix) {
        identityPrefix += `The second person in this scene is: ${secondaryPrefix}`;
        console.log(`[V3][${promptId}] Identity prefix for secondary: ${secondaryPrefix.trim()}`);
      }
    }
  }

  // Female enhancement
  const primaryIsFemale = charData?.gender === "female";
  if (primaryIsFemale && identityPrefix) {
    identityPrefix = injectFluxFemaleEnhancement(identityPrefix, mode, imgPrompt.prompt);
  }

  // SFW: soften breast language in identity prefix to reduce exposed nipple risk.
  // The body_prompt is shared across SFW/NSFW, so we soften at assembly time.
  // Ass/hips language stays strong since bigger butt is desired in both modes.
  if (sfwMode && identityPrefix) {
    identityPrefix = identityPrefix
      .replace(/\bhuge (natural )?breasts\b/gi, "full breasts")
      .replace(/\bvery large (natural )?breasts\b/gi, "full breasts")
      .replace(/\blarge (natural )?breasts\b/gi, "full breasts");
  }

  // ── Gaze redirection for dual scenes ──
  let sceneForFlux = imgPrompt.prompt;
  if (hasSecondary) {
    sceneForFlux = sceneForFlux.replace(
      /\(([^,)]+),\s*looking (directly )?(at|into) (the )?camera(:[0-9.]+)?\)/gi,
      (_, expr) => `${expr}, looking at the other person`,
    );
    sceneForFlux = sceneForFlux.replace(
      /looking (directly )?(at|into) (the )?camera/gi,
      "looking at the other person",
    );
    if (
      !/looking at the other person/i.test(sceneForFlux) &&
      !/looking at (him|her|each other|one another)/i.test(sceneForFlux)
    ) {
      sceneForFlux += " Both people are looking at each other, not at the camera.";
    }
  }

  // ── SFW clothing enforcement (V3 has no negative prompt to block nudity) ──
  // Without a character LoRA anchoring clothing, breast-heavy body prompts +
  // BodyLicious can overwhelm the scene prompt and produce exposed nipples.
  // Inject explicit clothing language for SFW scenes with female characters.
  const hasFemale = charData?.gender === "female" ||
    (imgPrompt.secondary_character_id && characterDataMap.get(imgPrompt.secondary_character_id)?.gender === "female");

  if (sfwMode && hasFemale) {
    // If the scene prompt mentions clothing, reinforce it; otherwise add generic
    const hasClothing = /\b(wearing|dressed in|clad in|outfit|dress|skirt|top|blouse|shirt|jeans|pants)\b/i.test(sceneForFlux);
    if (!hasClothing) {
      sceneForFlux += " She is fully clothed in a stylish fitted outfit.";
    }
    sceneForFlux += " All clothing remains on and in place throughout the scene. No exposed breasts or nipples.";
    console.log(`[V3][${promptId}] SFW clothing enforcement injected`);
  }

  // ── Claude prompt enhancement (mandatory in V3) ──
  const rawPromptWithIdentity = identityPrefix
    ? `${identityPrefix}\n${sceneForFlux}`
    : sceneForFlux;

  const enhancedRawPrompt = await enhancePromptForScene(rawPromptWithIdentity, { nsfw: !sfwMode });
  console.log(`[V3][${promptId}] Claude-enhanced prompt (${enhancedRawPrompt.length} chars)`);

  // ── Flux prompt assembly ──
  const { prompt: fluxPrompt, needsLlmRewrite } = buildFluxPrompt(
    "", // identity already baked into enhanced prompt
    enhancedRawPrompt,
    { mode, hasDualCharacter: hasSecondary },
  );
  let kontextPositivePrompt = fluxPrompt;

  if (needsLlmRewrite) {
    const rewrittenPrompt = await rewritePromptForFlux(kontextPositivePrompt, sfwMode);
    if (rewrittenPrompt !== kontextPositivePrompt) {
      kontextPositivePrompt = rewrittenPrompt;
      console.log(`[V3][${promptId}] Prompt rewritten by LLM for Flux`);
    }
  }

  // ── LoRA selection (no character LoRA) ──
  const primaryGender = (charData?.gender as "male" | "female") || "female";
  const secondaryCharData = imgPrompt.secondary_character_id
    ? characterDataMap.get(imgPrompt.secondary_character_id)
    : undefined;
  const secondaryGender = secondaryCharData?.gender as "male" | "female" | undefined;

  let kontextLoras: Array<{ filename: string; strengthModel: number; strengthClip: number }> = [];
  let kontextTriggerWords: string[] = [];

  if (effectiveKontextType !== "portrait") {
    const resources = selectKontextResources({
      gender: primaryGender,
      secondaryGender,
      isSfw: sfwMode,
      imageType: imgPrompt.image_type,
      prompt: imgPrompt.prompt,
      hasDualCharacter: hasSecondary,
      primaryEthnicity: charData?.ethnicity,
      secondaryEthnicity: secondaryCharData?.ethnicity,
      bodyShapeStrength: 0.85, // V3: higher BodyLicious since no character LoRA competing
    });
    kontextLoras = resources.loras; // No character LoRAs prepended
    kontextTriggerWords = resources.triggerWords;
    console.log(
      `[V3][${promptId}] LoRAs (${primaryGender}, sfw=${sfwMode}, dual=${hasSecondary}): ${kontextLoras.map((l) => `${l.filename}@${l.strengthModel}`).join(", ")}`,
    );
  }

  // Inject trigger words
  if (kontextTriggerWords.length > 0) {
    const bodyTriggers = kontextTriggerWords.filter((t) =>
      /\b(breasts|hips|ass|waist|bust)\b/i.test(t),
    );
    const otherTriggers = kontextTriggerWords.filter(
      (t) => !/\b(breasts|hips|ass|waist|bust)\b/i.test(t),
    );

    if (otherTriggers.length > 0) {
      kontextPositivePrompt = `${otherTriggers.join(" ")} ${kontextPositivePrompt}`;
    }

    if (bodyTriggers.length > 0) {
      const secondaryMarker = "The second person in this scene is:";
      const markerIdx = kontextPositivePrompt.indexOf(secondaryMarker);
      if (markerIdx !== -1) {
        const afterMarker = kontextPositivePrompt.indexOf("\n", markerIdx + secondaryMarker.length + 10);
        const insertPos = afterMarker !== -1 ? afterMarker : kontextPositivePrompt.length;
        kontextPositivePrompt =
          kontextPositivePrompt.slice(0, insertPos) +
          " " + bodyTriggers.join(" ") +
          kontextPositivePrompt.slice(insertPos);
      } else {
        kontextPositivePrompt = `${bodyTriggers.join(" ")} ${kontextPositivePrompt}`;
      }
    }

    console.log(`[V3][${promptId}] Trigger words injected: ${kontextTriggerWords.join(", ")}`);
  }

  // ── PuLID config ──
  const isDarkScene = detectSceneDarkness(imgPrompt.prompt);
  const pulidWeight = isDarkScene ? 0.55 : 0.85;
  const pulidDenoise = isDarkScene ? 0.20 : 0.40;

  const pulidConfig = primaryFaceUrl
    ? {
        primaryFaceImageName: "face_reference.jpg",
        secondaryFaceImageName: secondaryFaceUrl ? "secondary_face_reference.jpg" : undefined,
        weight: pulidWeight,
        denoiseStrength: pulidDenoise,
      }
    : undefined;

  if (effectiveKontextType !== "portrait") {
    if (primaryFaceUrl) {
      console.log(`[V3][${promptId}] PuLID enabled: weight=${pulidWeight}, denoise=${pulidDenoise}, dark=${isDarkScene}${secondaryFaceUrl ? ", secondary face ref present" : ""}`);
    } else {
      console.log(`[V3][${promptId}] PuLID disabled: no face_url for primary character`);
    }
  }

  // ── Workflow ──
  const kontextWorkflow = buildKontextWorkflow({
    type: effectiveKontextType,
    positivePrompt: kontextPositivePrompt,
    width: kontextWidth,
    height: kontextHeight,
    seed,
    filenamePrefix: `v3_${promptId.substring(0, 8)}`,
    primaryRefImageName: refImageName,
    loras: kontextLoras,
    guidance: 3.5,
    sfwMode,
    pulid: pulidConfig,
  });

  // ── Generation summary ──
  const primaryName =
    imgPrompt.character_id
      ? characterDataMap.get(imgPrompt.character_id)?.name || imgPrompt.character_name || "Unknown"
      : null;
  const secondaryName =
    imgPrompt.secondary_character_id
      ? characterDataMap.get(imgPrompt.secondary_character_id)?.name || imgPrompt.secondary_character_name || "Unknown"
      : null;

  console.log(
    `[V3][${promptId}] === GENERATION SUMMARY ===\n` +
      JSON.stringify(
        {
          pipeline: "V3 (flux_pulid)",
          promptId,
          kontextType: effectiveKontextType,
          primaryCharacter: imgPrompt.character_id
            ? { id: imgPrompt.character_id, name: primaryName, gender: primaryGender }
            : null,
          secondaryCharacter: hasSecondary
            ? { id: imgPrompt.secondary_character_id, name: secondaryName, gender: secondaryGender }
            : null,
          refImages: {
            count: kontextImages.length,
            names: kontextImages.map((i) => i.name),
          },
          loras: kontextLoras.map((l) => `${l.filename}@${l.strengthModel}`),
          triggerWords: kontextTriggerWords,
          pulidEnabled: !!pulidConfig,
          pulidWeight: pulidConfig?.weight,
          isDarkScene,
          promptLength: kontextPositivePrompt.length,
          seed,
          dimensions: `${kontextWidth}x${kontextHeight}`,
          mode,
          noCharacterLora: true,
        },
        null,
        2,
      ),
  );

  return {
    workflow: kontextWorkflow,
    images: kontextImages,
    assembledPrompt: kontextPositivePrompt,
    effectiveKontextType,
    mode,
    seed,
    width: kontextWidth,
    height: kontextHeight,
  };
}
