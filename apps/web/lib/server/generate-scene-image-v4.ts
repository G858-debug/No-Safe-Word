/**
 * V4 Scene Image Generation: Juggernaut Ragnarok via RunPod + ComfyUI
 *
 * Single-step pipeline — character identity via trained SDXL LoRAs (no face swap):
 *
 * 1. Convert prose scene prompt via Claude
 * 2. Build character identity tags from character data
 * 3. Assemble positive prompt (quality + triggers + identity + scene)
 * 4. Build ComfyUI SDXL workflow (Juggernaut Ragnarok checkpoint)
 * 5. Submit to RunPod with character LoRA downloads
 *
 * Character consistency comes from SDXL-trained character LoRAs injected into
 * the workflow's LoRA chain — no PuLID, no face-swap post-processing.
 */

import { supabase } from "@no-safe-word/story-engine";
import type { CharacterData } from "@no-safe-word/shared";
import {
  buildQualityPrefix,
  buildNegativePrompt,
  buildCharacterTags,
  buildPositivePrompt,
  convertProseToPrompt,
  getDimensions,
  buildWorkflow,
  getDefaultProfile,
  deriveCompositionType,
  deriveContentMode,
  estimateClipTokens,
  classifyScene,
} from "@no-safe-word/image-gen";
import { selectResourceLoras } from "@no-safe-word/image-gen";
import { classifyPose, renderPose } from "@no-safe-word/image-gen/controlnet";
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
  engine: "juggernaut_ragnarok";
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
  /** Pre-rewritten booru tags (bypasses convertProseToPrompt on retries) */
  overrideTags?: string;
  /** Force-disable ControlNet (used when RunPod worker lacks the model) */
  disableControlNet?: boolean;
}

// ── Character LoRA Fetching ──

interface CharacterLoraInfo {
  filename: string;
  storageUrl: string;
  triggerWord: string;
  fileSizeBytes: number | null;
}

/**
 * Fetch deployed character LoRA from the character_loras table.
 * Returns null if no usable deployed LoRA exists — the pipeline will fall back
 * to inline character descriptions (less consistent but still generates real images).
 */
async function fetchCharacterLora(
  characterId: string,
  characterName: string,
): Promise<CharacterLoraInfo | null> {
  const { data: loraRow, error } = await supabase
    .from("character_loras")
    .select("filename, storage_url, trigger_word, file_size_bytes")
    .eq("character_id", characterId)
    .eq("status", "deployed")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !loraRow) {
    console.warn(
      `[V4] Character "${characterName}" has no deployed LoRA — ` +
      `falling back to inline character descriptions.`,
    );
    return null;
  }

  if (!loraRow.storage_url) {
    console.warn(
      `[V4] Character "${characterName}" LoRA is deployed but has no storage URL — ` +
      `falling back to inline character descriptions.`,
    );
    return null;
  }

  return {
    filename: loraRow.filename,
    storageUrl: loraRow.storage_url,
    triggerWord: loraRow.trigger_word || "tok",
    fileSizeBytes: loraRow.file_size_bytes,
  };
}

// ── Main Pipeline ──

