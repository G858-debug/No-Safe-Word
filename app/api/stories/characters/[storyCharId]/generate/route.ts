import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { submitGeneration, CivitaiError } from "@/lib/civitai";
import { buildPrompt, buildNegativePrompt } from "@/lib/prompt-builder";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import type { CharacterData, SceneData } from "@/lib/types";

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
  _request: NextRequest,
  { params }: { params: { storyCharId: string } }
) {
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

    // 4. Generate with default settings (random seed)
    const settings = { ...DEFAULT_SETTINGS, seed: -1, batchSize: 1 };
    console.log(`[StoryPublisher] Submitting generation to Civitai for ${character.name}`);
    const result = await submitGeneration(characterData, PORTRAIT_SCENE, settings);
    console.log(`[StoryPublisher] Civitai response:`, {
      jobCount: result.jobs.length,
      firstJobId: result.jobs[0]?.jobId,
      cost: result.jobs[0]?.cost
    });

    // 5. Persist image record and generation jobs
    const prompt = buildPrompt(characterData, PORTRAIT_SCENE);
    const negativePrompt = buildNegativePrompt(PORTRAIT_SCENE);

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
      console.error(`[StoryPublisher] Failed to create image record:`, imgError);
      throw new Error(`Failed to create image record: ${imgError?.message}`);
    }

    console.log(`[StoryPublisher] Created image record: ${imageRow.id}`);

    if (result.jobs.length > 0) {
      const jobRows = result.jobs.map((job) => ({
        job_id: job.jobId,
        image_id: imageRow.id,
        status: "pending" as const,
        cost: job.cost,
      }));
      await supabase.from("generation_jobs").insert(jobRows);
      console.log(`[StoryPublisher] Inserted ${jobRows.length} generation job(s)`);
    }

    console.log(`[StoryPublisher] Generation started - jobId: ${result.jobs[0]?.jobId}, imageId: ${imageRow.id}`);
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
