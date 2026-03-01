import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { extractCharacterTags, buildStoryImagePrompt } from "@no-safe-word/image-gen";
import { submitRunPodJob, imageUrlToBase64, buildWorkflow, classifyScene, selectResources, selectModel, selectDimensionsFromPrompt, buildCharacterLoraEntry, decomposePrompt, optimizePrompts, shouldOptimize } from "@no-safe-word/image-gen";
import type { ImageType, CharacterLoraEntry, DecomposedPrompt, CharacterContext } from "@no-safe-word/image-gen";
import type { CharacterData } from "@no-safe-word/shared";

// POST /api/stories/images/[promptId]/retry — Internal retry for failed person validation
// Called by the status route when dual-character validation detects wrong person count.
// Rebuilds the workflow with a new seed and resubmits to RunPod.
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ promptId: string }> }
) {
  const params = await props.params;
  const { promptId } = params;

  try {
    const body = await request.json();
    const { newSeed, jobId: oldJobId } = body as { newSeed: number; jobId: string };

    if (!newSeed || !oldJobId) {
      return NextResponse.json(
        { error: "Missing newSeed or jobId" },
        { status: 400 }
      );
    }

    // 1. Fetch the image prompt
    const { data: imgPrompt, error: fetchError } = await supabase
      .from("story_image_prompts")
      .select("id, post_id, image_type, position, character_name, character_id, secondary_character_name, secondary_character_id, prompt, image_id")
      .eq("id", promptId)
      .single();

    if (fetchError || !imgPrompt) {
      return NextResponse.json(
        { error: "Image prompt not found" },
        { status: 404 }
      );
    }

    // 2. Look up character data, approved tags, and LoRAs
    let charData: CharacterData = {
      name: "",
      gender: "female",
      ethnicity: "",
      bodyType: "",
      hairColor: "",
      hairStyle: "",
      eyeColor: "",
      skinTone: "",
      distinguishingFeatures: "",
      clothing: "",
      pose: "",
      expression: "",
      age: "",
    };

    let approvedCharacterTags: string | null = null;
    let secondaryCharacterTags: string | null = null;
    let primaryCharLora: CharacterLoraEntry | undefined;
    let secondaryCharLora: CharacterLoraEntry | undefined;
    let secondaryGender: 'male' | 'female' | undefined;

    const { data: post } = await supabase
      .from("story_posts")
      .select("series_id")
      .eq("id", imgPrompt.post_id)
      .single();

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
      }

      if (post) {
        const { data: storyChar } = await (supabase as any)
          .from("story_characters")
          .select("approved_prompt, active_lora_id")
          .eq("series_id", post.series_id)
          .eq("character_id", imgPrompt.character_id)
          .single() as {
            data: { approved_prompt: string | null; active_lora_id: string | null } | null;
          };

        if (storyChar?.approved_prompt) {
          approvedCharacterTags = extractCharacterTags(storyChar.approved_prompt);
        }

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
    }

    // 3. Build prompt
    const isNsfw = imgPrompt.image_type === "website_nsfw_paired";
    const mode: "sfw" | "nsfw" = isNsfw ? "nsfw" : "sfw";

    const triggerWords = [primaryCharLora, secondaryCharLora]
      .filter((l): l is CharacterLoraEntry => !!l)
      .map(l => l.triggerWord)
      .filter((tw): tw is string => !!tw);

    const promptOverride = (approvedCharacterTags || secondaryCharacterTags)
      ? buildStoryImagePrompt(approvedCharacterTags, secondaryCharacterTags, imgPrompt.prompt, mode, triggerWords)
      : undefined;

    let finalPrompt = promptOverride || imgPrompt.prompt;

    const hasSecondary = !!imgPrompt.secondary_character_id;
    const primaryHasLora = !!primaryCharLora;

    const useMultiPass = !!imgPrompt.character_id && primaryHasLora;

    let workflowType: "portrait" | "single-character" | "dual-character" | "multi-pass";
    if (!imgPrompt.character_id) {
      workflowType = "portrait";
    } else if (useMultiPass) {
      workflowType = "multi-pass";
    } else if (hasSecondary) {
      workflowType = "dual-character";
    } else {
      workflowType = "single-character";
    }

    // 4. Classify scene and build resources
    const knownCharCount = imgPrompt.secondary_character_id ? 2 : 1;
    const classification = classifyScene(finalPrompt, imgPrompt.image_type as ImageType, knownCharCount);

    // Multi-pass prompt decomposition
    let decomposed: DecomposedPrompt | undefined;
    if (workflowType === 'multi-pass') {
      decomposed = decomposePrompt(finalPrompt, approvedCharacterTags, secondaryCharacterTags);
    }

    // AI prompt optimization
    const characters: CharacterContext[] = [];
    if (imgPrompt.character_id && charData.name) {
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

    const resources = selectResources(classification, primaryCharLora, secondaryCharLora, finalPrompt, imgPrompt.image_type as ImageType, hasSecondary);
    let negativePromptAdditions = resources.negativePromptAdditions;

    if (shouldOptimize(characters, imgPrompt.image_type) && decomposed) {
      const optimized = await optimizePrompts(
        {
          fullPrompt: finalPrompt,
          rawScenePrompt: imgPrompt.prompt,
          characters,
          mode,
          imageType: imgPrompt.image_type as 'facebook_sfw' | 'website_nsfw_paired' | 'website_only' | 'portrait',
          negativePromptAdditions,
        },
        decomposed,
      );
      if (optimized.wasOptimized) {
        finalPrompt = optimized.optimizedFullPrompt;
        decomposed = optimized.optimizedDecomposed;
        if (optimized.optimizedNegativeAdditions !== undefined) {
          negativePromptAdditions = optimized.optimizedNegativeAdditions;
        }
        console.log(`[Retry][${promptId}] AI optimization applied (${optimized.durationMs}ms)`);
      }
    }

    // 5. Build face prompts
    const needsIPAdapter = workflowType !== "portrait" && workflowType !== "multi-pass";
    const needsFacePrompt = needsIPAdapter || workflowType === "multi-pass";

    const refImages: Array<{ name: string; image: string }> = [];
    let primaryFacePrompt: string | undefined;

    if (imgPrompt.character_id && needsIPAdapter && post) {
      const { data: sc } = await supabase
        .from("story_characters")
        .select("approved_image_id")
        .eq("series_id", post.series_id)
        .eq("character_id", imgPrompt.character_id)
        .single();

      if (sc?.approved_image_id) {
        const { data: refImg } = await supabase
          .from("images")
          .select("stored_url")
          .eq("id", sc.approved_image_id)
          .single();

        if (refImg?.stored_url) {
          const primaryRefBase64 = await imageUrlToBase64(refImg.stored_url);
          refImages.push({ name: "primary_ref.png", image: primaryRefBase64 });
        }
      }
    }

    if (imgPrompt.character_id && needsFacePrompt) {
      primaryFacePrompt = approvedCharacterTags ||
        `portrait of ${charData.name}, ${charData.ethnicity}, ${charData.skinTone} skin, ${charData.hairStyle} ${charData.hairColor} hair, ${charData.eyeColor} eyes, photorealistic`;
    }

    let secondaryFacePrompt: string | undefined;
    let secondarySeed: number | undefined;

    if (hasSecondary && imgPrompt.secondary_character_id) {
      secondaryFacePrompt = secondaryCharacterTags || "person, photorealistic";
      secondarySeed = newSeed + 1000;
    }

    if (primaryCharLora && primaryFacePrompt) {
      primaryFacePrompt = `${primaryCharLora.triggerWord || 'tok'}, ${primaryFacePrompt}`;
    }
    if (secondaryCharLora && secondaryFacePrompt) {
      secondaryFacePrompt = `${secondaryCharLora.triggerWord || 'tok'}, ${secondaryFacePrompt}`;
    }

    // 6. Dimensions & model
    const dimensions = selectDimensionsFromPrompt(classification, imgPrompt.image_type as ImageType, hasSecondary, finalPrompt);
    const width = dimensions.width;
    const height = dimensions.height;

    const modelSelection = selectModel(classification, imgPrompt.image_type as ImageType, {
      contentLevel: classification.contentLevel,
    });

    // 7. Build gender LoRA stacks
    const primaryGender = charData?.gender as 'male' | 'female' | undefined;

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

    // 8. Build and submit workflow
    const workflow = buildWorkflow({
      type: workflowType,
      positivePrompt: finalPrompt,
      width,
      height,
      seed: newSeed,
      filenamePrefix: `story_${imgPrompt.id.substring(0, 8)}`,
      primaryRefImageName: needsIPAdapter ? "primary_ref.png" : undefined,
      primaryFacePrompt,
      ipadapterWeight: hasSecondary ? 0.7 : 0.85,
      secondaryFacePrompt,
      secondarySeed,
      loras: workflowType === 'multi-pass' ? resources.neutralLoras : resources.loras,
      negativePromptAdditions,
      checkpointName: modelSelection.checkpointName,
      cfg: modelSelection.paramOverrides?.cfg,
      hiresFixEnabled: resources.paramOverrides?.hiresFixEnabled ?? true,
      scenePrompt: decomposed?.scenePrompt,
      primaryIdentityPrompt: decomposed?.primaryIdentityPrompt,
      secondaryIdentityPrompt: decomposed?.secondaryIdentityPrompt,
      fullPrompt: decomposed?.fullPrompt,
      sharedScenePrompt: decomposed?.sharedScenePrompt,
      primaryRegionPrompt: decomposed?.primaryRegionPrompt,
      secondaryRegionPrompt: decomposed?.secondaryRegionPrompt,
      characterLoras: [primaryCharLora, secondaryCharLora]
        .filter((l): l is CharacterLoraEntry => !!l)
        .map(l => ({
          filename: l.filename,
          strengthModel: l.defaultStrength,
          strengthClip: l.clipStrength,
        })),
      primaryGenderLoras,
      secondaryGenderLoras,
      primaryGender,
      secondaryGender,
    });

    const { jobId: runpodJobId } = await submitRunPodJob(workflow, refImages.length > 0 ? refImages : undefined, resources.characterLoraDownloads);

    const newJobId = `runpod-${runpodJobId}`;

    // 9. Update existing generation_jobs row with new job ID
    await supabase
      .from("generation_jobs")
      .update({
        job_id: newJobId,
        status: "pending",
        completed_at: null,
      })
      .eq("job_id", oldJobId);

    console.log(`[Retry][${promptId}] Resubmitted with seed ${newSeed}, new job: ${newJobId}`);

    return NextResponse.json({
      jobId: newJobId,
      seed: newSeed,
    });
  } catch (err) {
    console.error("[Retry] Failed:", err);
    return NextResponse.json(
      {
        error: "Retry failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
