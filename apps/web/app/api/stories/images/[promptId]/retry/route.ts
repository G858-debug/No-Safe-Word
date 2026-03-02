import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { extractCharacterTags, buildStoryImagePrompt, buildFacePrompt, replaceTagsAge } from "@no-safe-word/image-gen";
import { submitRunPodJob, imageUrlToBase64, buildWorkflow, buildKontextWorkflow, classifyScene, selectResources, selectModel, selectDimensionsFromPrompt, buildCharacterLoraEntry, decomposePrompt, optimizePrompts, shouldOptimize } from "@no-safe-word/image-gen";
import type { ImageType, CharacterLoraEntry, DecomposedPrompt, CharacterContext, KontextWorkflowType } from "@no-safe-word/image-gen";
import type { CharacterData, ImageEngine } from "@no-safe-word/shared";

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
    let secDesc: Record<string, string> | undefined;

    const { data: post } = await supabase
      .from("story_posts")
      .select("series_id")
      .eq("id", imgPrompt.post_id)
      .single();

    // Fetch image engine from series
    let imageEngine: ImageEngine = "sdxl";
    if (post) {
      const { data: seriesRecord } = await supabase
        .from("story_series")
        .select("image_engine")
        .eq("id", post.series_id)
        .single();
      imageEngine = (seriesRecord as any)?.image_engine || "sdxl";
    }

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
          if (charData.age) {
            approvedCharacterTags = replaceTagsAge(approvedCharacterTags, charData.age);
          }
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
          secDesc = secChar?.description as Record<string, string> | undefined;
          if (secDesc) {
            secondaryGender = secDesc.gender as 'male' | 'female' | undefined;
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

    // ====== KONTEXT ENGINE PATH ======
    if (imageEngine === "kontext") {
      const kontextType: KontextWorkflowType = !imgPrompt.character_id
        ? "portrait"
        : hasSecondary
          ? "dual"
          : "single";

      const sfwMode = imgPrompt.image_type !== "website_nsfw_paired";
      const kontextImages: Array<{ name: string; image: string }> = [];

      if (kontextType !== "portrait" && imgPrompt.character_id && post) {
        const { data: sc } = await supabase
          .from("story_characters")
          .select("approved_image_id")
          .eq("series_id", post.series_id)
          .eq("character_id", imgPrompt.character_id)
          .single();

        if (sc?.approved_image_id) {
          const { data: img } = await supabase
            .from("images")
            .select("stored_url")
            .eq("id", sc.approved_image_id)
            .single();

          if (img?.stored_url) {
            try {
              kontextImages.push({ name: "primary_ref.png", image: await imageUrlToBase64(img.stored_url) });
            } catch (err) {
              console.warn(`[Kontext][${promptId}] Failed to fetch primary ref image, proceeding without it:`, err instanceof Error ? err.message : err);
            }
          }
        }
      }

      if (kontextType === "dual" && imgPrompt.secondary_character_id && post) {
        const { data: sc2 } = await supabase
          .from("story_characters")
          .select("approved_image_id")
          .eq("series_id", post.series_id)
          .eq("character_id", imgPrompt.secondary_character_id)
          .single();

        if (sc2?.approved_image_id) {
          const { data: img2 } = await supabase
            .from("images")
            .select("stored_url")
            .eq("id", sc2.approved_image_id)
            .single();

          if (img2?.stored_url) {
            try {
              kontextImages.push({ name: "secondary_ref.png", image: await imageUrlToBase64(img2.stored_url) });
            } catch (err) {
              console.warn(`[Kontext][${promptId}] Failed to fetch secondary ref image, proceeding without it:`, err instanceof Error ? err.message : err);
            }
          }
        }
      }

      const isLandscape = /\b(wide|establishing|panoram)/i.test(imgPrompt.prompt);
      const kontextWidth = isLandscape ? 1216 : 832;
      const kontextHeight = isLandscape ? 832 : 1216;

      const kontextWorkflow = buildKontextWorkflow({
        type: kontextType,
        positivePrompt: imgPrompt.prompt,
        width: kontextWidth,
        height: kontextHeight,
        seed: newSeed,
        filenamePrefix: `kontext_${imgPrompt.id.substring(0, 8)}`,
        sfwMode,
        primaryRefImageName: kontextType !== "portrait" ? "primary_ref.png" : undefined,
        secondaryRefImageName: kontextType === "dual" ? "secondary_ref.png" : undefined,
      });

      const { jobId: runpodJobId } = await submitRunPodJob(
        kontextWorkflow,
        kontextImages.length > 0 ? kontextImages : undefined,
      );

      const newJobId = `runpod-${runpodJobId}`;

      await supabase
        .from("generation_jobs")
        .update({ job_id: newJobId, status: "pending", completed_at: null })
        .eq("job_id", oldJobId);

      console.log(`[Retry/Kontext][${promptId}] Resubmitted with seed ${newSeed}, new job: ${newJobId}`);

      return NextResponse.json({ jobId: newJobId, seed: newSeed });
    }

    // ====== SDXL ENGINE PATH (existing, unchanged) ======

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
    let originalDecomposed: DecomposedPrompt | undefined;
    if (workflowType === 'multi-pass') {
      decomposed = decomposePrompt(finalPrompt, approvedCharacterTags, secondaryCharacterTags);
      originalDecomposed = { ...decomposed };
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
          try {
            const primaryRefBase64 = await imageUrlToBase64(refImg.stored_url);
            refImages.push({ name: "primary_ref.png", image: primaryRefBase64 });
          } catch (err) {
            console.warn(`[StoryImage][${promptId}] Failed to fetch primary ref image for SDXL, proceeding without it:`, err instanceof Error ? err.message : err);
          }
        }
      }
    }

    if (imgPrompt.character_id && needsFacePrompt) {
      primaryFacePrompt = buildFacePrompt(
        approvedCharacterTags,
        charData,
        primaryCharLora?.triggerWord || 'tok',
        hasSecondary,
      );
    }

    let secondaryFacePrompt: string | undefined;
    let secondarySeed: number | undefined;

    if (hasSecondary && imgPrompt.secondary_character_id) {
      secondaryFacePrompt = buildFacePrompt(
        secondaryCharacterTags,
        { hairStyle: secDesc?.hairStyle || '', hairColor: secDesc?.hairColor || '', gender: secondaryGender || 'female' },
        secondaryCharLora?.triggerWord || 'tok',
        hasSecondary,
      );
      secondarySeed = newSeed + 1000;
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
      hasDualCharacter: hasSecondary,
      fallbackSecondaryIdentityPrompt: originalDecomposed?.secondaryIdentityPrompt,
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
