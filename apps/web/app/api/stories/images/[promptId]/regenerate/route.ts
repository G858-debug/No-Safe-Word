import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { extractCharacterTags, buildStoryImagePrompt } from "@no-safe-word/image-gen";
import { submitRunPodJob, imageUrlToBase64, buildWorkflow, classifyScene, selectResources, selectModel, selectDimensionsFromPrompt, buildCharacterLoraEntry, decomposePrompt, optimizePrompts, shouldOptimize } from "@no-safe-word/image-gen";
import type { ImageType, CharacterLoraEntry, DecomposedPrompt, CharacterContext } from "@no-safe-word/image-gen";
import type { CharacterData } from "@no-safe-word/shared";

// POST /api/stories/images/[promptId]/regenerate — Regenerate a single story image
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ promptId: string }> }
) {
  const params = await props.params;
  const { promptId } = params;

  try {
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

    // 2. Clean up old image from storage if it exists
    try {
      if (imgPrompt.image_id) {
        const { data: oldImage } = await supabase
          .from("images")
          .select("stored_url")
          .eq("id", imgPrompt.image_id)
          .single();

        if (oldImage?.stored_url) {
          const urlParts = oldImage.stored_url.split("/story-images/");
          if (urlParts.length === 2) {
            const storagePath = urlParts[1];
            await supabase.storage.from("story-images").remove([storagePath]);
            console.log(`Deleted old story image from storage: ${storagePath}`);
          }
        }
      }
    } catch (err) {
      console.warn("Failed to clean up old story image:", err);
    }

    // 3. Mark as generating
    await supabase
      .from("story_image_prompts")
      .update({ status: "generating" })
      .eq("id", promptId);

    // 4. Look up character data, approved seed, and approved prompt if linked
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

    // Fetch series info via post
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

      // Look up the approved seed, prompt, and active LoRA from story_characters via the post's series
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
          console.log(`[StoryImage] Using approved_prompt tags for character ${imgPrompt.character_id}:`, approvedCharacterTags);
        } else {
          console.warn(`[StoryImage] No approved_prompt for character ${imgPrompt.character_id} — falling back to character description. Re-approve the character portrait to save the prompt.`);
        }

        // Fetch deployed LoRA for primary character
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
            console.log(`[StoryImage] Character LoRA active for ${charData.name}: ${loraRecord.filename}`);
          }
        }

        // Look up secondary character's gender, approved tags, and LoRA if linked
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
            console.log(`[StoryImage] Using approved_prompt tags for secondary character ${imgPrompt.secondary_character_id}:`, secondaryCharacterTags);
          }

          // Fetch deployed LoRA for secondary character
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
              console.log(`[StoryImage] Secondary character LoRA active: ${secLoraRecord.filename}`);
            }
          }
        }
      }
    }

    // 5. Determine mode
    const isNsfw = imgPrompt.image_type === "website_nsfw_paired";
    const mode: "sfw" | "nsfw" = isNsfw ? "nsfw" : "sfw";

    // 6. Build prompt — use approved character tags for consistency with approved portraits
    const triggerWords = [primaryCharLora, secondaryCharLora]
      .filter((l): l is CharacterLoraEntry => !!l)
      .map(l => l.triggerWord)
      .filter((tw): tw is string => !!tw);

    const promptOverride = (approvedCharacterTags || secondaryCharacterTags)
      ? buildStoryImagePrompt(approvedCharacterTags, secondaryCharacterTags, imgPrompt.prompt, mode, triggerWords)
      : undefined;

    // Diagnostic logging
    console.log(`[StoryImage][${promptId}] Raw scene prompt: ${imgPrompt.prompt.substring(0, 200)}`);
    console.log(`[StoryImage][${promptId}] character_id: ${imgPrompt.character_id}, secondary_character_id: ${imgPrompt.secondary_character_id}`);
    console.log(`[StoryImage][${promptId}] Approved tags: ${approvedCharacterTags ? approvedCharacterTags.substring(0, 200) : 'NULL (no approved_prompt)'}`);
    console.log(`[StoryImage][${promptId}] Secondary tags: ${secondaryCharacterTags ? secondaryCharacterTags.substring(0, 120) : 'NULL'}`);
    console.log(`[StoryImage][${promptId}] promptOverride: ${promptOverride ? 'YES — using buildStoryImagePrompt' : 'NO — falling back to raw prompt'}`);
    if (promptOverride) {
      console.log(`[StoryImage][${promptId}] Final prompt: ${promptOverride.substring(0, 200)}`);
    }

    // 7. Generate via RunPod
    // Always use a random seed for regeneration — the whole point of clicking
    // "Regenerate" is to get a different result. The deterministic seed
    // (approved_seed + position) is only for the initial batch generation.
    const seed = Math.floor(Math.random() * 2_147_483_647) + 1;

    const hasSecondary = !!imgPrompt.secondary_character_id;

    const primaryHasLora = !!primaryCharLora;
    const secondaryHasLora = !!secondaryCharLora;

    // Multi-pass: any scene where the primary character has a deployed LoRA
    const useMultiPass = !!imgPrompt.character_id && primaryHasLora;

    let workflowType: "portrait" | "single-character" | "dual-character" | "multi-pass";
    if (!imgPrompt.character_id) {
      // No character linked — plain portrait (atmospheric/detail shots)
      workflowType = "portrait";
    } else if (useMultiPass) {
      // Primary character has a LoRA — use multi-pass for best quality
      workflowType = "multi-pass";
      console.log(`[StoryImage][${promptId}] Using multi-pass workflow (primaryLoRA=${primaryHasLora}, secondaryLoRA=${secondaryHasLora}, hasSecondary=${hasSecondary})`);
    } else if (hasSecondary) {
      // Dual-character but primary has no LoRA — use IPAdapter-based dual workflow
      workflowType = "dual-character";
      console.log(`[StoryImage][${promptId}] Dual-character scene: using dual-character workflow (IPAdapter, no primary LoRA)`);
    } else {
      // Single character, no LoRA — IPAdapter fallback
      workflowType = "single-character";
      console.log(`[StoryImage][${promptId}] Single-character scene: using single-character workflow (IPAdapter, no LoRA)`);
    }

    // Fetch primary character's approved portrait as base64 for IPAdapter
    // For dual-character scenes: ALWAYS fetch, even with LoRAs — IPAdapter provides
    // face-specific anchoring while LoRAs handle general identity in base generation.
    // Only skip for portrait workflow (single char with LoRA, or no character).
    const refImages: Array<{ name: string; image: string }> = [];
    let primaryFacePrompt: string | undefined;
    const needsIPAdapter = workflowType !== "portrait" && workflowType !== "multi-pass";
    const needsFacePrompt = needsIPAdapter || workflowType === "multi-pass";

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

    // Build face prompt from approved tags or character data
    // Needed for IPAdapter workflows AND multi-pass (Pass 4 FaceDetailer)
    if (imgPrompt.character_id && needsFacePrompt) {
      primaryFacePrompt = approvedCharacterTags ||
        `portrait of ${charData.name}, ${charData.ethnicity}, ${charData.skinTone} skin, ${charData.hairStyle} ${charData.hairColor} hair, ${charData.eyeColor} eyes, photorealistic`;
    }

    // Build secondary face prompt for dual-character scenes
    let secondaryFacePrompt: string | undefined;
    let secondarySeed: number | undefined;

    if (hasSecondary && imgPrompt.secondary_character_id) {
      secondaryFacePrompt = secondaryCharacterTags || "person, photorealistic";
      secondarySeed = seed + 1000;
    }

    // Prepend LoRA trigger word to face prompts so FaceDetailer activates the LoRA
    if (primaryCharLora && primaryFacePrompt) {
      primaryFacePrompt = `${primaryCharLora.triggerWord || 'tok'}, ${primaryFacePrompt}`;
    }
    if (secondaryCharLora && secondaryFacePrompt) {
      secondaryFacePrompt = `${secondaryCharLora.triggerWord || 'tok'}, ${secondaryFacePrompt}`;
    }

    let finalPrompt = promptOverride || imgPrompt.prompt;

    // Scene intelligence: classify scene for dimensions and resources
    const classification = classifyScene(finalPrompt, imgPrompt.image_type as ImageType);

    // Multi-pass prompt decomposition
    let decomposed: DecomposedPrompt | undefined;
    if (workflowType === 'multi-pass') {
      decomposed = decomposePrompt(finalPrompt, approvedCharacterTags, secondaryCharacterTags);
      console.log(`[StoryImage][${promptId}] Multi-pass decomposition:`);
      console.log(`[StoryImage][${promptId}]   scenePrompt: ${decomposed.scenePrompt.substring(0, 150)}`);
      console.log(`[StoryImage][${promptId}]   primaryIdentity: ${decomposed.primaryIdentityPrompt.substring(0, 100)}`);
      if (decomposed.secondaryIdentityPrompt) {
        console.log(`[StoryImage][${promptId}]   secondaryIdentity: ${decomposed.secondaryIdentityPrompt.substring(0, 100)}`);
      }
    }

    // AI prompt optimization — restructure for optimal SDXL generation
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

    // Select resources early so negative additions can be passed to the AI optimizer
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
          console.log(`[StoryImage][${promptId}] Negative prompt optimized by AI`);
          console.log(`[StoryImage][${promptId}]   negative: ${negativePromptAdditions.substring(0, 150)}`);
        }
        console.log(`[StoryImage][${promptId}] AI prompt optimization applied (${optimized.durationMs}ms): ${optimized.notes.join('; ')}`);
        const d = optimized.optimizedDecomposed;
        console.log(`[Optimizer][${promptId}] Phase1 fullPrompt:`);
        console.log(`  ${optimized.optimizedFullPrompt}`);
        console.log(`[Optimizer][${promptId}] Phase2 scenePrompt:`);
        console.log(`  ${d.scenePrompt}`);
        console.log(`[Optimizer][${promptId}] Phase2 primaryIdentityPrompt:`);
        console.log(`  ${d.primaryIdentityPrompt}`);
        console.log(`[Optimizer][${promptId}] Phase2 secondaryIdentityPrompt:`);
        console.log(`  ${d.secondaryIdentityPrompt ?? 'NULL'}`);
        console.log(`[Optimizer][${promptId}] Phase2 sharedScenePrompt:`);
        console.log(`  ${d.sharedScenePrompt ?? 'NULL'}`);
        console.log(`[Optimizer][${promptId}] Phase2 primaryRegionPrompt:`);
        console.log(`  ${d.primaryRegionPrompt ?? 'NULL'}`);
        console.log(`[Optimizer][${promptId}] Phase2 secondaryRegionPrompt:`);
        console.log(`  ${d.secondaryRegionPrompt ?? 'NULL'}`);
      } else {
        console.log(`[StoryImage][${promptId}] AI prompt optimization skipped: ${optimized.notes.join('; ')}`);
      }
    }

    // Scene-aware dimension selection
    const dimensions = selectDimensionsFromPrompt(classification, imgPrompt.image_type as ImageType, hasSecondary, finalPrompt);
    const width = dimensions.width;
    const height = dimensions.height;
    console.log(`[StoryImage] Dimensions: ${dimensions.name} (${width}x${height})`);

    console.log(`[StoryImage][${promptId}] Scene classification:`, JSON.stringify(classification));
    console.log(`[StoryImage][${promptId}] Selected LoRAs: ${resources.loras.map(l => l.filename).join(', ')}`);
    if (primaryCharLora) {
      console.log(`[StoryImage][${promptId}] Character LoRA injected: ${primaryCharLora.filename}`);
    }
    if (secondaryCharLora) {
      console.log(`[StoryImage][${promptId}] Secondary character LoRA injected: ${secondaryCharLora.filename}`);
    }

    const modelSelection = selectModel(classification, imgPrompt.image_type as ImageType, {
      contentLevel: classification.contentLevel,
    });
    console.log(`[StoryImage][${promptId}] Model selected: ${modelSelection.checkpointName} — ${modelSelection.reason}`);

    // Build per-character gender LoRA stacks for multi-pass person inpainting
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

    if (workflowType === 'multi-pass') {
      console.log(`[StoryImage][${promptId}] Pass 3 neutral LoRAs: ${resources.neutralLoras.map(l => l.filename).join(', ')}`);
      console.log(`[StoryImage][${promptId}] Pass 4a gender LoRAs (${primaryGender}): ${primaryGenderLoras.map(l => l.filename).join(', ') || 'none'}`);
      if (hasSecondary) {
        console.log(`[StoryImage][${promptId}] Pass 4b gender LoRAs (${secondaryGender}): ${secondaryGenderLoras.map(l => l.filename).join(', ') || 'none'}`);
      }
    }

    if (decomposed?.sharedScenePrompt && decomposed?.primaryRegionPrompt && decomposed?.secondaryRegionPrompt) {
      console.log(`[StoryImage][${promptId}] Attention Couple enabled:`);
      console.log(`[StoryImage][${promptId}]   shared: ${decomposed.sharedScenePrompt.substring(0, 100)}`);
      console.log(`[StoryImage][${promptId}]   primaryRegion: ${decomposed.primaryRegionPrompt.substring(0, 100)}`);
      console.log(`[StoryImage][${promptId}]   secondaryRegion: ${decomposed.secondaryRegionPrompt.substring(0, 100)}`);
    }

    const workflow = buildWorkflow({
      type: workflowType,
      positivePrompt: finalPrompt,
      width,
      height,
      seed,
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
      // Multi-pass specific fields
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

    // ---- Workflow structure validation logging ----
    const wfNodes = Object.entries(workflow);
    const nodesByPass: Record<string, string[]> = {};
    for (const [nodeId, node] of wfNodes) {
      const n = Number(nodeId);
      const pass = n < 200 ? 'Pass1-Base' : n < 300 ? 'Pass2-Hires' : n < 400 ? 'Pass3-LoRA' : n < 500 ? 'Pass4-Person' : n < 600 ? 'Pass5-Face' : n < 700 ? 'Pass6-Save' : 'Pass7-Final';
      if (!nodesByPass[pass]) nodesByPass[pass] = [];
      nodesByPass[pass].push(`${nodeId}:${(node as any).class_type}`);
    }
    console.log(`[MultiPass][${promptId}] Workflow summary: ${wfNodes.length} nodes, type=${workflowType}`);
    for (const [pass, nodes] of Object.entries(nodesByPass).sort()) {
      console.log(`[MultiPass][${promptId}]   ${pass}: ${nodes.join(', ')}`);
    }

    const { jobId } = await submitRunPodJob(workflow, refImages.length > 0 ? refImages : undefined, resources.characterLoraDownloads);

    // Create image record
    const { data: imageRow, error: imgError } = await supabase
      .from("images")
      .insert({
        character_id: imgPrompt.character_id || null,
        prompt: imgPrompt.prompt,
        negative_prompt: "auto",
        settings: { width, height, steps: 30, cfg: 7, seed, engine: "runpod-comfyui", workflowType, hiresFix: true },
        mode,
      })
      .select("id")
      .single();

    if (imgError || !imageRow) {
      throw new Error(`Failed to create image record: ${imgError?.message}`);
    }

    await supabase.from("generation_jobs").insert({
      job_id: `runpod-${jobId}`,
      image_id: imageRow.id,
      status: "pending",
      cost: 0,
    });

    // Link new image to the prompt row
    await supabase
      .from("story_image_prompts")
      .update({ image_id: imageRow.id })
      .eq("id", promptId);

    return NextResponse.json({
      jobId: `runpod-${jobId}`,
      imageId: imageRow.id,
    });
  } catch (err) {
    // Mark as failed on error
    await supabase
      .from("story_image_prompts")
      .update({ status: "failed" })
      .eq("id", promptId);

    console.error("Image regeneration failed:", err);
    return NextResponse.json(
      {
        error: "Regeneration failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
