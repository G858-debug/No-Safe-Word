/**
 * V4 Scene Image Generation: Pony V6 / CyberRealistic Pony Semi-Realistic via RunPod + ComfyUI
 *
 * Single-step pipeline — character identity via trained SDXL LoRAs (no face swap):
 *
 * 1. Convert prose scene prompt → booru-style tags via Claude
 * 2. Build character identity tags from character data
 * 3. Assemble Pony positive prompt (quality + triggers + identity + scene)
 * 4. Build ComfyUI SDXL workflow (CyberRealistic Pony Semi-Realistic v4.5 checkpoint)
 * 5. Submit to RunPod (Pony endpoint) with character LoRA downloads
 *
 * Character consistency comes from SDXL-trained character LoRAs injected into
 * the workflow's LoRA chain — no PuLID, no face-swap post-processing.
 */

import { supabase } from "@no-safe-word/story-engine";
import type { CharacterData } from "@no-safe-word/shared";
import {
  buildPonyQualityPrefix,
  buildPonyNegativePrompt,
  buildPonyCharacterTags,
  buildPonyPositivePrompt,
  convertProseToBooru,
  getPonyDimensions,
  selectPonyResources,
  buildPonyWorkflow,
  getDefaultProfile,
  deriveCompositionType,
  deriveContentMode,
} from "@no-safe-word/image-gen";
import type { CharacterLoraDownload, SceneProfile } from "@no-safe-word/image-gen";

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
  workflow: Record<string, any>;
  images: Array<{ name: string; image: string }>;
  characterLoraDownloads: CharacterLoraDownload[];
  assembledPrompt: string;
  negativePrompt: string;
  mode: "sfw" | "nsfw";
  seed: number;
  width: number;
  height: number;
  engine: "pony_cyberreal";
  /** The scene profile used for this generation (for evaluation storage) */
  profile: SceneProfile;
}

interface V4GenerateSceneParams {
  imgPrompt: ScenePromptInput;
  seriesId: string;
  characterDataMap: Map<string, CharacterData>;
  seed: number;
  /** Override scene profile (used by retry strategy to adjust parameters) */
  profileOverrides?: Partial<SceneProfile>;
  /** Pre-rewritten booru tags (bypasses convertProseToBooru on retries) */
  overrideTags?: string;
}

// ── Character LoRA Fetching ──

interface CharacterLoraInfo {
  filename: string;
  storageUrl: string;
  triggerWord: string;
}

/**
 * Fetch deployed character LoRA from the character_loras table.
 * Throws if no deployed LoRA exists — scene generation requires trained LoRAs.
 */
async function fetchCharacterLora(
  characterId: string,
  characterName: string,
): Promise<CharacterLoraInfo> {
  const { data: loraRow, error } = await supabase
    .from("character_loras")
    .select("filename, storage_url, trigger_word")
    .eq("character_id", characterId)
    .eq("status", "deployed")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !loraRow) {
    throw new Error(
      `Character "${characterName}" does not have a deployed LoRA. ` +
      `Complete LoRA training before generating scene images.`,
    );
  }

  if (!loraRow.storage_url) {
    throw new Error(
      `Character "${characterName}" LoRA is deployed but has no storage URL. ` +
      `Re-deploy the LoRA to fix this.`,
    );
  }

  return {
    filename: loraRow.filename,
    storageUrl: loraRow.storage_url,
    triggerWord: loraRow.trigger_word || "tok",
  };
}

// ── Main Pipeline ──

/**
 * Build the V4 scene generation payload (Pony CyberRealistic Semi-Realistic).
 *
 * Returns a workflow + metadata ready for submitRunPodJob().
 * The caller is responsible for submitting to RunPod and storing the result.
 */
