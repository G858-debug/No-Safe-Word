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

// POST /api/stories/characters/[storyCharId]/generate — Generate a character portrait
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    console.log(`[StoryPublisher] Generating portrait for storyCharId: ${storyCharId}`);

    // 1. Fetch the story_character row
    const { data: storyChar, error: scError } = await supabase
      .from("story_characters")
      .select("id, character_id")
      .eq("id", storyCharId)
      .single();

    if (scError || !storyChar) {
      console.error(`[StoryPublisher] Story character not found: ${storyCharId}`, scError);
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
      console.error(`[StoryPublisher] Character not found: ${storyChar.character_id}`, charError);
      return NextResponse.json(
        { error: "Character not found" },
        { status: 404 }
      );
    }

    console.log(`[StoryPublisher] Generating for character: ${character.name} (${character.id})`);

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

    // 4. Generate with a known random seed
    const seed = Math.floor(Math.random() * 2_147_483_647) + 1;
    const prompt = buildPrompt(characterData, PORTRAIT_SCENE);
    const negativePrompt = buildNegativePrompt(PORTRAIT_SCENE);

    console.log(`[StoryPublisher] Generating portrait via RunPod for ${character.name}, seed: ${seed}`);

    const workflow = buildPortraitWorkflow({
      positivePrompt: prompt,
      negativePrompt,
      width: 832,
      height: 1216,
      seed,
      filenamePrefix: `portrait_${character.name.replace(/\s+/g, "_").toLowerCase()}`,
    });

    const { imageBase64, executionTime } = await submitRunPodSync(workflow);
    console.log(`[StoryPublisher] RunPod portrait generated in ${executionTime}ms`);

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

    console.log(`[StoryPublisher] RunPod portrait stored: ${publicUrl}, imageId: ${imageRow.id}`);
    return NextResponse.json({
      imageId: imageRow.id,
      imageUrl: publicUrl,
      seed,
      completed: true,
    });
  } catch (err) {
    console.error("Character portrait generation failed:", err);
    return NextResponse.json(
      {
        error: "Generation failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
