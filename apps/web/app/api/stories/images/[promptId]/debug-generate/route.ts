/**
 * Debug Generation API Route
 *
 * POST /api/stories/images/[promptId]/debug-generate
 *
 * Generates an image in debug mode, which adds intermediate SaveImage nodes
 * to the multi-pass workflow. Returns all intermediate images alongside
 * the full diagnostic data (prompts, parameters, decomposed prompts, etc.).
 *
 * The debug data is stored in the story_image_prompts.debug_data JSONB column.
 *
 * Location: apps/web/app/api/stories/images/[promptId]/debug-generate/route.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import {
  extractCharacterTags,
  buildStoryImagePrompt,
  classifyScene,
  selectDimensionsFromPrompt,
  selectResources,
  selectModel,
  decomposePrompt,
  buildWorkflow,
  submitRunPodJob,
  buildCharacterLoraEntry,
  optimizePrompts,
  shouldOptimize,
  buildDebugPassInfo,
  injectDebugSaveNodes,
} from "@no-safe-word/image-gen";
import type { ImageType, CharacterLoraEntry, DecomposedPrompt, CharacterContext } from "@no-safe-word/image-gen";
import type { CharacterData } from "@no-safe-word/shared";

// POST /api/stories/images/[promptId]/debug-generate
export async function POST(
  _request: NextRequest,
  props: { params: Promise<{ promptId: string }> }
) {
  const params = await props.params;
  const { promptId } = params;

  try {
    // 1. Fetch the image prompt
    const { data: imgPrompt, error: promptError } = await supabase
      .from("story_image_prompts")
      .select("id, post_id, image_type, position, character_name, character_id, secondary_character_name, secondary_character_id, prompt, image_id")
      .eq("id", promptId)
      .single();

    if (promptError || !imgPrompt) {
      return NextResponse.json(
        { error: "Image prompt not found" },
        { status: 404 }
      );
    }

    // 2. Fetch series info via post
    const { data: post } = await supabase
      .from("story_posts")
      .select("series_id")
      .eq("id", imgPrompt.post_id)
      .single();

    if (!post) {
      return NextResponse.json(
        { error: "Post not found for this image prompt" },
        { status: 404 }
      );
    }

    // 3. Fetch character data
    let charData: CharacterData = {
      name: "", gender: "female", ethnicity: "", bodyType: "", hairColor: "",
      hairStyle: "", eyeColor: "", skinTone: "", distinguishingFeatures: "",
      clothing: "", pose: "", expression: "", age: "",
    };

    let approvedCharacterTags: string | null = null;
    let secondaryCharacterTags: string | null = null;
    let primaryCharLora: CharacterLoraEntry | undefined;
    let secondaryCharLora: CharacterLoraEntry | undefined;
    let secondaryGender: 'male' | 'female' | undefined;

    if (imgPrompt.character_id) {
      const { data: character } = await supabase
        .from("characters")
        .select("id, name, description")
        .eq("id", imgPrompt.character_id)
        .single();

      if (character) {
        const desc = character.description as Record<string, string>;
        charData = {
          name: character.name,
          gender: (['male', 'female', 'non-binary', 'other'].includes(desc.gender) ? desc.gender as CharacterData["gender"] : 'female') as CharacterData["gender"],
          ethnicity: desc.ethnicity || "", bodyType: desc.bodyType || "",
          hairColor: desc.hairColor || "", hairStyle: desc.hairStyle || "",
          eyeColor: desc.eyeColor || "", skinTone: desc.skinTone || "",
          distinguishingFeatures: desc.distinguishingFeatures || "",
          clothing: desc.clothing || "", pose: desc.pose || "",
          expression: desc.expression || "", age: desc.age || "",
        };
      }

      // Fetch approved tags and LoRA
      const { data: storyChar } = await (supabase as any)
        .from("story_characters")
        .select("approved_prompt, approved_seed, active_lora_id")
        .eq("series_id", post.series_id)
        .eq("character_id", imgPrompt.character_id)
        .single() as {
          data: { approved_prompt: string | null; approved_seed: number | null; active_lora_id: string | null } | null;
        };

      if (storyChar?.approved_prompt) {
        approvedCharacterTags = extractCharacterTags(storyChar.approved_prompt);
      }

      // Fetch deployed LoRA
      if (storyChar?.active_lora_id) {
        const { data: loraRecord } = await (supabase as any)
          .from("character_loras")
          .select("id, character_id, filename, trigger_word, storage_url")
          .eq("id", storyChar.active_lora_id)
          .eq("status", "deployed")
          .single() as {
            data: { id: string; character_id: string; filename: string; trigger_word: string; storage_url: string | null } | null;
          };

        if (loraRecord?.storage_url) {
          primaryCharLora = buildCharacterLoraEntry({
            character_id: loraRecord.character_id,
            character_name: charData.name || "Unknown",
            filename: loraRecord.filename,
            trigger_word: loraRecord.trigger_word,
            storage_url: loraRecord.storage_url,
          });
        }
      }

      // Fetch secondary character data
      if (imgPrompt.secondary_character_id) {
        const { data: secChar } = await supabase
          .from("characters")
          .select("description")
          .eq("id", imgPrompt.secondary_character_id)
          .single();
        if (secChar?.description) {
          secondaryGender = (secChar.description as Record<string, string>).gender as 'male' | 'female' | undefined;
        }

        const { data: secondaryStoryChar } = await (supabase as any)
          .from("story_characters")
          .select("approved_prompt, active_lora_id")
          .eq("series_id", post.series_id)
          .eq("character_id", imgPrompt.secondary_character_id)
          .single() as {
            data: { approved_prompt: string | null; active_lora_id: string | null } | null;
          };

        if (secondaryStoryChar?.approved_prompt) {
          secondaryCharacterTags = extractCharacterTags(secondaryStoryChar.approved_prompt);
        }

        if (secondaryStoryChar?.active_lora_id) {
          const { data: secLoraRecord } = await (supabase as any)
            .from("character_loras")
            .select("id, character_id, filename, trigger_word, storage_url")
            .eq("id", secondaryStoryChar.active_lora_id)
            .eq("status", "deployed")
            .single() as {
              data: { id: string; character_id: string; filename: string; trigger_word: string; storage_url: string | null } | null;
            };

          if (secLoraRecord?.storage_url) {
            secondaryCharLora = buildCharacterLoraEntry({
              character_id: secLoraRecord.character_id,
              character_name: imgPrompt.secondary_character_name || "Unknown",
              filename: secLoraRecord.filename,
              trigger_word: secLoraRecord.trigger_word,
              storage_url: secLoraRecord.storage_url,
            });
          }
        }
      }
    }

    // 4. Determine mode and seed
    const isNsfw = imgPrompt.image_type === "website_nsfw_paired";
    const mode: "sfw" | "nsfw" = isNsfw ? "nsfw" : "sfw";
    const seed = Math.floor(Math.random() * 2_147_483_647) + 1;
    const hasSecondary = !!imgPrompt.secondary_character_id;

    // 5. Force multi-pass workflow for debug mode (only makes sense with a character LoRA)
    if (!imgPrompt.character_id || !primaryCharLora) {
      return NextResponse.json(
        { error: "Debug generation requires a character with a deployed LoRA (multi-pass workflow)" },
        { status: 400 }
      );
    }

    // 6. Build the prompt pipeline
    const triggerWords = [primaryCharLora, secondaryCharLora]
      .filter((l): l is CharacterLoraEntry => !!l)
      .map(l => l.triggerWord)
      .filter((tw): tw is string => !!tw);

    const assembledPrompt = (approvedCharacterTags || secondaryCharacterTags)
      ? buildStoryImagePrompt(approvedCharacterTags, secondaryCharacterTags, imgPrompt.prompt, mode, triggerWords)
      : imgPrompt.prompt;

    let finalPrompt = assembledPrompt;

    // 7. Scene classification
    const classification = classifyScene(finalPrompt, imgPrompt.image_type as ImageType);

    // 8. Decompose the prompt
    let decomposed = decomposePrompt(finalPrompt, approvedCharacterTags, secondaryCharacterTags);

    // 9. AI Prompt Optimization
    const characters: CharacterContext[] = [];
    if (charData.name) {
      characters.push({
        name: charData.name,
        gender: (charData.gender as 'male' | 'female') || 'female',
        role: 'primary',
        identityTags: approvedCharacterTags || undefined,
      });
    }
    if (imgPrompt.secondary_character_id) {
      characters.push({
        name: imgPrompt.secondary_character_name || 'Unknown',
        gender: secondaryGender || 'female',
        role: 'secondary',
        identityTags: secondaryCharacterTags || undefined,
      });
    }

    let optimizationNotes: string[] = ["Optimization not attempted"];
    let optimizationDurationMs = 0;
    let optimizationApplied = false;

    // Store original decomposed for comparison
    const originalDecomposed = { ...decomposed };

    if (shouldOptimize(characters, imgPrompt.image_type)) {
      const optimResult = await optimizePrompts(
        {
          fullPrompt: finalPrompt,
          rawScenePrompt: imgPrompt.prompt,
          characters,
          mode,
          imageType: imgPrompt.image_type as 'facebook_sfw' | 'website_nsfw_paired' | 'website_only' | 'portrait',
        },
        decomposed,
      );

      if (optimResult.wasOptimized) {
        finalPrompt = optimResult.optimizedFullPrompt;
        decomposed = optimResult.optimizedDecomposed;
        optimizationApplied = true;
      }
      optimizationNotes = optimResult.notes;
      optimizationDurationMs = optimResult.durationMs;
      console.log(`[DebugGen][${promptId}] AI optimization: ${optimResult.wasOptimized ? 'applied' : 'skipped'} (${optimResult.durationMs}ms)`);
    }

    // 10. Dimensions and resources
    const dimensions = selectDimensionsFromPrompt(classification, imgPrompt.image_type as ImageType, hasSecondary, finalPrompt);
    const resources = selectResources(classification, primaryCharLora, secondaryCharLora, finalPrompt, imgPrompt.image_type as ImageType);
    const modelSelection = selectModel(classification, imgPrompt.image_type as ImageType, {
      contentLevel: classification.contentLevel,
    });

    // 11. Face prompts
    let primaryFacePrompt = approvedCharacterTags ||
      `portrait of ${charData.name}, ${charData.ethnicity}, ${charData.skinTone} skin, ${charData.hairStyle} ${charData.hairColor} hair, ${charData.eyeColor} eyes, photorealistic`;
    let secondaryFacePrompt: string | undefined;
    let secondarySeed: number | undefined;

    if (hasSecondary) {
      secondaryFacePrompt = secondaryCharacterTags || "person, photorealistic";
      secondarySeed = seed + 1000;
    }

    // Prepend LoRA trigger words
    if (primaryCharLora) {
      primaryFacePrompt = `${primaryCharLora.triggerWord || 'tok'}, ${primaryFacePrompt}`;
    }
    if (secondaryCharLora && secondaryFacePrompt) {
      secondaryFacePrompt = `${secondaryCharLora.triggerWord || 'tok'}, ${secondaryFacePrompt}`;
    }

    // 12. Gender LoRAs for person inpainting
    const primaryGender = charData.gender as 'male' | 'female' | undefined;
    const primaryGenderLoras = primaryGender === 'female'
      ? resources.femaleLoras.map(l => ({ filename: l.filename, strengthModel: l.strengthModel, strengthClip: l.strengthClip }))
      : primaryGender === 'male'
        ? resources.maleLoras.map(l => ({ filename: l.filename, strengthModel: l.strengthModel, strengthClip: l.strengthClip }))
        : [];

    const secondaryGenderLoras = secondaryGender === 'female'
      ? resources.femaleLoras.map(l => ({ filename: l.filename, strengthModel: l.strengthModel, strengthClip: l.strengthClip }))
      : secondaryGender === 'male'
        ? resources.maleLoras.map(l => ({ filename: l.filename, strengthModel: l.strengthModel, strengthClip: l.strengthClip }))
        : [];

    // 13. Build the workflow
    const filenamePrefix = `debug_${promptId.slice(0, 8)}`;
    const characterLoras = [primaryCharLora, secondaryCharLora]
      .filter((l): l is CharacterLoraEntry => !!l)
      .map(l => ({
        filename: l.filename,
        strengthModel: l.defaultStrength,
        strengthClip: l.clipStrength,
      }));

    const workflow = buildWorkflow({
      type: 'multi-pass',
      positivePrompt: finalPrompt,
      width: dimensions.width,
      height: dimensions.height,
      seed,
      filenamePrefix,
      primaryFacePrompt,
      secondaryFacePrompt,
      secondarySeed,
      loras: resources.neutralLoras,
      negativePromptAdditions: resources.negativePromptAdditions,
      checkpointName: modelSelection.checkpointName,
      cfg: modelSelection.paramOverrides?.cfg,
      scenePrompt: decomposed.scenePrompt,
      primaryIdentityPrompt: decomposed.primaryIdentityPrompt,
      secondaryIdentityPrompt: decomposed.secondaryIdentityPrompt,
      fullPrompt: decomposed.fullPrompt,
      sharedScenePrompt: decomposed.sharedScenePrompt,
      primaryRegionPrompt: decomposed.primaryRegionPrompt,
      secondaryRegionPrompt: decomposed.secondaryRegionPrompt,
      characterLoras,
      primaryGenderLoras,
      secondaryGenderLoras,
      primaryGender,
      secondaryGender,
    });

    // 14. Inject debug SaveImage nodes
    injectDebugSaveNodes(workflow, filenamePrefix, hasSecondary);

    // 15. Build debug pass info metadata
    const debugPasses = buildDebugPassInfo({
      scenePrompt: decomposed.scenePrompt,
      primaryIdentityPrompt: decomposed.primaryIdentityPrompt,
      secondaryIdentityPrompt: decomposed.secondaryIdentityPrompt,
      fullPrompt: decomposed.fullPrompt,
      primaryFacePrompt,
      secondaryFacePrompt,
      seed,
      width: dimensions.width,
      height: dimensions.height,
      filenamePrefix,
      loras: resources.neutralLoras,
      characterLoras,
      primaryGenderLoras,
      secondaryGenderLoras,
      hasDualCharacter: hasSecondary,
      sharedScenePrompt: decomposed.sharedScenePrompt,
      primaryRegionPrompt: decomposed.primaryRegionPrompt,
      secondaryRegionPrompt: decomposed.secondaryRegionPrompt,
    });

    // 16. Submit to RunPod
    const { jobId } = await submitRunPodJob(
      workflow,
      undefined, // No IPAdapter reference images for multi-pass
      resources.characterLoraDownloads,
    );

    // 17. Store debug data in the database
    const debugData = {
      jobId: `runpod-${jobId}`,
      generatedAt: new Date().toISOString(),
      seed,
      dimensions: { width: dimensions.width, height: dimensions.height, name: dimensions.name },
      mode,
      imageType: imgPrompt.image_type,
      characters: characters.map(c => ({
        name: c.name,
        gender: c.gender,
        role: c.role,
      })),
      prompts: {
        rawScene: imgPrompt.prompt,
        assembled: assembledPrompt,
        optimizedFull: finalPrompt,
        decomposed: {
          original: {
            scenePrompt: originalDecomposed.scenePrompt,
            primaryIdentityPrompt: originalDecomposed.primaryIdentityPrompt,
            secondaryIdentityPrompt: originalDecomposed.secondaryIdentityPrompt || null,
            fullPrompt: originalDecomposed.fullPrompt,
          },
          optimized: {
            scenePrompt: decomposed.scenePrompt,
            primaryIdentityPrompt: decomposed.primaryIdentityPrompt,
            secondaryIdentityPrompt: decomposed.secondaryIdentityPrompt || null,
            fullPrompt: decomposed.fullPrompt,
          },
        },
        facePrompts: {
          primary: primaryFacePrompt,
          secondary: secondaryFacePrompt || null,
        },
        regional: {
          shared: decomposed.sharedScenePrompt || null,
          primaryRegion: decomposed.primaryRegionPrompt || null,
          secondaryRegion: decomposed.secondaryRegionPrompt || null,
        },
      },
      optimization: {
        wasOptimized: optimizationApplied,
        notes: optimizationNotes,
        durationMs: optimizationDurationMs,
      },
      classification,
      resources: {
        loras: resources.neutralLoras.map(l => `${l.filename} (${l.strengthModel})`),
        characterLoras: characterLoras.map(l => `${l.filename} (${l.strengthModel})`),
        negativeAdditions: resources.negativePromptAdditions,
      },
      passes: debugPasses,
      intermediateImages: {} as Record<string, string>,
    };

    await supabase
      .from("story_image_prompts")
      .update({ debug_data: debugData, status: "generating" } as any)
      .eq("id", promptId);

    // 18. Create generation job record for status polling
    // Create a temporary image record to track the debug job
    const { data: imageRow } = await supabase
      .from("images")
      .insert({
        character_id: imgPrompt.character_id || null,
        prompt: imgPrompt.prompt,
        negative_prompt: "auto",
        settings: {
          width: dimensions.width,
          height: dimensions.height,
          steps: 30,
          cfg: 7,
          seed,
          engine: "runpod-comfyui",
          workflowType: "multi-pass",
          debugMode: true,
        },
        mode,
      })
      .select("id")
      .single();

    if (imageRow) {
      await supabase.from("generation_jobs").insert({
        job_id: `runpod-${jobId}`,
        image_id: imageRow.id,
        status: "pending",
        cost: 0,
      });

      // Link image to prompt for status tracking
      await supabase
        .from("story_image_prompts")
        .update({ image_id: imageRow.id })
        .eq("id", promptId);
    }

    console.log(`[DebugGen][${promptId}] Submitted debug job ${jobId} with ${debugPasses.length} debug passes`);

    return NextResponse.json({
      jobId: `runpod-${jobId}`,
      debugPasses: debugPasses.length,
      optimizationApplied,
      optimizationNotes,
    });
  } catch (err) {
    console.error("[DebugGen] Error:", err);
    return NextResponse.json(
      {
        error: "Debug generation failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