export async function buildV4SceneGenerationPayload(
  params: V4GenerateSceneParams,
): Promise<V4SceneResult> {
  const { imgPrompt, seriesId, characterDataMap, seed, profileOverrides, overrideTags } = params;
  const promptId = imgPrompt.id;

  // ── Mode ──
  const isNsfw = imgPrompt.image_type === "website_nsfw_paired";
  const mode: "sfw" | "nsfw" = isNsfw ? "nsfw" : "sfw";

  // ── Character data + LoRAs ──
  const characterLoraDownloads: CharacterLoraDownload[] = [];
  const triggerWords: string[] = [];
  const loraStack: Array<{ filename: string; strengthModel: number; strengthClip: number }> = [];

  // Primary character
  let primaryCharData: CharacterData | null = null;
  if (imgPrompt.character_id) {
    primaryCharData = characterDataMap.get(imgPrompt.character_id) || null;
    if (!primaryCharData) {
      throw new Error(`Character data not found for "${imgPrompt.character_name}" (${imgPrompt.character_id})`);
    }

    const lora = await fetchCharacterLora(imgPrompt.character_id, primaryCharData.name);
    characterLoraDownloads.push({ filename: `characters/${lora.filename}`, url: lora.storageUrl });
    triggerWords.push(lora.triggerWord);
    loraStack.push({
      filename: `characters/${lora.filename}`,
      strengthModel: 0.8,
      strengthClip: 0.8,
    });
    console.log(`[V4][${promptId}] Primary LoRA: ${lora.filename} (trigger: ${lora.triggerWord})`);
  }

  // Secondary character
  let secondaryCharData: CharacterData | null = null;
  if (imgPrompt.secondary_character_id) {
    secondaryCharData = characterDataMap.get(imgPrompt.secondary_character_id) || null;
    if (!secondaryCharData) {
      throw new Error(`Character data not found for "${imgPrompt.secondary_character_name}" (${imgPrompt.secondary_character_id})`);
    }

    const lora = await fetchCharacterLora(imgPrompt.secondary_character_id, secondaryCharData.name);
    characterLoraDownloads.push({ filename: `characters/${lora.filename}`, url: lora.storageUrl });
    triggerWords.push(lora.triggerWord);
    loraStack.push({
      filename: `characters/${lora.filename}`,
      strengthModel: 0.8,
      strengthClip: 0.8,
    });
    console.log(`[V4][${promptId}] Secondary LoRA: ${lora.filename} (trigger: ${lora.triggerWord})`);
  }

  const isDualCharacter = !!imgPrompt.secondary_character_id;
  const hasFemale =
    primaryCharData?.gender === "female" || secondaryCharData?.gender === "female";

  // ── Scene profile ──
  const primaryGender = primaryCharData?.gender === "male" ? "male" as const : "female" as const;
  const secondaryGenderVal = secondaryCharData
    ? (secondaryCharData.gender === "male" ? "male" as const : "female" as const)
    : undefined;
  const compositionType = deriveCompositionType(primaryGender, secondaryGenderVal);
  const contentMode = deriveContentMode(imgPrompt.image_type);
  const baseProfile = getDefaultProfile(compositionType, contentMode);
  const profile: SceneProfile = profileOverrides
    ? { ...baseProfile, ...profileOverrides, loraOverrides: { ...baseProfile.loraOverrides, ...profileOverrides.loraOverrides } }
    : baseProfile;

  console.log(`[V4][${promptId}] Profile: ${profile.compositionType}/${profile.contentMode} (charLora=${profile.charLoraStrength}, cfg=${profile.cfg}, steps=${profile.steps})`);

  // Apply profile-driven LoRA strengths to character LoRAs already in the stack
  for (const lora of loraStack) {
    lora.strengthModel = profile.charLoraStrength;
    lora.strengthClip = profile.charLoraStrength;
  }

  // ── Prompt building ──
  // Convert prose scene prompt to booru tags (or use pre-rewritten tags from retry)
  const sceneTags = overrideTags || await convertProseToBooru(imgPrompt.prompt, { nsfw: isNsfw });
  console.log(`[V4][${promptId}] Scene tags: ${sceneTags}`);

  // Build character identity tags
  let characterTags = "";
  if (primaryCharData) {
    characterTags = buildPonyCharacterTags({
      gender: primaryCharData.gender === "male" ? "male" : "female",
      ethnicity: primaryCharData.ethnicity,
      skinTone: primaryCharData.skinTone,
      hairColor: primaryCharData.hairColor,
      hairStyle: primaryCharData.hairStyle,
      eyeColor: primaryCharData.eyeColor,
      bodyType: primaryCharData.bodyType,
      age: primaryCharData.age,
      distinguishingFeatures: primaryCharData.distinguishingFeatures,
    }, { mode });
  }

  let secondaryCharacterTags: string | undefined;
  if (secondaryCharData) {
    secondaryCharacterTags = buildPonyCharacterTags({
      gender: secondaryCharData.gender === "male" ? "male" : "female",
      ethnicity: secondaryCharData.ethnicity,
      skinTone: secondaryCharData.skinTone,
      hairColor: secondaryCharData.hairColor,
      hairStyle: secondaryCharData.hairStyle,
      eyeColor: secondaryCharData.eyeColor,
      bodyType: secondaryCharData.bodyType,
      age: secondaryCharData.age,
      distinguishingFeatures: secondaryCharData.distinguishingFeatures,
    }, { mode });
  }

  // Select style LoRAs
  const resources = selectPonyResources({
    gender: primaryGender,
    secondaryGender: secondaryGenderVal,
    isSfw: !isNsfw,
    imageType: imgPrompt.image_type,
    prompt: imgPrompt.prompt,
    hasDualCharacter: isDualCharacter,
    primaryEthnicity: primaryCharData?.ethnicity,
  });

  // Add style LoRAs after character LoRAs, applying profile-driven strength overrides
  for (const lora of resources.loras) {
    const overrideStrength = profile.loraOverrides[lora.filename];
    if (overrideStrength !== undefined) {
      loraStack.push({ ...lora, strengthModel: overrideStrength, strengthClip: Math.min(overrideStrength, 1.0) });
    } else {
      loraStack.push(lora);
    }
  }

  // Assemble prompts
  const qualityPrefix = buildPonyQualityPrefix(mode);
  const negativePrompt = buildPonyNegativePrompt(mode);

  // ── Dimensions ──
  const { width, height } = getPonyDimensions("portrait", isDualCharacter);

  // ── Build workflow ──
  let positivePrompt: string;
  let dualCharacterPrompts: { char1Prompt: string; char2Prompt: string } | undefined;

  if (isDualCharacter && secondaryCharacterTags) {
    // Regional conditioning: split character prompts into separate regions.
    // Shared prompt gets quality + style LoRA triggers + scene tags (global).
    // Each character gets their own trigger word + identity tags (regional).
    const styleTriggers = resources.triggerWords;
    const sharedParts = [qualityPrefix, ...styleTriggers, sceneTags].filter(Boolean);
    positivePrompt = sharedParts.join(', ');

    // Character 1 (left region): trigger word + identity tags
    const char1Parts = [triggerWords[0], characterTags].filter(Boolean);
    // Character 2 (right region): trigger word + identity tags
    const char2Parts = [triggerWords[1], secondaryCharacterTags].filter(Boolean);

    dualCharacterPrompts = {
      char1Prompt: char1Parts.join(', '),
      char2Prompt: char2Parts.join(', '),
    };

    console.log(`[V4][${promptId}] DUAL-CHARACTER regional prompting enabled`);
    console.log(`[V4][${promptId}] Shared: ${positivePrompt}`);
    console.log(`[V4][${promptId}] Char1 (left): ${dualCharacterPrompts.char1Prompt}`);
    console.log(`[V4][${promptId}] Char2 (right): ${dualCharacterPrompts.char2Prompt}`);
  } else {
    // Single character: all in one prompt
    positivePrompt = buildPonyPositivePrompt({
      qualityPrefix,
      characterTags,
      secondaryCharacterTags,
      sceneTags,
      triggerWords: [...triggerWords, ...resources.triggerWords],
      mode,
    });
  }

  const workflow = buildPonyWorkflow({
    positivePrompt,
    negativePrompt,
    width,
    height,
    seed,
    cfg: profile.cfg,
    steps: profile.steps,
    filenamePrefix: `v4_${promptId}`,
    loras: loraStack.length > 0 ? loraStack : undefined,
    dualCharacterPrompts,
  });

  // ── Assembled prompt for storage (includes all parts) ──
  const assembledPrompt = dualCharacterPrompts
    ? `${positivePrompt} | CHAR1: ${dualCharacterPrompts.char1Prompt} | CHAR2: ${dualCharacterPrompts.char2Prompt}`
    : positivePrompt;

  // ── Log summary ──
  console.log(
    `[V4][${promptId}] === GENERATION SUMMARY ===\n` +
    JSON.stringify({
      pipeline: "V4 (pony_cyberreal)",
      promptId,
      primaryCharacter: imgPrompt.character_id
        ? { id: imgPrompt.character_id, name: imgPrompt.character_name, gender: primaryGender }
        : null,
      secondaryCharacter: imgPrompt.secondary_character_id
        ? { id: imgPrompt.secondary_character_id, name: imgPrompt.secondary_character_name }
        : null,
      mode,
      seed,
      isDualCharacter,
      dualCharacterRegional: !!dualCharacterPrompts,
      loraCount: loraStack.length,
      characterLoraCount: characterLoraDownloads.length,
      promptLength: assembledPrompt.length,
      dimensions: `${width}x${height}`,
      profile: `${profile.compositionType}/${profile.contentMode}`,
    }, null, 2),
  );

  return {
    workflow,
    images: [], // No reference images needed — identity from LoRAs
    characterLoraDownloads,
    assembledPrompt,
    negativePrompt,
    mode,
    seed,
    width,
    height,
    engine: "pony_cyberreal",
    profile,
  };
}
