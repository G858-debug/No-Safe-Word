/**
 * Shared scene image generation logic.
 *
 * Encapsulates the full pipeline: reference image fetching/stitching,
 * identity prefix building, LoRA selection, prompt assembly, and
 * workflow construction. Used by both the batch generation route
 * and the single-image regenerate route.
 */

import { supabase } from "@no-safe-word/story-engine";
import {
  imageUrlToBase64,
  buildKontextWorkflow,
  buildKontextIdentityPrefix,
  selectKontextResources,
  rewritePromptForFlux,
  buildFluxPrompt,
  injectFluxFemaleEnhancement,
} from "@no-safe-word/image-gen";
import { concatImagesHorizontally, concatImagesVertically } from "./image-concat";
import type { KontextWorkflowType } from "@no-safe-word/image-gen";
import type { CharacterData } from "@no-safe-word/shared";

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

export interface SceneGenerationResult {
  workflow: Record<string, any>;
  images: Array<{ name: string; image: string }>;
  assembledPrompt: string;
  effectiveKontextType: KontextWorkflowType;
  mode: "sfw" | "nsfw";
  seed: number;
  width: number;
  height: number;
}

interface GenerateSceneParams {
  imgPrompt: ScenePromptInput;
  seriesId: string;
  characterDataMap: Map<string, CharacterData>;
  seed: number;
}

// ── Helpers ──

