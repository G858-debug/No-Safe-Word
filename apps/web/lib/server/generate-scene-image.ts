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
import { concatImagesHorizontally, concatImagesVertically, compressImageForPayload } from "./image-concat";
import type { KontextWorkflowType, CharacterLoraDownload } from "@no-safe-word/image-gen";
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
  characterLoraDownloads: CharacterLoraDownload[];
}

interface GenerateSceneParams {
  imgPrompt: ScenePromptInput;
  seriesId: string;
  characterDataMap: Map<string, CharacterData>;
  seed: number;
  /** Test mode: skip all LoRAs except realism, rely on PuLID only */
  pulidOnlyMode?: boolean;
}

// ── Helpers ──

const DARK_SCENE_KEYWORDS = /\b(dark|night(?:time)?|dim|shadow|candle|moonlight|bedroom|phone[- ]?light|blue[- ]?glow|low[- ]?light|dusk|semi-dark|unlit)\b/i;

/** Detect whether a scene prompt describes a dark/low-light environment.
 *  Used to reduce PuLID weight and denoise in dark scenes where the
 *  refinement pass would otherwise override the scene with a bright portrait. */
function detectSceneDarkness(prompt: string): boolean {
  return DARK_SCENE_KEYWORDS.test(prompt);
}

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

  // ── Character LoRA preflight check ──
  // Every referenced character must have a deployed LoRA before scene generation.
  // In pulidOnlyMode, skip entirely — identity comes from PuLID + Redux only.
  const characterLoraDownloads: CharacterLoraDownload[] = [];

  if (params.pulidOnlyMode) {
    console.log(`[Kontext][${promptId}] PuLID-only mode: skipping character LoRA preflight`);
  } else {
    for (const charId of [imgPrompt.character_id, imgPrompt.secondary_character_id]) {
      if (!charId) continue;
      const charName = characterDataMap.get(charId)?.name || "Unknown";

      const { data: loraRow, error: loraError } = await supabase
        .from("character_loras")
        .select("filename, storage_url")
        .eq("character_id", charId)
        .eq("status", "deployed")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (loraError || !loraRow) {
        throw new Error(
          `Character "${charName}" does not have a trained LoRA yet. ` +
          `Complete LoRA training in Character Approval before generating story images.`,
        );
      }

      if (!loraRow.storage_url) {
        throw new Error(
          `Character "${charName}" LoRA is deployed but has no storage URL. ` +
          `Re-deploy the LoRA to fix this.`,
        );
      }

      characterLoraDownloads.push({
        filename: loraRow.filename,
        url: loraRow.storage_url,
      });
      console.log(`[Kontext][${promptId}] Character LoRA found for "${charName}": ${loraRow.filename}`);
    }
  }

  // ── Reference images ──
  let kontextImages: Array<{ name: string; image: string }> = [];

  // Track face reference URLs for PuLID (separate from Redux combined ref images)
  let primaryFaceUrl: string | null = null;
  let secondaryFaceUrl: string | null = null;

  if (kontextType !== "portrait" && imgPrompt.character_id) {
    const { data: sc } = await supabase
      .from("story_characters")
      .select("approved_image_id, approved_fullbody_image_id, face_url")
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
      kontextImages.push({ name: "primary_ref.jpg", image: combinedBase64 });
      console.log(`[Kontext][${promptId}] Combined face + body ref images vertically for "${charName}"`);

      // Capture face_url for PuLID face reference
      if (sc.face_url) {
        primaryFaceUrl = sc.face_url;
        const rawFaceBase64 = await imageUrlToBase64(sc.face_url);
        const primaryFaceRefBase64 = await compressImageForPayload(rawFaceBase64, 1024, 85);
        kontextImages.push({ name: "face_reference.jpg", image: primaryFaceRefBase64 });
        console.log(`[Kontext][${promptId}] PuLID face reference added for "${charName}" (${Math.round(primaryFaceRefBase64.length / 1024)}KB)`);
      }
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
            kontextImages.push({ name: "primary_ref.jpg", image: stitchedBase64 });
            console.log(
              `[Kontext][${promptId}] Primary ref: face+body vertically stitched (${Math.round(stitchedBase64.length / 1024)}KB base64)`,
            );
          } else if (faceBase64) {
            kontextImages.push({ name: "primary_ref.jpg", image: faceBase64 });
            console.warn(`[Kontext][${promptId}] Primary ref: face only (body fetch failed)`);
          }
          // Capture face_url for PuLID face reference (dual primary)
          if (sc.face_url) {
            primaryFaceUrl = sc.face_url;
            const rawFaceBase64 = await imageUrlToBase64(sc.face_url);
            const primaryFaceRefBase64 = await compressImageForPayload(rawFaceBase64, 1024, 85);
            kontextImages.push({ name: "face_reference.jpg", image: primaryFaceRefBase64 });
            console.log(`[Kontext][${promptId}] PuLID face reference added for primary "${charName}" (${Math.round(primaryFaceRefBase64.length / 1024)}KB)`);
          }
        } else {
          const { data: img } = await supabase
            .from("images")
            .select("stored_url, sfw_url")
            .eq("id", sc.approved_image_id)
            .single();
          const primaryRefBase64 = await fetchRefImageBase64(img, `${charName} primary`);
          if (primaryRefBase64) {
            kontextImages.push({ name: "primary_ref.jpg", image: primaryRefBase64 });
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
      .select("approved_image_id, approved_fullbody_image_id, face_url")
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
    kontextImages.push({ name: "secondary_ref.jpg", image: stitchedSecondary });
    console.log(
      `[Kontext][${promptId}] Secondary ref: face+body vertically stitched for "${secondaryName}" (${Math.round(stitchedSecondary.length / 1024)}KB base64)`,
    );

    // Capture face_url for PuLID secondary face reference
    if (sc2.face_url) {
      secondaryFaceUrl = sc2.face_url;
      const rawSecondaryFace = await imageUrlToBase64(sc2.face_url);
      const secondaryFaceRefBase64 = await compressImageForPayload(rawSecondaryFace, 1024, 85);
      kontextImages.push({ name: "secondary_face_reference.jpg", image: secondaryFaceRefBase64 });
      console.log(`[Kontext][${promptId}] PuLID secondary face reference added for "${secondaryName}" (${Math.round(secondaryFaceRefBase64.length / 1024)}KB)`);
    }
  }

  // ── Dual scene: require both refs, combine, no silent fallback ──
  let effectiveKontextType = kontextType;

  if (kontextType === "dual") {
    const primaryRef = kontextImages.find((i) => i.name === "primary_ref.jpg");
    const secondaryRef = kontextImages.find((i) => i.name === "secondary_ref.jpg");

    if (!primaryRef || !secondaryRef) {
      throw new Error(
        `Dual scene requires both primary and secondary reference images. ` +
        `Primary: ${primaryRef ? "OK" : "MISSING"}, Secondary: ${secondaryRef ? "OK" : "MISSING"}. ` +
        `Ensure both characters have approved face + body portraits.`,
      );
    }

    const combined = await concatImagesHorizontally(primaryRef.image, secondaryRef.image);

    // Keep PuLID face references (they're separate from the stitched body refs)
    const faceRefs = kontextImages.filter(
      (i) => i.name !== "primary_ref.jpg" && i.name !== "secondary_ref.jpg",
    );
    kontextImages = [{ name: "combined_ref.jpg", image: combined }, ...faceRefs];
    console.log(`[Kontext][${promptId}] Combined primary + secondary ref images server-side (preserved ${faceRefs.length} face ref(s) for PuLID)`);
  }

  // Use the actual image name — no hardcoding that can mismatch
  const refImageName =
    effectiveKontextType === "portrait"
      ? undefined
      : kontextImages[0]?.name || "primary_ref.jpg";

  // ── Dimensions ──
  const isLandscape = /\b(wide|establishing|panoram)/i.test(imgPrompt.prompt);
  const kontextWidth = isLandscape ? 1216 : 832;
  const kontextHeight = isLandscape ? 832 : 1216;

  // ── Identity prefix ──
  let identityPrefix = "";
  if (imgPrompt.character_id) {
    identityPrefix = await buildKontextIdentityPrefix(charData);
    if (identityPrefix) {
      console.log(`[Kontext][${promptId}] Identity prefix for primary: ${identityPrefix.trim()}`);
    }
  }
  if (imgPrompt.secondary_character_id) {
    const secondaryCharData = characterDataMap.get(imgPrompt.secondary_character_id);
    if (secondaryCharData) {
      const secondaryPrefix = await buildKontextIdentityPrefix(secondaryCharData);
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

  // ── Unlinked character audit ──
  // Warn if a named character from the series appears in the prompt but is not
  // linked as primary or secondary. These will be rendered from text alone.
  for (const [charId, charData] of Array.from(characterDataMap)) {
    if (charId === imgPrompt.character_id || charId === imgPrompt.secondary_character_id) continue;
    if (charData.name && new RegExp(`\\b${charData.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(sceneForFlux)) {
      console.warn(
        `[Kontext][${promptId}] ⚠ Unlinked character detected in prompt: "${charData.name}". ` +
        `Treating as inline background figure — no LoRA or identity prefix will be injected ` +
        `for this character. Ensure their appearance is fully described in the scene prompt.`
      );
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

  if (params.pulidOnlyMode) {
    // PuLID-only test mode: realism LoRA only, no character or style LoRAs
    kontextLoras = [{ filename: 'flux_realism_lora.safetensors', strengthModel: 0.7, strengthClip: 0.7 }];
    console.log(`[Kontext][${promptId}] PuLID-only mode: realism LoRA only (0.7), all other LoRAs skipped`);
  } else {
    // Character identity LoRAs go first in the stack (highest priority)
    const characterLoras: Array<{ filename: string; strengthModel: number; strengthClip: number }> = characterLoraDownloads.map((dl) => ({
      filename: dl.filename,
      strengthModel: 0.65,
      strengthClip: 0.65,
    }));

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
      });
      // Character LoRAs first, then style LoRAs
      kontextLoras = [...characterLoras, ...resources.loras];
      kontextTriggerWords = resources.triggerWords;
      console.log(
        `[Kontext][${promptId}] LoRAs (${primaryGender}, sfw=${sfwMode}, dual=${hasSecondary}): ${kontextLoras.map((l) => `${l.filename}@${l.strengthModel}`).join(", ")}`,
      );
    } else {
      // Portrait/establishing shots still get character LoRAs (for identity) but no style LoRAs
      kontextLoras = characterLoras;
      console.log(`[Kontext][${promptId}] Portrait/establishing shot — character LoRAs only: ${kontextLoras.map((l) => l.filename).join(", ") || "NONE"}`);
    }
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
  // Build PuLID config when face references are available.
  // PuLID weight and denoise are reduced for dark scenes to prevent
  // the refinement pass from overriding the scene with a standing portrait.
  const isDarkScene = detectSceneDarkness(imgPrompt.prompt);
  const pulidWeight = isDarkScene ? 0.55 : 0.85;
  const pulidDenoise = isDarkScene ? 0.20 : 0.40;

  const pulidConfig = primaryFaceUrl
    ? {
        primaryFaceImageName: 'face_reference.jpg',
        secondaryFaceImageName: secondaryFaceUrl ? 'secondary_face_reference.jpg' : undefined,
        weight: pulidWeight,
        denoiseStrength: pulidDenoise,
      }
    : undefined;

  if (effectiveKontextType !== 'portrait') {
    if (primaryFaceUrl) {
      console.log(`[Kontext][${promptId}] PuLID enabled: weight=${pulidWeight}, denoise=${pulidDenoise}, dark=${isDarkScene}${secondaryFaceUrl ? ', secondary face ref present' : ''}`);
    } else {
      console.log(`[Kontext][${promptId}] PuLID disabled: no face_url for primary character`);
    }
  }

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
    pulid: pulidConfig,
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
    characterLoraDownloads,
  };
}
