import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { buildPrompt, buildNegativePrompt, needsAfricanFeatureCorrection } from "@no-safe-word/image-gen";
import { submitRunPodJob, buildPortraitWorkflow, classifyScene, selectResources, selectModel } from "@no-safe-word/image-gen";
import { DEFAULT_MODEL } from "@no-safe-word/image-gen";
import type { CharacterData, SceneData } from "@no-safe-word/shared";

/** Debug levels for systematic resource testing (progressive — each level adds one layer) */
type DebugLevel = "bare" | "model" | "loras" | "negative" | "full";

type ImageType = "portrait" | "fullBody";

const PORTRAIT_SCENE: SceneData = {
  mode: "sfw",
  setting: "(professional portrait photography:1.2), soft diffused studio lighting, (seamless medium gray backdrop:1.3), plain uniform background",
  lighting: "soft studio",
  mood: "professional portrait",
  sfwDescription:
    "looking at camera, neutral expression, photorealistic",
  nsfwDescription: "",
  additionalTags: [],
};

const FULLBODY_SCENE: SceneData = {
  mode: "sfw",
  setting: "(fashion photography:1.2), soft diffused studio lighting, (seamless medium gray backdrop:1.3), plain uniform background",
  lighting: "studio-quality lighting",
  mood: "fashion photography",
  sfwDescription:
    "full body standing pose, full body visible head to feet, standing naturally, photorealistic",
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
    const { prompt: customPrompt, negativePrompt: customNegativePrompt, seed: customSeed } = body as { prompt?: string; negativePrompt?: string; seed?: number };

    let debugLevel: DebugLevel = "full";
    if (body.debugLevel && ["bare", "model", "loras", "negative", "full"].includes(body.debugLevel)) {
      debugLevel = body.debugLevel;
    }
    const forceModel: string | undefined = (body.forceModel && typeof body.forceModel === "string") ? body.forceModel : undefined;
    const imageType: ImageType = body.type === "fullBody" ? "fullBody" : "portrait";
    const scene = imageType === "fullBody" ? FULLBODY_SCENE : PORTRAIT_SCENE;

    console.log(`[StoryPublisher] Regenerating ${imageType} for character ${storyCharId}, customPrompt: ${!!customPrompt}, debugLevel: ${debugLevel}`);

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

    const skinHints = {
      africanFeatureCorrection: needsAfricanFeatureCorrection(characterData),
    };

    if (customPrompt) {
      prompt = customPrompt;
    } else {
      prompt = buildPrompt(characterData, scene);
    }
    negativePrompt = customNegativePrompt || buildNegativePrompt(scene, skinHints);

    // 6. Scene intelligence: classify portrait and select LoRAs + negative additions
    const classification = classifyScene(prompt, "portrait");

    const useFullNegative = debugLevel === "negative" || debugLevel === "full";
    const useLoras = debugLevel === "loras" || debugLevel === "negative" || debugLevel === "full";
    const useModelSelection = debugLevel !== "bare";
    const useFaceDetailer = debugLevel === "full";

    // Override negative prompt if custom not provided and debug level restricts it
    if (!customNegativePrompt && !useFullNegative) {
      negativePrompt = "(deformed, distorted, disfigured:1.3), poorly drawn, bad anatomy, wrong anatomy, extra limb, missing limb, floating limbs, mutated hands, extra fingers, missing fingers, (blurry:1.2), bad quality, watermark, text, signature";
    }

    const resources = useLoras ? selectResources(classification) : { loras: [], negativePromptAdditions: "" };

    // 7. Fixed generation settings (CFG 6.5, fixed or random seed)
    const seed = (typeof customSeed === "number" && customSeed > 0) ? customSeed : Math.floor(Math.random() * 2_147_483_647) + 1;
    const cfg = 6.5;

    const modelSelection = forceModel
      ? selectModel(classification, "portrait", { forceModel })
      : useModelSelection
        ? selectModel(classification, "portrait")
        : { checkpointName: DEFAULT_MODEL, model: null, fellBack: false, reason: "Debug: bare mode — using base model" };

    console.log(`[StoryPublisher] Debug level: ${debugLevel}`);
    console.log(`[StoryPublisher] Portrait classification:`, JSON.stringify(classification));
    console.log(`[StoryPublisher] Selected model: ${modelSelection.checkpointName} (${modelSelection.reason})`);
    console.log(`[StoryPublisher] Selected LoRAs: ${resources.loras.length > 0 ? resources.loras.map(l => `${l.filename}(${l.strengthModel.toFixed(2)})`).join(", ") : "NONE"}`);
    console.log(`[StoryPublisher] FaceDetailer: ${useFaceDetailer ? "ON" : "OFF"}`);
    console.log(`[StoryPublisher] Submitting portrait regeneration to RunPod for ${character.name}, seed: ${seed}, cfg: ${cfg}`);

    const workflow = buildPortraitWorkflow({
      positivePrompt: prompt,
      negativePrompt,
      width: 832,
      height: 1216,
      seed,
      filenamePrefix: `${imageType === "fullBody" ? "fullbody" : "portrait"}_${character.name.replace(/\s+/g, "_").toLowerCase()}`,
      loras: useLoras ? (resources.loras.length > 0 ? resources.loras : undefined) : [],
      negativePromptAdditions: resources.negativePromptAdditions || undefined,
      checkpointName: modelSelection.checkpointName,
      cfg,
      skipFaceDetailer: !useFaceDetailer,
    });

    // Submit async job to RunPod (returns immediately)
    const { jobId } = await submitRunPodJob(workflow);

    // Create image record (stored_url will be set when status polling completes)
    const { data: imageRow, error: imgError } = await supabase
      .from("images")
      .insert({
        character_id: character.id,
        prompt,
        negative_prompt: negativePrompt,
        settings: {
          width: 832, height: 1216, steps: 30,
          cfg, seed,
          sampler: 'euler_ancestral',
          engine: "runpod-comfyui",
          debugLevel,
          imageType,
          model: modelSelection.checkpointName,
          loras: resources.loras.map(l => l.filename),
          faceDetailer: useFaceDetailer,
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