/** Try stored_url first; if it fails (e.g. 400/404), fall back to sfw_url */
async function fetchRefImageBase64(
  img: { stored_url?: string | null; sfw_url?: string | null } | null,
  label: string,
): Promise<string | null> {
  if (!img) return null;
  const urls = [img.stored_url, img.sfw_url].filter(Boolean) as string[];
  for (const url of urls) {
    try {
      return await imageUrlToBase64(url);
    } catch (err) {
      console.warn(`[Kontext] ${label}: failed to fetch ${url.substring(0, 60)}...: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.warn(`[Kontext] ${label}: all URLs failed`);
  return null;
}

/** Fetch character data from the characters table for the given IDs */
export async function fetchCharacterDataMap(
  characterIds: string[],
): Promise<Map<string, CharacterData>> {
  const characterDataMap = new Map<string, CharacterData>();
  if (characterIds.length === 0) return characterDataMap;

  const { data: characters } = await supabase
    .from("characters")
    .select("id, name, description")
    .in("id", characterIds);

  if (characters) {
    for (const char of characters) {
      const desc = char.description as Record<string, string>;
      const resolvedGender = (
        ["male", "female", "non-binary", "other"].includes(desc.gender)
          ? desc.gender
          : "female"
      ) as CharacterData["gender"];
      if (!desc.gender || desc.gender !== resolvedGender) {
        console.warn(
          `[StoryImage] Character ${char.name} (${char.id}): desc.gender=${JSON.stringify(desc.gender)}, resolved to "${resolvedGender}"`,
        );
      } else {
        console.log(
          `[StoryImage] Character ${char.name} (${char.id}): gender="${resolvedGender}"`,
        );
      }
      characterDataMap.set(char.id, {
        name: char.name,
        gender: resolvedGender,
        ethnicity: desc.ethnicity || "",
        bodyType: desc.bodyType || "",
        hairColor: desc.hairColor || "",
        hairStyle: desc.hairStyle || "",
        eyeColor: desc.eyeColor || "",
        skinTone: desc.skinTone || "",
        distinguishingFeatures: desc.distinguishingFeatures || "",
        clothing: desc.clothing || "",
        pose: desc.pose || "",
        expression: desc.expression || "",
        age: desc.age || "",
      });
    }
  }
  return characterDataMap;
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

// ── Main Pipeline ──

/**
 * Build the full generation payload for a scene image.
 *
 * Handles reference image fetching/stitching, identity prefix injection,
 * LoRA selection, prompt assembly, and workflow construction.
 */
export async function buildSceneGenerationPayload(
  params: GenerateSceneParams,
): Promise<SceneGenerationResult> {
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

  // ── Reference images ──
  let kontextImages: Array<{ name: string; image: string }> = [];

  if (kontextType !== "portrait" && imgPrompt.character_id) {
    const { data: sc } = await supabase
      .from("story_characters")
      .select("approved_image_id, approved_fullbody_image_id")
      .eq("series_id", seriesId)
      .eq("character_id", imgPrompt.character_id)
      .single();

    const charName =
      characterDataMap.get(imgPrompt.character_id)?.name ||
      imgPrompt.character_name ||
      "Unknown";

    if (kontextType === "single") {
      // Single-character: require BOTH face + body
      if (!sc?.approved_image_id || !sc?.approved_fullbody_image_id) {
        throw new Error(
          `Character "${charName}" requires both a face portrait and body shot to be approved before generating scene images.`,
        );
      }

      const [{ data: faceImg }, { data: bodyImg }] = await Promise.all([
        supabase.from("images").select("stored_url, sfw_url").eq("id", sc.approved_image_id).single(),
        supabase.from("images").select("stored_url, sfw_url").eq("id", sc.approved_fullbody_image_id).single(),
      ]);

      const [faceBase64, bodyBase64] = await Promise.all([
        fetchRefImageBase64(faceImg, `${charName} face`),
        fetchRefImageBase64(bodyImg, `${charName} body`),
      ]);

      if (!faceBase64 || !bodyBase64) {
        throw new Error(
          `Character "${charName}" has approved image IDs but the images could not be fetched. Face: ${faceBase64 ? "OK" : "failed"}, Body: ${bodyBase64 ? "OK" : "failed"}.`,
        );
      }

      const combinedBase64 = await concatImagesVertically(faceBase64, bodyBase64, 768);
      kontextImages.push({ name: "primary_ref.png", image: combinedBase64 });
      console.log(`[Kontext][${promptId}] Combined face + body ref images vertically for "${charName}"`);
    } else {
      // Dual-character: face + body for primary
      console.log(
        `[Kontext][${promptId}] Dual scene: fetching primary ref for "${charName}" (face: ${sc?.approved_image_id || "NONE"}, body: ${sc?.approved_fullbody_image_id || "NONE"})`,
      );
      if (sc?.approved_image_id) {
        if (sc.approved_fullbody_image_id) {
          const [{ data: faceImg }, { data: bodyImg }] = await Promise.all([
            supabase.from("images").select("stored_url, sfw_url").eq("id", sc.approved_image_id).single(),
            supabase.from("images").select("stored_url, sfw_url").eq("id", sc.approved_fullbody_image_id).single(),
          ]);
          const [faceBase64, bodyBase64] = await Promise.all([
            fetchRefImageBase64(faceImg, `${charName} face`),
            fetchRefImageBase64(bodyImg, `${charName} body`),
          ]);
          if (faceBase64 && bodyBase64) {
            const stitchedBase64 = await concatImagesVertically(faceBase64, bodyBase64, 512);
            kontextImages.push({ name: "primary_ref.png", image: stitchedBase64 });
            console.log(
              `[Kontext][${promptId}] Primary ref: face+body vertically stitched (${Math.round(stitchedBase64.length / 1024)}KB base64)`,
            );
          } else if (faceBase64) {
            kontextImages.push({ name: "primary_ref.png", image: faceBase64 });
            console.warn(`[Kontext][${promptId}] Primary ref: face only (body fetch failed)`);
          }
        } else {
          const { data: img } = await supabase
            .from("images")
            .select("stored_url, sfw_url")
            .eq("id", sc.approved_image_id)
            .single();
          const primaryRefBase64 = await fetchRefImageBase64(img, `${charName} primary`);
          if (primaryRefBase64) {
            kontextImages.push({ name: "primary_ref.png", image: primaryRefBase64 });
            console.warn(
              `[Kontext][${promptId}] Primary ref: face only — no approved_fullbody_image_id for "${charName}"`,
            );
          }
        }
      } else {
        console.warn(
          `[Kontext][${promptId}] WARNING: Primary character "${charName}" has no approved_image_id for dual scene`,
        );
      }
    }
  }

  // Fetch secondary character reference for dual scenes
  if (kontextType === "dual" && imgPrompt.secondary_character_id) {
    const secondaryName =
      characterDataMap.get(imgPrompt.secondary_character_id)?.name ||
      imgPrompt.secondary_character_name ||
      "Unknown";
    console.log(
      `[Kontext][${promptId}] Dual scene: fetching secondary ref for "${secondaryName}" (character_id: ${imgPrompt.secondary_character_id})`,
    );

    const { data: sc2 } = await supabase
      .from("story_characters")
      .select("approved_image_id, approved_fullbody_image_id")
      .eq("series_id", seriesId)
      .eq("character_id", imgPrompt.secondary_character_id)
      .single();

    console.log(
      `[Kontext][${promptId}] Secondary "${secondaryName}" approved_image_id: ${sc2?.approved_image_id || "NONE"}, approved_fullbody_image_id: ${sc2?.approved_fullbody_image_id || "NONE"}`,
    );

    if (!sc2?.approved_image_id) {
      throw new Error(
        `Secondary character "${secondaryName}" has no approved_image_id — cannot build dual scene reference`,
      );
    }
    if (!sc2.approved_fullbody_image_id) {
      throw new Error(
        `Secondary character "${secondaryName}" has no approved_fullbody_image_id — cannot build dual scene reference. Approve a full-body portrait first.`,
      );
    }

    const [{ data: faceImg2 }, { data: bodyImg2 }] = await Promise.all([
      supabase.from("images").select("stored_url, sfw_url").eq("id", sc2.approved_image_id).single(),
      supabase.from("images").select("stored_url, sfw_url").eq("id", sc2.approved_fullbody_image_id).single(),
    ]);
    const [faceBase64, bodyBase64] = await Promise.all([
      fetchRefImageBase64(faceImg2, `${secondaryName} face`),
      fetchRefImageBase64(bodyImg2, `${secondaryName} body`),
    ]);

    if (!faceBase64 || !bodyBase64) {
      throw new Error(
        `Secondary character "${secondaryName}" has approved image IDs but the images could not be fetched. Face: ${faceBase64 ? "OK" : "failed"}, Body: ${bodyBase64 ? "OK" : "failed"}.`,
      );
    }

    const stitchedSecondary = await concatImagesVertically(faceBase64, bodyBase64, 512);
    kontextImages.push({ name: "secondary_ref.png", image: stitchedSecondary });
    console.log(
      `[Kontext][${promptId}] Secondary ref: face+body vertically stitched for "${secondaryName}" (${Math.round(stitchedSecondary.length / 1024)}KB base64)`,
    );
  }

  // ── Dual scene: require both refs, combine, no silent fallback ──
  let effectiveKontextType = kontextType;

  if (kontextType === "dual") {
    if (kontextImages.length < 2) {
      const hasPrimary = kontextImages.some((i) => i.name === "primary_ref.png");
      const hasSecondaryRef = kontextImages.some((i) => i.name === "secondary_ref.png");
      throw new Error(
        `Dual scene requires 2 reference images but only got ${kontextImages.length}. ` +
        `Primary: ${hasPrimary ? "OK" : "MISSING"}, Secondary: ${hasSecondaryRef ? "OK" : "MISSING"}. ` +
        `Ensure both characters have approved face + body portraits.`,
      );
    }

    const combined = await concatImagesHorizontally(kontextImages[0].image, kontextImages[1].image);
    kontextImages = [{ name: "combined_ref.png", image: combined }];
    console.log(`[Kontext][${promptId}] Combined primary + secondary ref images server-side`);
  }

  // Use the actual image name — no hardcoding that can mismatch
  const refImageName =
    effectiveKontextType === "portrait"
      ? undefined
      : kontextImages[0]?.name || "primary_ref.png";

  // ── Dimensions ──
  const isLandscape = /\b(wide|establishing|panoram)/i.test(imgPrompt.prompt);
  const kontextWidth = isLandscape ? 1216 : 832;
  const kontextHeight = isLandscape ? 832 : 1216;

  // ── Identity prefix ──
  let identityPrefix = "";
  if (imgPrompt.character_id) {
    identityPrefix = buildKontextIdentityPrefix(charData);
    if (identityPrefix) {
      console.log(`[Kontext][${promptId}] Identity prefix for primary: ${identityPrefix.trim()}`);
    }
  }
  if (imgPrompt.secondary_character_id) {
    const secondaryCharData = characterDataMap.get(imgPrompt.secondary_character_id);
    if (secondaryCharData) {
      const secondaryPrefix = buildKontextIdentityPrefix(secondaryCharData);
      if (secondaryPrefix) {
        identityPrefix += `The second person in this scene is: ${secondaryPrefix}`;
        console.log(`[Kontext][${promptId}] Identity prefix for secondary: ${secondaryPrefix.trim()}`);
      }
    }
  }

  // Female enhancement
  const primaryIsFemale = charData?.gender === "female";
  if (primaryIsFemale && identityPrefix) {
    identityPrefix = injectFluxFemaleEnhancement(identityPrefix, mode, imgPrompt.prompt);
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

  // ── Flux prompt assembly ──
  const { prompt: fluxPrompt, needsLlmRewrite } = buildFluxPrompt(identityPrefix, sceneForFlux, {
    mode,
    hasDualCharacter: hasSecondary,
  });
  let kontextPositivePrompt = fluxPrompt;

  console.log(
    `[Kontext][${promptId}] Pre-rewrite prompt (${kontextPositivePrompt.length} chars, needsLlmRewrite=${needsLlmRewrite}):`,
  );
  console.log(`  ${kontextPositivePrompt}`);

  if (needsLlmRewrite) {
    const rewrittenPrompt = await rewritePromptForFlux(kontextPositivePrompt, sfwMode);
    if (rewrittenPrompt !== kontextPositivePrompt) {
      kontextPositivePrompt = rewrittenPrompt;
      console.log(`[Kontext][${promptId}] Prompt rewritten by LLM for Flux`);
    }
  } else {
    console.log(`[Kontext][${promptId}] Prompt is already natural language — skipping LLM rewrite`);
  }

  // ── LoRA selection ──
  const primaryGender = (charData?.gender as "male" | "female") || "female";
  const secondaryCharData = imgPrompt.secondary_character_id
    ? characterDataMap.get(imgPrompt.secondary_character_id)
    : undefined;
  const secondaryGender = secondaryCharData?.gender as "male" | "female" | undefined;

  // Portrait/establishing shots (no character) get no LoRAs — body LoRAs + triggers
  // would distort landscapes and generic scenes.
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
    });
    kontextLoras = resources.loras;
    kontextTriggerWords = resources.triggerWords;
    console.log(
      `[Kontext][${promptId}] LoRAs (${primaryGender}, sfw=${sfwMode}, dual=${hasSecondary}): ${kontextLoras.map((l) => `${l.filename}@${l.strengthModel}`).join(", ")}`,
    );
  } else {
    console.log(`[Kontext][${promptId}] Portrait/establishing shot — no LoRAs selected`);
  }

  // Inject trigger words near the relevant character, not at prompt start.
  // For male-primary + female-secondary scenes, body triggers (huge breasts, etc.)
  // must appear AFTER the secondary (female) identity prefix, not before the male's.
  if (kontextTriggerWords.length > 0) {
    const bodyTriggers = kontextTriggerWords.filter((t) =>
      /\b(breasts|hips|ass|waist|bust)\b/i.test(t),
    );
    const otherTriggers = kontextTriggerWords.filter(
      (t) => !/\b(breasts|hips|ass|waist|bust)\b/i.test(t),
    );

    // Non-body triggers (style triggers like boud01rstyle, mdlnbaytskn) go at the start
    if (otherTriggers.length > 0) {
      kontextPositivePrompt = `${otherTriggers.join(" ")} ${kontextPositivePrompt}`;
    }

    // Body triggers go after the secondary character prefix (if present), else at start
    if (bodyTriggers.length > 0) {
      const secondaryMarker = "The second person in this scene is:";
      const markerIdx = kontextPositivePrompt.indexOf(secondaryMarker);
      if (markerIdx !== -1) {
        // Find end of the secondary identity prefix paragraph (next double newline or scene text start)
        const afterMarker = kontextPositivePrompt.indexOf("\n", markerIdx + secondaryMarker.length + 10);
        const insertPos = afterMarker !== -1 ? afterMarker : kontextPositivePrompt.length;
        kontextPositivePrompt =
          kontextPositivePrompt.slice(0, insertPos) +
          " " + bodyTriggers.join(" ") +
          kontextPositivePrompt.slice(insertPos);
      } else {
        // No secondary character — prepend body triggers normally
        kontextPositivePrompt = `${bodyTriggers.join(" ")} ${kontextPositivePrompt}`;
      }
    }

    console.log(`[Kontext][${promptId}] Trigger words injected: ${kontextTriggerWords.join(", ")}${bodyTriggers.length > 0 && kontextPositivePrompt.includes("The second person") ? " (body triggers placed after secondary identity)" : ""}`);
  }

  // ── Workflow ──
  const kontextWorkflow = buildKontextWorkflow({
    type: effectiveKontextType,
    positivePrompt: kontextPositivePrompt,
    width: kontextWidth,
    height: kontextHeight,
    seed,
    filenamePrefix: `kontext_${promptId.substring(0, 8)}`,
    primaryRefImageName: refImageName,
    loras: kontextLoras,
    guidance: 3.5,
    sfwMode,
  });

  // ── Structured generation summary ──
  const secondaryName =
    imgPrompt.secondary_character_id
      ? characterDataMap.get(imgPrompt.secondary_character_id)?.name || imgPrompt.secondary_character_name || "Unknown"
      : null;
  const primaryName =
    imgPrompt.character_id
      ? characterDataMap.get(imgPrompt.character_id)?.name || imgPrompt.character_name || "Unknown"
      : null;

  console.log(
    `[Kontext][${promptId}] === GENERATION SUMMARY ===\n` +
      JSON.stringify(
        {
          promptId,
          kontextType: effectiveKontextType,
          originalType: kontextType,
          primaryCharacter: imgPrompt.character_id
            ? { id: imgPrompt.character_id, name: primaryName, gender: primaryGender }
            : null,
          secondaryCharacter: hasSecondary
            ? { id: imgPrompt.secondary_character_id, name: secondaryName, gender: secondaryGender }
            : null,
          refImages: {
            count: kontextImages.length,
            names: kontextImages.map((i) => i.name),
            sizes: kontextImages.map((i) => `${Math.round(i.image.length / 1024)}KB`),
          },
          refImageName,
          loras: kontextLoras.map((l) => `${l.filename}@${l.strengthModel}`),
          triggerWords: kontextTriggerWords,
          promptLength: kontextPositivePrompt.length,
          identityPrefixLength: identityPrefix.length,
          seed,
          dimensions: `${kontextWidth}x${kontextHeight}`,
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
