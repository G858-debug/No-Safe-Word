import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { submitGeneration, CivitaiError } from "@no-safe-word/image-gen";
import { buildPrompt, buildNegativePrompt } from "@no-safe-word/image-gen";
import { DEFAULT_SETTINGS } from "@no-safe-word/shared";
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
    const { prompt: customPrompt, model_urn } = body as { prompt?: string; model_urn?: string };

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
      // Find any previously generated images for this character
      const { data: oldImages } = await supabase
        .from("images")
        .select("id, stored_url")
        .eq("character_id", character.id)
        .not("stored_url", "is", null);

      if (oldImages && oldImages.length > 0) {
        // Delete old images from storage
        const pathsToDelete: string[] = [];

        for (const img of oldImages) {
          if (img.stored_url) {
            // Extract storage path from URL
            // URL format: https://{project}.supabase.co/storage/v1/object/public/story-images/{path}
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
      // Continue with regeneration even if cleanup fails
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

    // 6. Generate with a known random seed (not -1) so we can store it for
    //    character consistency. Civitai does not report back the seed it picks
    //    when seed=-1, so we choose one ourselves.
    const seed = Math.floor(Math.random() * 2_147_483_647) + 1;
    const settings = { ...DEFAULT_SETTINGS, seed, batchSize: 1, ...(model_urn ? { modelUrn: model_urn } : {}) };
    const result = await submitGeneration(
      characterData,
      PORTRAIT_SCENE,
      settings,
      customPrompt ? { prompt: customPrompt } : undefined
    );

    // 7. Persist image record and generation jobs
    const { data: imageRow, error: imgError } = await supabase
      .from("images")
      .insert({
        character_id: character.id,
        prompt,
        negative_prompt: negativePrompt,
        settings: {
          modelUrn: settings.modelUrn,
          width: settings.width,
          height: settings.height,
          steps: settings.steps,
          cfgScale: settings.cfgScale,
          scheduler: settings.scheduler,
          seed: settings.seed,
          clipSkip: settings.clipSkip,
          batchSize: settings.batchSize,
        },
        mode: "sfw",
      })
      .select("id")
      .single();

    if (imgError || !imageRow) {
      throw new Error(`Failed to create image record: ${imgError?.message}`);
    }

    if (result.jobs.length > 0) {
      const jobRows = result.jobs.map((job) => ({
        job_id: job.jobId,
        image_id: imageRow.id,
        status: "pending" as const,
        cost: job.cost,
      }));
      await supabase.from("generation_jobs").insert(jobRows);
    }

    // Don't change approval status — old image stays until new one is approved

    return NextResponse.json({
      jobId: result.jobs[0]?.jobId,
      imageId: imageRow.id,
    });
  } catch (err) {
    if (err instanceof CivitaiError) {
      return NextResponse.json(
        { error: err.message, details: err.details },
        { status: err.status }
      );
    }
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
