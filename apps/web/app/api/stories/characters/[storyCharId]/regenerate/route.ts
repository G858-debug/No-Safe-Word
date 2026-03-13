import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import {
  buildKontextWorkflow,
  buildKontextIdentityPrefix,
  buildFluxPrompt,
  selectKontextResources,
  submitRunPodJob,
} from "@no-safe-word/image-gen";
import type { CharacterData } from "@no-safe-word/shared";

type ImageType = "portrait" | "fullBody";

const PORTRAIT_SCENE_DESCRIPTION =
  "Professional portrait photography with soft diffused studio lighting against a clean neutral gray backdrop. Close-up head and shoulders, looking directly at the camera with a confident expression.";

const FULLBODY_SCENE_DESCRIPTION =
  "Full body standing pose in soft studio lighting against a medium gray backdrop. She wears a form-fitting bodycon dress or tight outfit that accentuates her figure. Full body visible from head to feet, looking directly at the camera.";

// POST /api/stories/characters/[storyCharId]/regenerate — Regenerate with optional custom prompt
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    const body = await request.json();
    const { prompt: customPrompt, seed: customSeed } = body as { prompt?: string; seed?: number };
    const imageType: ImageType = body.type === "fullBody" ? "fullBody" : "portrait";

    console.log(`[StoryPublisher] Regenerating ${imageType} (Kontext) for character ${storyCharId}, customPrompt: ${!!customPrompt}`);

    // 1. Fetch the story_character row
    const { data: storyChar, error: scError } = await supabase
      .from("story_characters")
      .select("id, character_id")
      .eq("id", storyCharId)
      .single();

    if (scError || !storyChar) {
      return NextResponse.json(
        { error: "Story character not found" },
        { status: 404 }
      );
    }

    // 2. Fetch the character's structured description
    const { data: character, error: charError } = await supabase
      .from("characters")
      .select("id, name, description")
      .eq("id", storyChar.character_id)
      .single();

    if (charError || !character) {
      return NextResponse.json(
        { error: "Character not found" },
        { status: 404 }
      );
    }

    // 3. Build CharacterData from the stored description JSON
    const desc = character.description as Record<string, string>;
    const characterData: CharacterData = {
      name: character.name,
      gender: (['male', 'female', 'non-binary', 'other'].includes(desc.gender) ? desc.gender as CharacterData["gender"] : 'female') as CharacterData["gender"],
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
    };

    // 4. Clean up old image from storage if it exists
    try {
      const { data: oldImages } = await supabase
        .from("images")
        .select("id, stored_url")
        .eq("character_id", character.id)
        .not("stored_url", "is", null);

      if (oldImages && oldImages.length > 0) {
        const pathsToDelete: string[] = [];

        for (const img of oldImages) {
          if (img.stored_url) {
            const urlParts = img.stored_url.split("/story-images/");
            if (urlParts.length === 2) {
              pathsToDelete.push(urlParts[1]);
            }
          }
        }

        if (pathsToDelete.length > 0) {
          await supabase.storage.from("story-images").remove(pathsToDelete);
          console.log(`Deleted ${pathsToDelete.length} old character images from storage`);
        }
      }
    } catch (err) {
      console.warn("Failed to clean up old character images:", err);
    }

    // 5. Build Kontext prompt
    let fluxPrompt: string;

    if (customPrompt) {
      // Custom prompt is used as-is (caller is responsible for Flux-style prose)
      fluxPrompt = customPrompt;
    } else {
      const identityPrefix = await buildKontextIdentityPrefix(characterData);
      const sceneDescription = imageType === "fullBody" ? FULLBODY_SCENE_DESCRIPTION : PORTRAIT_SCENE_DESCRIPTION;
      ({ prompt: fluxPrompt } = buildFluxPrompt(identityPrefix, sceneDescription, { mode: 'sfw' }));
    }

    // 6. Select Kontext LoRAs
    const gender = characterData.gender === 'male' ? 'male' : 'female';
    const kontextResources = selectKontextResources({
      gender,
      isSfw: true,
      imageType: imageType,
      prompt: fluxPrompt,
      hasDualCharacter: false,
    });

    const seed = (typeof customSeed === "number" && customSeed > 0) ? customSeed : Math.floor(Math.random() * 2_147_483_647) + 1;

    // Prepend LoRA trigger words that aren't already in the prompt
    const finalPrompt = kontextResources.triggerWords.length > 0
      ? `${kontextResources.triggerWords.join(' ')} ${fluxPrompt}`
      : fluxPrompt;

    console.log(`[StoryPublisher] LoRAs: ${kontextResources.loras.length > 0 ? kontextResources.loras.map(l => `${l.filename}(${l.strengthModel.toFixed(2)})`).join(", ") : "NONE"}`);
    if (kontextResources.triggerWords.length > 0) {
      console.log(`[StoryPublisher] Trigger words injected: ${kontextResources.triggerWords.join(', ')}`);
    }
    console.log(`[StoryPublisher] Submitting portrait regeneration (Kontext) for ${character.name}, seed: ${seed}`);

    // 7. Build Kontext workflow
    const workflow = buildKontextWorkflow({
      type: 'portrait',
      positivePrompt: finalPrompt,
      width: 832,
      height: 1216,
      seed,
      filenamePrefix: `${imageType === "fullBody" ? "fullbody" : "portrait"}_${character.name.replace(/\s+/g, "_").toLowerCase()}`,
      loras: kontextResources.loras,
    });

    // Submit async job to RunPod (returns immediately)
    const { jobId } = await submitRunPodJob(workflow);

    // Create image record (stored_url will be set when status polling completes)
    const { data: imageRow, error: imgError } = await supabase
      .from("images")
      .insert({
        character_id: character.id,
        prompt: fluxPrompt,
        settings: {
          width: 832,
          height: 1216,
          engine: "kontext",
          imageType,
          seed,
        },
        mode: "sfw",
      })
      .select("id")
      .single();

    if (imgError || !imageRow) {
      throw new Error(`Failed to create image record: ${imgError?.message}`);
    }

    // Create generation job record for status polling
    await supabase.from("generation_jobs").insert({
      job_id: `runpod-${jobId}`,
      image_id: imageRow.id,
      status: "pending",
      cost: 0,
    });

    console.log(`[StoryPublisher] ${imageType === "fullBody" ? "Full body" : "Portrait"} regeneration job submitted: runpod-${jobId}, imageId: ${imageRow.id}`);

    return NextResponse.json({
      jobId: `runpod-${jobId}`,
      imageId: imageRow.id,
    });
  } catch (err) {
    console.error("Character portrait regeneration failed:", err);
    return NextResponse.json(
      {
        error: "Regeneration failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
