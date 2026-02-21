import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { buildPrompt, buildNegativePrompt, needsAfricanFeatureCorrection } from "@no-safe-word/image-gen";
import { submitRunPodJob, buildPortraitWorkflow, classifyScene, selectResources, selectModel } from "@no-safe-word/image-gen";
import { getProgressiveAdjustments, computeNearbySeed, applyDarkSkinWeightBoost } from "@no-safe-word/image-gen";
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
    const { prompt: customPrompt, negativePrompt: customNegativePrompt } = body as { prompt?: string; negativePrompt?: string };

    console.log(`[StoryPublisher] Regenerating character ${storyCharId}, customPrompt: ${!!customPrompt}`);

    // 1. Fetch the story_character row (including regen_count and approved_seed for progressive refinement)
    const { data: storyChar, error: scError } = await supabase
      .from("story_characters")
      .select("id, character_id, regen_count, approved_seed")
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
      prompt = buildPrompt(characterData, PORTRAIT_SCENE);
    }
    negativePrompt = customNegativePrompt || buildNegativePrompt(PORTRAIT_SCENE, skinHints);

    // 6. Scene intelligence: classify portrait and select LoRAs + negative additions
    const classification = classifyScene(prompt, "portrait");
    const resources = selectResources(classification);

    // 7. Progressive refinement: adjust parameters based on regen count
    const regenCount = (storyChar as any).regen_count ?? 0;
    const prevSeed = (storyChar as any).approved_seed as number | null;
    const adjustments = getProgressiveAdjustments(regenCount, classification, characterData);

    console.log(`[StoryPublisher] Progressive refinement (regen ${regenCount}): ${adjustments.reason}`);

    // Apply seed strategy
    let seed: number;
    if (adjustments.seedStrategy === 'nearby' && prevSeed) {
      seed = computeNearbySeed(prevSeed, adjustments.seedRange);
    } else {
      seed = Math.floor(Math.random() * 2_147_483_647) + 1;
    }

    // Apply dark skin weight boost to prompt if applicable
    if (adjustments.darkSkinBoost > 0) {
      prompt = applyDarkSkinWeightBoost(prompt, adjustments.darkSkinBoost);
    }

    // Append prompt suffix if progressive refinement provides one
    if (adjustments.promptSuffix) {
      prompt = `${prompt}, ${adjustments.promptSuffix}`;
    }

    // Apply skin LoRA multiplier
    const adjustedLoras = resources.loras.map(l => {
      if (l.filename === 'realistic-skin-xl.safetensors' && adjustments.skinLoraMultiplier !== 1.0) {
        return {
          ...l,
          strengthModel: l.strengthModel * adjustments.skinLoraMultiplier,
          strengthClip: l.strengthClip * adjustments.skinLoraMultiplier,
        };
      }
      return l;
    });

    const modelSelection = selectModel(classification, "portrait");

    console.log(`[StoryPublisher] Portrait classification:`, JSON.stringify(classification));
    console.log(`[StoryPublisher] Selected model: ${modelSelection.checkpointName} (${modelSelection.reason})`);
    console.log(`[StoryPublisher] Selected LoRAs: ${adjustedLoras.map(l => `${l.filename}(${l.strengthModel.toFixed(2)})`).join(", ")}`);
    console.log(`[StoryPublisher] Submitting portrait regeneration to RunPod for ${character.name}, seed: ${seed}, cfg: ${adjustments.cfg}`);

    const workflow = buildPortraitWorkflow({
      positivePrompt: prompt,
      negativePrompt,
      width: 832,
      height: 1216,
      seed,
      filenamePrefix: `portrait_${character.name.replace(/\s+/g, "_").toLowerCase()}`,
      loras: adjustedLoras,
      negativePromptAdditions: resources.negativePromptAdditions,
      checkpointName: modelSelection.checkpointName,
      cfg: adjustments.cfg,
      samplerName: adjustments.samplerName || undefined,
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
          cfg: adjustments.cfg, seed,
          sampler: adjustments.samplerName || 'euler_ancestral',
          engine: "runpod-comfyui",
          regenCount,
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

    // Increment regen_count for progressive refinement on next regeneration
    await supabase
      .from("story_characters")
      .update({ regen_count: regenCount + 1 })
      .eq("id", storyCharId);

    console.log(`[StoryPublisher] Portrait regeneration job submitted: runpod-${jobId}, imageId: ${imageRow.id}, regen: ${regenCount + 1}`);

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
