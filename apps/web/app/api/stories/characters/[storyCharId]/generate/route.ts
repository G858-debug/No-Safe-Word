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

// POST /api/stories/characters/[storyCharId]/generate — Generate a character portrait or full body
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    // Parse optional seed and type from request body
    let customSeed: number | undefined;
    let imageType: ImageType = "portrait";
    try {
      const body = await request.json();
      if (typeof body.seed === "number" && body.seed > 0) {
        customSeed = body.seed;
      }
      if (body.type === "fullBody") {
        imageType = "fullBody";
      }
    } catch {
      // No body or invalid JSON — use defaults
    }

    console.log(`[StoryPublisher] Generating ${imageType} (Kontext) for storyCharId: ${storyCharId}`);

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

    // 4. Build Kontext prompt
    const seed = customSeed || Math.floor(Math.random() * 2_147_483_647) + 1;
    const identityPrefix = buildKontextIdentityPrefix(characterData);
    const sceneDescription = imageType === "fullBody" ? FULLBODY_SCENE_DESCRIPTION : PORTRAIT_SCENE_DESCRIPTION;
    const { prompt: fluxPrompt } = buildFluxPrompt(identityPrefix, sceneDescription, { mode: 'sfw' });

    // 5. Select Kontext LoRAs
    const gender = characterData.gender === 'male' ? 'male' : 'female';
    const kontextResources = selectKontextResources({
      gender,
      isSfw: true,
      imageType: imageType,
      prompt: fluxPrompt,
      hasDualCharacter: false,
    });

    // Prepend LoRA trigger words that aren't already in the prompt
    const finalPrompt = kontextResources.triggerWords.length > 0
      ? `${kontextResources.triggerWords.join(' ')} ${fluxPrompt}`
      : fluxPrompt;

    console.log(`[StoryPublisher] Kontext identity prefix: ${identityPrefix.substring(0, 80)}...`);
    console.log(`[StoryPublisher] LoRAs: ${kontextResources.loras.length > 0 ? kontextResources.loras.map(l => l.filename).join(", ") : "NONE"}`);
    if (kontextResources.triggerWords.length > 0) {
      console.log(`[StoryPublisher] Trigger words injected: ${kontextResources.triggerWords.join(', ')}`);
    }
    console.log(`[StoryPublisher] Seed: ${seed}`);

    // 6. Build Kontext workflow
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

    console.log(`[StoryPublisher] ${imageType === "fullBody" ? "Full body" : "Portrait"} job submitted: runpod-${jobId}, imageId: ${imageRow.id}`);

    return NextResponse.json({
      jobId: `runpod-${jobId}`,
      imageId: imageRow.id,
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
