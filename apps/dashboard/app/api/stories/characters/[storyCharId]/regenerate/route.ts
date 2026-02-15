import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { buildPrompt, buildNegativePrompt } from "@no-safe-word/image-gen";
import { submitRunPodSync, base64ToBuffer, buildPortraitWorkflow } from "@no-safe-word/image-gen";
import type { CharacterData, SceneData } from "@no-safe-word/shared";

const PORTRAIT_SCENE: SceneData = {
  mode: "sfw",
  setting: "studio portrait, clean neutral background",
  lighting: "soft studio",
  mood: "professional portrait",
  sfwDescription:
    "head and shoulders portrait, looking at camera, neutral expression, photorealistic",
  nsfwDescription: "",
  additionalTags: [],
};

// POST /api/stories/characters/[storyCharId]/regenerate — Regenerate with optional custom prompt
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    const body = await request.json();
    const { prompt: customPrompt } = body as { prompt?: string };

    console.log(`[StoryPublisher] Regenerating character ${storyCharId}, customPrompt: ${!!customPrompt}`);

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
      gender: (desc.gender as CharacterData["gender"]) || "female",
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

    // 5. Determine prompt and negative prompt
    let prompt: string;
    let negativePrompt: string;

    if (customPrompt) {
      prompt = customPrompt;
      negativePrompt = buildNegativePrompt(PORTRAIT_SCENE);
    } else {
      prompt = buildPrompt(characterData, PORTRAIT_SCENE);
      negativePrompt = buildNegativePrompt(PORTRAIT_SCENE);
    }

    // 6. Generate with a known random seed
    const seed = Math.floor(Math.random() * 2_147_483_647) + 1;

    console.log(`[StoryPublisher] Regenerating portrait via RunPod for ${character.name}, seed: ${seed}`);

    const workflow = buildPortraitWorkflow({
      positivePrompt: prompt,
      negativePrompt,
      width: 832,
      height: 1216,
      seed,
      filenamePrefix: `portrait_${character.name.replace(/\s+/g, "_").toLowerCase()}`,
    });

    const { imageBase64, executionTime } = await submitRunPodSync(workflow);
    console.log(`[StoryPublisher] RunPod portrait regenerated in ${executionTime}ms`);

    // Store directly to Supabase Storage
    const buffer = base64ToBuffer(imageBase64);
    const timestamp = Date.now();
    const storagePath = `characters/${character.name.replace(/\s+/g, "-").toLowerCase()}-${timestamp}.png`;

    const { error: uploadError } = await supabase.storage
      .from("story-images")
      .upload(storagePath, buffer, { contentType: "image/png", upsert: true });

    if (uploadError) {
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    const { data: { publicUrl } } = supabase.storage
      .from("story-images")
      .getPublicUrl(storagePath);

    // Create image record
    const { data: imageRow, error: imgError } = await supabase
      .from("images")
      .insert({
        character_id: character.id,
        prompt,
        negative_prompt: negativePrompt,
        settings: { width: 832, height: 1216, steps: 30, cfg: 7, seed, engine: "runpod-comfyui" },
        mode: "sfw",
        sfw_url: publicUrl,
        stored_url: publicUrl,
      })
      .select("id")
      .single();

    if (imgError || !imageRow) {
      throw new Error(`Failed to create image record: ${imgError?.message}`);
    }

    // Don't change approval status — old image stays until new one is approved

    return NextResponse.json({
      imageId: imageRow.id,
      imageUrl: publicUrl,
      seed,
      completed: true,
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
