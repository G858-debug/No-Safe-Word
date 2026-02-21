import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { buildPrompt, buildNegativePrompt, needsAfricanFeatureCorrection } from "@no-safe-word/image-gen";
import { submitRunPodJob, buildPortraitWorkflow, classifyScene, selectResources, selectModel, DEFAULT_MODEL } from "@no-safe-word/image-gen";
import type { CharacterData, SceneData } from "@no-safe-word/shared";

/** Debug levels for systematic resource testing (progressive — each level adds one layer) */
type DebugLevel = "bare" | "model" | "loras" | "negative" | "full";

const PORTRAIT_SCENE: SceneData = {
  mode: "sfw",
  setting: "(professional portrait photography:1.2), studio lighting, bokeh background",
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
    // Parse optional debugLevel and forceModel from request body
    let debugLevel: DebugLevel = "full";
    let forceModel: string | undefined;
    let customNegativePrompt: string | undefined;
    let customSeed: number | undefined;
    try {
      const body = await request.json();
      if (body.debugLevel && ["bare", "model", "loras", "negative", "full"].includes(body.debugLevel)) {
        debugLevel = body.debugLevel;
      }
      if (body.forceModel && typeof body.forceModel === "string") {
        forceModel = body.forceModel;
      }
      if (body.negativePrompt && typeof body.negativePrompt === "string") {
        customNegativePrompt = body.negativePrompt;
      }
      if (typeof body.seed === "number" && body.seed > 0) {
        customSeed = body.seed;
      }
    } catch {
      // No body or invalid JSON — use default "full"
    }

    console.log(`[StoryPublisher] Generating portrait for storyCharId: ${storyCharId}, debugLevel: ${debugLevel}`);

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

    // 4. Generate with a known seed (fixed or random)
    const seed = customSeed || Math.floor(Math.random() * 2_147_483_647) + 1;
    const prompt = buildPrompt(characterData, PORTRAIT_SCENE);

    // --- Debug level resource selection ---
    // bare:     Base model (Juggernaut), no LoRAs, minimal negative, no FaceDetailer
    // model:    Selected model (e.g. RealVisXL), no LoRAs, minimal negative, no FaceDetailer
    // loras:    Selected model + LoRAs, minimal negative, no FaceDetailer
    // negative: Selected model + LoRAs + full negative prompt, no FaceDetailer
    // full:     Normal pipeline (everything)

    const useFullNegative = debugLevel === "negative" || debugLevel === "full";
    const useLoras = debugLevel === "loras" || debugLevel === "negative" || debugLevel === "full";
    const useModelSelection = debugLevel !== "bare";
    const useFaceDetailer = debugLevel === "full";

    // Negative prompt (custom override from UI takes priority)
    const negativePrompt = customNegativePrompt
      ? customNegativePrompt
      : useFullNegative
        ? buildNegativePrompt(PORTRAIT_SCENE, {
            africanFeatureCorrection: needsAfricanFeatureCorrection(characterData),
          })
        : "(deformed, distorted, disfigured:1.3), poorly drawn, bad anatomy, wrong anatomy, extra limb, missing limb, floating limbs, mutated hands, extra fingers, missing fingers, (blurry:1.2), bad quality, watermark, text, signature";

    // Scene classification + resources
    const classification = classifyScene(prompt, "portrait");
    const resources = useLoras ? selectResources(classification) : { loras: [], negativePromptAdditions: "" };

    // Model selection (forceModel overrides both debug level and auto-selection)
    const modelSelection = forceModel
      ? selectModel(classification, "portrait", { forceModel })
      : useModelSelection
        ? selectModel(classification, "portrait")
        : { checkpointName: DEFAULT_MODEL, model: null, fellBack: false, reason: "Debug: bare mode — using base model" };

    console.log(`[StoryPublisher] Debug level: ${debugLevel}`);
    console.log(`[StoryPublisher]   Model: ${modelSelection.checkpointName} (${modelSelection.reason})`);
    console.log(`[StoryPublisher]   LoRAs: ${resources.loras.length > 0 ? resources.loras.map(l => l.filename).join(", ") : "NONE"}`);
    console.log(`[StoryPublisher]   Negative prompt: ${useFullNegative ? "full (SFW + African correction)" : "minimal (base only)"}`);
    console.log(`[StoryPublisher]   FaceDetailer: ${useFaceDetailer ? "ON" : "OFF"}`);
    console.log(`[StoryPublisher]   Seed: ${seed}`);

    const workflow = buildPortraitWorkflow({
      positivePrompt: prompt,
      negativePrompt,
      width: 832,
      height: 1216,
      seed,
      filenamePrefix: `portrait_${character.name.replace(/\s+/g, "_").toLowerCase()}`,
      loras: useLoras ? (resources.loras.length > 0 ? resources.loras : undefined) : [],
      negativePromptAdditions: resources.negativePromptAdditions || undefined,
      checkpointName: modelSelection.checkpointName,
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
          width: 832, height: 1216, steps: 30, cfg: 7.5, seed,
          engine: "runpod-comfyui",
          debugLevel,
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

    console.log(`[StoryPublisher] Portrait job submitted: runpod-${jobId}, imageId: ${imageRow.id}`);

    return NextResponse.json({
      jobId: `runpod-${jobId}`,
      imageId: imageRow.id,
      debugLevel,
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