/**
 * Build the V4 scene generation payload (Juggernaut Ragnarok).
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
  const isNsfw = imgPrompt.image_type !== "facebook_sfw";
  const mode: "sfw" | "nsfw" = isNsfw ? "nsfw" : "sfw";

  // ── Character data + LoRAs ──
  const characterLoraDownloads: CharacterLoraDownload[] = [];
  const triggerWords: string[] = [];
  // Per-character trigger words — indexed by character position, not LoRA order.
  // Empty string when the character has no LoRA (uses inline descriptions instead).
  let primaryTriggerWord = "";
  let secondaryTriggerWord = "";
  const loraStack: Array<{ filename: string; strengthModel: number; strengthClip: number }> = [];

  // Primary character
  let primaryCharData: CharacterData | null = null;
  let hasLoraForPrimaryChar = false;
  if (imgPrompt.character_id) {
    primaryCharData = characterDataMap.get(imgPrompt.character_id) || null;
    if (!primaryCharData) {
      throw new Error(`Character data not found for "${imgPrompt.character_name}" (${imgPrompt.character_id})`);
    }

    const lora = await fetchCharacterLora(imgPrompt.character_id, primaryCharData.name);
    if (lora) {
      hasLoraForPrimaryChar = true;
      primaryTriggerWord = lora.triggerWord;
      characterLoraDownloads.push({
        filename: `characters/${lora.filename}`,
        url: lora.storageUrl,
        ...(lora.fileSizeBytes ? { expected_bytes: lora.fileSizeBytes } : {}),
      });
      triggerWords.push(lora.triggerWord);
      loraStack.push({
        filename: `characters/${lora.filename}`,
        strengthModel: 0.8,
        strengthClip: 0.8,
      });
      console.log(`[V4][${promptId}] Primary LoRA: ${lora.filename} (trigger: ${lora.triggerWord})`);
    } else {
      console.log(`[V4][${promptId}] Primary character "${primaryCharData.name}" — no LoRA, using inline description`);
    }
  }

  // Secondary character
  let secondaryCharData: CharacterData | null = null;
  let hasLoraForSecondaryChar = false;
  if (imgPrompt.secondary_character_id) {
    secondaryCharData = characterDataMap.get(imgPrompt.secondary_character_id) || null;
    if (!secondaryCharData) {
      throw new Error(`Character data not found for "${imgPrompt.secondary_character_name}" (${imgPrompt.secondary_character_id})`);
    }

    const lora = await fetchCharacterLora(imgPrompt.secondary_character_id, secondaryCharData.name);
    if (lora) {
      hasLoraForSecondaryChar = true;
      secondaryTriggerWord = lora.triggerWord;
      characterLoraDownloads.push({
        filename: `characters/${lora.filename}`,
        url: lora.storageUrl,
        ...(lora.fileSizeBytes ? { expected_bytes: lora.fileSizeBytes } : {}),
      });
      triggerWords.push(lora.triggerWord);
      loraStack.push({
        filename: `characters/${lora.filename}`,
        strengthModel: 0.8,
        strengthClip: 0.8,
      });
      console.log(`[V4][${promptId}] Secondary LoRA: ${lora.filename} (trigger: ${lora.triggerWord})`);
    } else {
      console.log(`[V4][${promptId}] Secondary character "${secondaryCharData.name}" — no LoRA, using inline description`);
    }
  }

  const isDualCharacter = !!imgPrompt.secondary_character_id;
  const hasFemale =
    primaryCharData?.gender === "female" || secondaryCharData?.gender === "female";

  // ── LoRA Requirement — hard block ──
  // Characters without deployed LoRAs produce inconsistent identity and waste
  // CLIP tokens on inline descriptions. Block generation until LoRAs are trained.
  const missingLoraCharacters: string[] = [];
  if (imgPrompt.character_id && !hasLoraForPrimaryChar) {
    missingLoraCharacters.push(primaryCharData?.name || imgPrompt.character_id);
  }
  if (imgPrompt.secondary_character_id && !hasLoraForSecondaryChar) {
    missingLoraCharacters.push(secondaryCharData?.name || imgPrompt.secondary_character_id);
  }
  if (missingLoraCharacters.length > 0) {
    throw new Error(
      `Cannot generate scene image: characters [${missingLoraCharacters.join(', ')}] ` +
      `have no deployed LoRA. Train and deploy LoRAs before generating scene images.`,
    );
  }

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

  console.log(`[V4][${promptId}] Profile: ${profile.compositionType}/${profile.contentMode} (loraModel=${profile.charLoraStrengthModel}, loraClip=${profile.charLoraStrengthClip}, cfg=${profile.cfg}, steps=${profile.steps})`);

  // ── Interaction detection for dual-character scenes ──
  // Classify the scene to detect interaction type. For intimate/romantic scenes,
  // unified prompting (no regional conditioning) produces better physical interactions.
  const classification = classifyScene(
    imgPrompt.prompt,
    imgPrompt.image_type as any,
    isDualCharacter ? 2 : 1,
  );
  const isInteractionScene = isDualCharacter && (
    classification.interactionType === 'intimate' ||
    classification.interactionType === 'romantic' ||
    classification.hasIntimateContent
  );
  if (isInteractionScene) {
    console.log(`[V4][${promptId}] INTERACTION SCENE detected (type: ${classification.interactionType}) — will use unified prompt`);
  }

  // ── Resource LoRA injection ──
  // Auto-select pose/style LoRAs from the resource library based on prompt keywords.
  const maxResourceSlots = 8 - loraStack.length;
  if (maxResourceSlots > 0) {
    const resourceLoras = selectResourceLoras(imgPrompt.prompt, contentMode, maxResourceSlots, isDualCharacter);
    for (const rl of resourceLoras) {
      loraStack.push({
        filename: rl.filename,
        strengthModel: rl.defaultStrengthModel,
        strengthClip: rl.defaultStrengthClip,
      });
      characterLoraDownloads.push({
        filename: rl.filename,
        url: rl.storageUrl,
      });
      if (rl.triggerWord) {
        triggerWords.push(rl.triggerWord);
      }
      console.log(`[V4][${promptId}] Resource LoRA: ${rl.filename} (${rl.category}, trigger: ${rl.triggerWord || 'none'})`);
    }
  }

  // Apply profile-driven LoRA strengths to character LoRAs already in the stack
  // Model strength controls visual identity; CLIP strength controls text encoder influence.
  // Lower CLIP strength improves prompt adherence while preserving character appearance.
  for (const lora of loraStack) {
    lora.strengthModel = profile.charLoraStrengthModel;
    lora.strengthClip = profile.charLoraStrengthClip;
  }

  // ── Build character identity tags FIRST so we know the token budget for scene tags ──
  // Characters with deployed LoRAs carry their identity via the trigger word — adding
  // inline physical descriptions (skin, hair, body type) competes with the LoRA and
  // can override explicit content tags. Only include the character count tag (1girl/1boy).
  // Characters WITHOUT a LoRA get concise inline descriptions for identity.
  let characterTags = "";
  if (primaryCharData) {
    if (hasLoraForPrimaryChar) {
      characterTags = primaryCharData.gender === "male" ? "1boy" : "1girl";
    } else {
      characterTags = buildCharacterTags({
        gender: primaryCharData.gender === "male" ? "male" : "female",
        ethnicity: primaryCharData.ethnicity,
        skinTone: primaryCharData.skinTone,
        hairColor: primaryCharData.hairColor,
        hairStyle: primaryCharData.hairStyle,
        eyeColor: primaryCharData.eyeColor,
        bodyType: primaryCharData.bodyType,
        age: primaryCharData.age,
      }, { mode });
    }
  }

  let secondaryCharacterTags: string | undefined;
  if (secondaryCharData) {
    if (hasLoraForSecondaryChar) {
      secondaryCharacterTags = secondaryCharData.gender === "male" ? "1boy" : "1girl";
    } else {
      secondaryCharacterTags = buildCharacterTags({
        gender: secondaryCharData.gender === "male" ? "male" : "female",
        ethnicity: secondaryCharData.ethnicity,
        skinTone: secondaryCharData.skinTone,
        hairColor: secondaryCharData.hairColor,
        hairStyle: secondaryCharData.hairStyle,
        eyeColor: secondaryCharData.eyeColor,
        bodyType: secondaryCharData.bodyType,
        age: secondaryCharData.age,
      }, { mode });
    }
  }

  // ── Calculate token budget for scene tags using ACTUAL character tag lengths ──
  const prefixTokenEstimate = 7; // "photograph, high resolution, cinematic, skin textures, detailed"
  const triggerTokenEstimate = triggerWords.length * 2;
  const charTagTokenEstimate = estimateClipTokens(characterTags) + (secondaryCharacterTags ? estimateClipTokens(secondaryCharacterTags) : 0);
  const sceneTokenBudget = Math.max(20, 75 - prefixTokenEstimate - triggerTokenEstimate - charTagTokenEstimate - 2);

  // Run prose-to-tags conversion and pose classification in parallel.
  // Pose classification determines whether ControlNet OpenPose conditioning
  // should guide the spatial composition of the generated image.
  // ControlNet requires OpenPoseXL2.safetensors on the RunPod endpoint — skip if not deployed.
  const controlNetEnabled = process.env.ENABLE_CONTROLNET === "true" && !params.disableControlNet;
  const [sceneTags, selectedPose] = await Promise.all([
    overrideTags
      ? Promise.resolve(overrideTags)
      : convertProseToPrompt(imgPrompt.prompt, { nsfw: isNsfw, tokenBudget: sceneTokenBudget }),
    controlNetEnabled ? classifyPose(imgPrompt.prompt, classification) : Promise.resolve(null),
  ]);
  console.log(`[V4][${promptId}] Scene tags (budget=${sceneTokenBudget}): ${sceneTags}`);
  if (selectedPose) {
    console.log(`[V4][${promptId}] ControlNet pose: ${selectedPose.id} (${selectedPose.name})`);
  }

  // Style LoRA stack removed — Juggernaut Ragnarok handles photorealism natively.
  // Character LoRAs (already in loraStack) are the only LoRAs injected at inference time.
  // See docs/skills/juggernaut-ragnarok/SKILL.md for details.

  // Assemble prompts
  const qualityPrefix = buildQualityPrefix(mode);
  const negativePrompt = buildNegativePrompt(mode);

  // ── Dimensions ──
  const { width, height } = getDimensions("portrait", isDualCharacter);

  // ── Build workflow ──
  let positivePrompt: string;
  let dualCharacterPrompts: { char1Prompt: string; char2Prompt: string } | undefined;

  if (isDualCharacter && secondaryCharacterTags && !isInteractionScene) {
    // Regional conditioning for NON-INTERACTION dual-character scenes.
    // Each character gets area-constrained conditioning (left/right regions).
    // Only used when characters occupy separate space (side-by-side, observing, etc.)
    const sharedParts = [qualityPrefix, sceneTags].filter(Boolean);
    positivePrompt = sharedParts.join(', ');

    // Character 1 (left region): per-character trigger word + identity tags
    const char1Parts = [primaryTriggerWord, characterTags].filter(Boolean);
    // Character 2 (right region): per-character trigger word + identity tags
    const char2Parts = [secondaryTriggerWord, secondaryCharacterTags].filter(Boolean);

    dualCharacterPrompts = {
      char1Prompt: char1Parts.join(', '),
      char2Prompt: char2Parts.join(', '),
    };

    console.log(`[V4][${promptId}] DUAL-CHARACTER regional prompting enabled (${mode}, overlap=${profile.regionalOverlap}px)`);
    console.log(`[V4][${promptId}] Shared: ${positivePrompt}`);
    console.log(`[V4][${promptId}] Char1 (left): ${dualCharacterPrompts.char1Prompt}`);
    console.log(`[V4][${promptId}] Char2 (right): ${dualCharacterPrompts.char2Prompt}`);
  } else if (isDualCharacter && secondaryCharacterTags && isInteractionScene) {
    // UNIFIED prompt for interaction scenes — characters must physically interact.
    // Regional conditioning separates characters spatially, which prevents the model
    // from generating physical contact (kissing, embracing, sex positions).
    // Both character LoRAs still load (identity via LoRA weights), but the prompt
    // is unified so the model understands the characters should interact.
    positivePrompt = buildPositivePrompt({
      qualityPrefix,
      characterTags,
      secondaryCharacterTags,
      sceneTags,
      triggerWords,
      mode,
    });
    console.log(`[V4][${promptId}] INTERACTION SCENE — unified prompt (no regional conditioning)`);
  } else {
    // Single character: all in one prompt
    positivePrompt = buildPositivePrompt({
      qualityPrefix,
      characterTags,
      secondaryCharacterTags,
      sceneTags,
      triggerWords,
      mode,
    });
  }

  // ── Render ControlNet pose skeleton if a pose was selected ──
  const poseImages: Array<{ name: string; image: string }> = [];
  let controlNetConfig: { poseImageName: string; strength?: number } | undefined;
  if (selectedPose) {
    const { buffer } = await renderPose(selectedPose, width, height);
    const poseImageName = `pose_${selectedPose.id}.png`;
    poseImages.push({ name: poseImageName, image: buffer.toString('base64') });
    controlNetConfig = { poseImageName, strength: 0.5 };
  }

  const workflow = buildWorkflow({
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
    regionalOverlap: profile.regionalOverlap,
    controlNet: controlNetConfig,
  });

  // ── Assembled prompt for storage (includes all parts) ──
  const assembledPrompt = dualCharacterPrompts
    ? `${positivePrompt} | CHAR1: ${dualCharacterPrompts.char1Prompt} | CHAR2: ${dualCharacterPrompts.char2Prompt}`
    : positivePrompt;

  // ── Log summary ──
  console.log(
    `[V4][${promptId}] === GENERATION SUMMARY ===\n` +
    JSON.stringify({
      pipeline: "V4 (juggernaut_ragnarok)",
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
      controlNetPose: selectedPose?.id ?? null,
      promptLength: assembledPrompt.length,
      dimensions: `${width}x${height}`,
      profile: `${profile.compositionType}/${profile.contentMode}`,
    }, null, 2),
  );

  return {
    workflow,
    images: poseImages, // Pose skeleton PNGs for ControlNet (empty if no pose)
    characterLoraDownloads,
    assembledPrompt,
    negativePrompt,
    mode,
    seed,
    width,
    height,
    engine: "juggernaut_ragnarok",
    profile,
  };
}
