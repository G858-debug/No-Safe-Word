import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { extractCharacterTags, buildStoryImagePrompt, replaceTagsAge } from "@no-safe-word/image-gen";
import { submitRunPodJob, imageUrlToBase64, buildWorkflow, classifyScene, selectResources, selectModel, selectDimensionsFromPrompt, decomposePrompt } from "@no-safe-word/image-gen";
import { augmentComposition, buildCharacterLoraEntry } from "@no-safe-word/image-gen";
import type { ImageType, CharacterLoraEntry, DecomposedPrompt } from "@no-safe-word/image-gen";
import type { CharacterData } from "@no-safe-word/shared";

interface QueuedJob {
  promptId: string;
  jobId: string;
}

interface FailedJob {
  promptId: string;
  error: string;
}

// POST /api/stories/[seriesId]/generate-images — Batch generate story images
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const params = await props.params;
  const { seriesId } = params;

  try {
    const body = await request.json().catch(() => ({}));
    const { post_id, regenerate } = body as { post_id?: string; regenerate?: boolean };

    // 1. Verify all characters in the series are approved
    // Note: active_lora_id is not in auto-generated types yet, so we cast
    const { data: storyChars, error: charsError } = await (supabase as any)
      .from("story_characters")
      .select("id, character_id, approved, approved_seed, approved_prompt, active_lora_id")
      .eq("series_id", seriesId) as {
        data: Array<{
          id: string;
          character_id: string;
          approved: boolean;
          approved_seed: number | null;
          approved_prompt: string | null;
          active_lora_id: string | null;
        }> | null;
        error: any;
      };

    if (charsError) {
      return NextResponse.json({ error: charsError.message }, { status: 500 });
    }

    if (!storyChars || storyChars.length === 0) {
      return NextResponse.json(
        { error: "No characters found for this series" },
        { status: 400 }
      );
    }

    const unapproved = storyChars.filter((sc) => !sc.approved);
    if (unapproved.length > 0) {
      return NextResponse.json(
        {
          error:
            "All characters must be approved before generating story images",
          unapproved_count: unapproved.length,
        },
        { status: 400 }
      );
    }

    // Build character_id → approved_seed and character_id → approved character tags maps
    const seedMap = new Map<string, number | null>();
    const approvedTagsMap = new Map<string, string>();
    const loraIdMap = new Map<string, string>(); // character_id → active_lora_id
    storyChars.forEach((sc) => {
      seedMap.set(sc.character_id, sc.approved_seed);
      if (sc.active_lora_id) {
        loraIdMap.set(sc.character_id, sc.active_lora_id);
      }
      if (sc.approved_prompt) {
        const tags = extractCharacterTags(sc.approved_prompt);
        if (tags) approvedTagsMap.set(sc.character_id, tags);
        console.log(`[StoryImage] Using approved_prompt tags for character ${sc.character_id}:`, tags);
      } else {
        console.warn(`[StoryImage] No approved_prompt for character ${sc.character_id} — falling back to character description. Re-approve the character portrait to save the prompt.`);
      }
    });

    // 2. Find target posts
    let postIds: string[];
    if (post_id) {
      // Verify the post belongs to this series
      const { data: post } = await supabase
        .from("story_posts")
        .select("id")
        .eq("id", post_id)
        .eq("series_id", seriesId)
        .single();

      if (!post) {
        return NextResponse.json(
          { error: "Post not found in this series" },
          { status: 404 }
        );
      }
      postIds = [post_id];
    } else {
      const { data: posts } = await supabase
        .from("story_posts")
        .select("id")
        .eq("series_id", seriesId);

      postIds = (posts || []).map((p) => p.id);
    }

    if (postIds.length === 0) {
      return NextResponse.json({ queued: 0, skipped: 0, jobs: [] });
    }

    // 3a. If regenerate flag is set, reset "generated" prompts back to "pending"
    //     so they get picked up by the batch generation below.
    if (regenerate) {
      await supabase
        .from("story_image_prompts")
        .update({ status: "pending", image_id: null })
        .in("post_id", postIds)
        .eq("status", "generated");
    }

    // 3. Fetch pending/stuck image prompts for those posts
    //    Include "generating" and "failed" so stuck prompts from previous attempts get retried
    const { data: prompts, error: promptsError } = await supabase
      .from("story_image_prompts")
      .select("id, post_id, image_type, position, character_name, character_id, secondary_character_name, secondary_character_id, prompt")
      .in("post_id", postIds)
      .in("status", ["pending", "generating", "failed"]);

    if (promptsError) {
      return NextResponse.json(
        { error: promptsError.message },
        { status: 500 }
      );
    }

    if (!prompts || prompts.length === 0) {
      return NextResponse.json({ queued: 0, skipped: 0, jobs: [] });
    }

    // 4. Pre-fetch all linked characters (primary + secondary) for building CharacterData
    const characterIds = Array.from(
      new Set(
        prompts
          .flatMap((p) => [p.character_id, p.secondary_character_id])
          .filter((id): id is string => id !== null)
      )
    );

    const characterDataMap = new Map<string, CharacterData>();
    if (characterIds.length > 0) {
      const { data: characters } = await supabase
        .from("characters")
        .select("id, name, description")
        .in("id", characterIds);

      if (characters) {
        for (const char of characters) {
          const desc = char.description as Record<string, string>;
          const resolvedGender = (['male', 'female', 'non-binary', 'other'].includes(desc.gender) ? desc.gender : 'female') as CharacterData["gender"];
          if (!desc.gender || desc.gender !== resolvedGender) {
            console.warn(`[StoryImage] Character ${char.name} (${char.id}): desc.gender=${JSON.stringify(desc.gender)}, resolved to "${resolvedGender}"`);
          } else {
            console.log(`[StoryImage] Character ${char.name} (${char.id}): gender="${resolvedGender}"`);
          }
          characterDataMap.set(char.id, {
            name: char.name,
            gender: resolvedGender,
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
          });
        }
      }
    }

    // Safeguard: correct ages in approved tags using canonical character data.
    // The approved_prompt may contain a manually-edited age that differs from
    // the character's actual age in the database.
    approvedTagsMap.forEach((tags, charId) => {
      const charData = characterDataMap.get(charId);
      if (charData?.age) {
        const corrected = replaceTagsAge(tags, charData.age);
        if (corrected !== tags) {
          console.warn(`[StoryImage] Age mismatch in approved tags for character ${charId}. Corrected to "${charData.age}".`);
          approvedTagsMap.set(charId, corrected);
        }
      }
    });

    // Build character_id → CharacterLoraEntry map for deployed LoRAs
    const characterLoraMap = new Map<string, CharacterLoraEntry>();
    if (loraIdMap.size > 0) {
      const loraIds = Array.from(loraIdMap.values());
      const { data: loraRecords } = await (supabase as any)
        .from("character_loras")
        .select("id, character_id, filename, trigger_word, storage_url")
        .in("id", loraIds)
        .eq("status", "deployed") as {
          data: Array<{
            id: string;
            character_id: string;
            filename: string;
            trigger_word: string;
            storage_url: string | null;
          }> | null;
        };

      if (loraRecords) {
        for (const lora of loraRecords) {
          if (!lora.storage_url) continue;
          const charData = characterDataMap.get(lora.character_id);
          const charName = charData?.name || "Unknown";
          characterLoraMap.set(
            lora.character_id,
            buildCharacterLoraEntry({
              character_id: lora.character_id,
              character_name: charName,
              filename: lora.filename,
              trigger_word: lora.trigger_word,
              storage_url: lora.storage_url,
            })
          );
          console.log(`[StoryImage] Character LoRA active for ${charName}: ${lora.filename}`);
        }
      }
    }

    // Empty character for prompts not linked to a character
    const emptyCharacter: CharacterData = {
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

    // 5. Generate each image sequentially with delays
    const jobs: QueuedJob[] = [];
    const failed: FailedJob[] = [];
    let skipped = 0;

    for (let i = 0; i < prompts.length; i++) {
      const imgPrompt = prompts[i];
      try {
        // Mark as generating
        await supabase
          .from("story_image_prompts")
          .update({ status: "generating" })
          .eq("id", imgPrompt.id);

        // Determine mode based on image_type
        const isNsfw = imgPrompt.image_type === "website_nsfw_paired";
        const mode: "sfw" | "nsfw" = isNsfw ? "nsfw" : "sfw";

        // Get character data and seed
        const charData = imgPrompt.character_id
          ? characterDataMap.get(imgPrompt.character_id) || emptyCharacter
          : emptyCharacter;

        // Calculate seed: approved_seed + position for consistency, or random
        let seed = -1;
        if (imgPrompt.character_id) {
          const approvedSeed = seedMap.get(imgPrompt.character_id);
          if (approvedSeed != null && approvedSeed > 0) {
            seed = approvedSeed + imgPrompt.position;
          }
        }
        if (seed === -1) {
          seed = Math.floor(Math.random() * 2_147_483_647) + 1;
        }

        // Build prompt using approved character tags for consistency
        const primaryTags = imgPrompt.character_id
          ? approvedTagsMap.get(imgPrompt.character_id) || null
          : null;
        const secondaryTags = imgPrompt.secondary_character_id
          ? approvedTagsMap.get(imgPrompt.secondary_character_id) || null
          : null;

        const hasSecondary = !!imgPrompt.secondary_character_id;

        // Composition intelligence: augment dual-character scenes with spatial cues
        let scenePromptForBuild = imgPrompt.prompt;
        if (hasSecondary) {
          const preClassification = classifyScene(imgPrompt.prompt, imgPrompt.image_type as ImageType);
          const compositionResult = augmentComposition(imgPrompt.prompt, preClassification);
          if (compositionResult.wasAugmented) {
            scenePromptForBuild = compositionResult.augmentedPrompt;
            console.log(`[StoryImage][${imgPrompt.id}] Composition augmented: +${compositionResult.injectedCues.join(', ')}`);
          }
        }

        // Look up character LoRAs (needed for trigger word injection into prompt and workflow selection)
        const primaryCharLora = imgPrompt.character_id ? characterLoraMap.get(imgPrompt.character_id) : undefined;
        const secondaryCharLora = imgPrompt.secondary_character_id ? characterLoraMap.get(imgPrompt.secondary_character_id) : undefined;

        // Extract trigger words from character LoRAs for prompt injection
        const triggerWords = [primaryCharLora, secondaryCharLora]
          .filter((l): l is CharacterLoraEntry => !!l)
          .map(l => l.triggerWord)
          .filter((tw): tw is string => !!tw);

        const promptOverride = (primaryTags || secondaryTags)
          ? buildStoryImagePrompt(primaryTags, secondaryTags, scenePromptForBuild, mode, triggerWords)
          : undefined;

        // Diagnostic logging — trace the prompt pipeline
        console.log(`[StoryImage][${imgPrompt.id}] Raw scene prompt:`, imgPrompt.prompt.substring(0, 120));
        console.log(`[StoryImage][${imgPrompt.id}] character_id: ${imgPrompt.character_id}, secondary_character_id: ${imgPrompt.secondary_character_id}`);
        console.log(`[StoryImage][${imgPrompt.id}] Primary tags: ${primaryTags ? primaryTags.substring(0, 120) : 'NULL (no approved_prompt)'}`);
        console.log(`[StoryImage][${imgPrompt.id}] Secondary tags: ${secondaryTags ? secondaryTags.substring(0, 120) : 'NULL'}`);
        console.log(`[StoryImage][${imgPrompt.id}] promptOverride: ${promptOverride ? 'YES — using buildStoryImagePrompt' : 'NO — falling back to buildPrompt(charData, scene)'}`);
        if (promptOverride) {
          console.log(`[StoryImage][${imgPrompt.id}] Final prompt:`, promptOverride.substring(0, 200));
        }
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
          console.log(`[StoryImage][${imgPrompt.id}] Using multi-pass workflow (primaryLoRA=${primaryHasLora}, secondaryLoRA=${secondaryHasLora}, hasSecondary=${hasSecondary})`);
        } else if (hasSecondary) {
          // Dual-character but primary has no LoRA — use IPAdapter-based dual workflow
          workflowType = "dual-character";
          console.log(`[StoryImage][${imgPrompt.id}] Dual-character scene: using dual-character workflow (IPAdapter, no primary LoRA)`);
        } else {
          // Single character, no LoRA — IPAdapter fallback
          workflowType = "single-character";
          console.log(`[StoryImage][${imgPrompt.id}] Single-character scene: using single-character workflow (IPAdapter, no LoRA)`);
        }

        // Fetch primary character's approved portrait as base64 for IPAdapter
        // For dual-character scenes: ALWAYS fetch, even with LoRAs — IPAdapter provides
        // face-specific anchoring while LoRAs handle general identity in base generation.
        // Only skip for portrait workflow (single char with LoRA, or no character).
        const images: Array<{ name: string; image: string }> = [];
        let primaryFacePrompt: string | undefined;
        const needsIPAdapter = workflowType !== "portrait" && workflowType !== "multi-pass";
        const needsFacePrompt = needsIPAdapter || workflowType === "multi-pass";

        if (imgPrompt.character_id && needsIPAdapter) {
          const { data: sc } = await supabase
            .from("story_characters")
            .select("approved_image_id")
            .eq("series_id", seriesId)
            .eq("character_id", imgPrompt.character_id)
            .single();

          if (sc?.approved_image_id) {
            const { data: img } = await supabase
              .from("images")
              .select("stored_url")
              .eq("id", sc.approved_image_id)
              .single();

            if (img?.stored_url) {
              const primaryRefBase64 = await imageUrlToBase64(img.stored_url);
              images.push({ name: "primary_ref.png", image: primaryRefBase64 });
            }
          }
        }

        // Build face prompt from approved tags or character data
        // Needed for IPAdapter workflows AND multi-pass (Pass 4 FaceDetailer)
        if (imgPrompt.character_id && needsFacePrompt) {
          primaryFacePrompt = primaryTags ||
            `portrait of ${charData.name}, ${charData.ethnicity}, ${charData.skinTone} skin, ${charData.hairStyle} ${charData.hairColor} hair, ${charData.eyeColor} eyes, photorealistic`;
        }

        // Build secondary face prompt for dual-character scenes
        let secondaryFacePrompt: string | undefined;
        let secondarySeed: number | undefined;

        if (hasSecondary && imgPrompt.secondary_character_id) {
          const secondaryCharData = characterDataMap.get(imgPrompt.secondary_character_id);
          secondaryFacePrompt = secondaryTags || (secondaryCharData
            ? `portrait of ${secondaryCharData.name}, ${secondaryCharData.ethnicity}, ${secondaryCharData.skinTone} skin, ${secondaryCharData.hairStyle} ${secondaryCharData.hairColor} hair, photorealistic`
            : "person, photorealistic");

          const secondaryApprovedSeed = seedMap.get(imgPrompt.secondary_character_id);
          secondarySeed = secondaryApprovedSeed ? secondaryApprovedSeed + imgPrompt.position : seed + 1000;
        }

        // Prepend LoRA trigger word to face prompts so FaceDetailer activates the LoRA
        if (primaryCharLora && primaryFacePrompt) {
          primaryFacePrompt = `${primaryCharLora.triggerWord || 'tok'}, ${primaryFacePrompt}`;
        }
        if (secondaryCharLora && secondaryFacePrompt) {
          secondaryFacePrompt = `${secondaryCharLora.triggerWord || 'tok'}, ${secondaryFacePrompt}`;
        }

        // Use promptOverride if available, otherwise raw prompt
        const finalPrompt = promptOverride || imgPrompt.prompt;

        // Scene intelligence: classify scene for dimensions and resources
        const classification = classifyScene(finalPrompt, imgPrompt.image_type as ImageType);

        // Multi-pass prompt decomposition
        let decomposed: DecomposedPrompt | undefined;
        if (workflowType === 'multi-pass') {
          decomposed = decomposePrompt(finalPrompt, primaryTags, secondaryTags);
          console.log(`[StoryImage][${imgPrompt.id}] Multi-pass decomposition:`);
          console.log(`[StoryImage][${imgPrompt.id}]   scenePrompt: ${decomposed.scenePrompt.substring(0, 150)}`);
          console.log(`[StoryImage][${imgPrompt.id}]   primaryIdentity: ${decomposed.primaryIdentityPrompt.substring(0, 100)}`);
          if (decomposed.secondaryIdentityPrompt) {
            console.log(`[StoryImage][${imgPrompt.id}]   secondaryIdentity: ${decomposed.secondaryIdentityPrompt.substring(0, 100)}`);
          }
        }

        // Scene-aware dimension selection
        const dimensions = selectDimensionsFromPrompt(classification, imgPrompt.image_type as ImageType, hasSecondary, finalPrompt);
        const width = dimensions.width;
        const height = dimensions.height;
        console.log(`[StoryImage] Dimensions: ${dimensions.name} (${width}x${height})`);
        const resources = selectResources(classification, primaryCharLora, secondaryCharLora, finalPrompt, imgPrompt.image_type as ImageType);

        console.log(`[StoryImage][${imgPrompt.id}] Scene classification:`, JSON.stringify(classification));
        console.log(`[StoryImage][${imgPrompt.id}] Selected LoRAs: ${resources.loras.map(l => l.filename).join(', ')}`);
        if (primaryCharLora) {
          console.log(`[StoryImage][${imgPrompt.id}] Character LoRA injected: ${primaryCharLora.filename}`);
        }
        if (secondaryCharLora) {
          console.log(`[StoryImage][${imgPrompt.id}] Secondary character LoRA injected: ${secondaryCharLora.filename}`);
        }

        const modelSelection = selectModel(classification, imgPrompt.image_type as ImageType, {
          contentLevel: classification.contentLevel,
        });
        console.log(`[StoryImage][${imgPrompt.id}] Model selected: ${modelSelection.checkpointName} — ${modelSelection.reason}`);

        // Build per-character gender LoRA stacks for multi-pass person inpainting
        const primaryGender = charData?.gender as 'male' | 'female' | undefined;
        const secondaryCharData = imgPrompt.secondary_character_id
          ? characterDataMap.get(imgPrompt.secondary_character_id)
          : undefined;
        const secondaryGender = secondaryCharData?.gender as 'male' | 'female' | undefined;

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
          console.log(`[StoryImage][${imgPrompt.id}] Pass 3 neutral LoRAs: ${resources.neutralLoras.map(l => l.filename).join(', ')}`);
          console.log(`[StoryImage][${imgPrompt.id}] Pass 4a gender LoRAs (${primaryGender}): ${primaryGenderLoras.map(l => l.filename).join(', ') || 'none'}`);
          if (hasSecondary) {
            console.log(`[StoryImage][${imgPrompt.id}] Pass 4b gender LoRAs (${secondaryGender}): ${secondaryGenderLoras.map(l => l.filename).join(', ') || 'none'}`);
          }
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
          negativePromptAdditions: resources.negativePromptAdditions,
          checkpointName: modelSelection.checkpointName,
          cfg: modelSelection.paramOverrides?.cfg,
          hiresFixEnabled: resources.paramOverrides?.hiresFixEnabled ?? true,
          // Multi-pass specific fields
          scenePrompt: decomposed?.scenePrompt,
          primaryIdentityPrompt: decomposed?.primaryIdentityPrompt,
          secondaryIdentityPrompt: decomposed?.secondaryIdentityPrompt,
          fullPrompt: decomposed?.fullPrompt,
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
        console.log(`[MultiPass][${imgPrompt.id}] Workflow summary: ${wfNodes.length} nodes, type=${workflowType}`);
        for (const [pass, nodes] of Object.entries(nodesByPass).sort()) {
          console.log(`[MultiPass][${imgPrompt.id}]   ${pass}: ${nodes.join(', ')}`);
        }

        // Log character LoRA downloads being sent to RunPod
        if (resources.characterLoraDownloads && resources.characterLoraDownloads.length > 0) {
          console.log(`[MultiPass][${imgPrompt.id}] Character LoRA downloads for RunPod worker:`);
          for (const dl of resources.characterLoraDownloads) {
            console.log(`[MultiPass][${imgPrompt.id}]   ${dl.filename} → ${dl.url.substring(0, 100)}...`);
          }
        } else {
          console.warn(`[MultiPass][${imgPrompt.id}] WARNING: No character LoRA downloads — worker won't have LoRA files!`);
        }

        // Submit async job to RunPod
        const { jobId } = await submitRunPodJob(workflow, images.length > 0 ? images : undefined, resources.characterLoraDownloads);

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

        // Save RunPod job with 'runpod-' prefix
        await supabase.from("generation_jobs").insert({
          job_id: `runpod-${jobId}`,
          image_id: imageRow.id,
          status: "pending",
          cost: 0,
        });

        // Link image to the prompt row
        await supabase
          .from("story_image_prompts")
          .update({ image_id: imageRow.id })
          .eq("id", imgPrompt.id);

        jobs.push({
          promptId: imgPrompt.id,
          jobId: `runpod-${jobId}`,
        });

        // Small delay between RunPod jobs
        if (i < prompts.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (err) {
        // Mark as failed and continue with the rest
        await supabase
          .from("story_image_prompts")
          .update({ status: "failed" })
          .eq("id", imgPrompt.id);

        const message = err instanceof Error ? err.message : "Unknown error";

        console.error(
          `Failed to generate image for prompt ${imgPrompt.id}:`,
          message
        );
        failed.push({ promptId: imgPrompt.id, error: message });

        if (i < prompts.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }

    return NextResponse.json({
      queued: jobs.length,
      skipped,
      failed: failed.length,
      jobs,
      errors: failed.length > 0 ? failed : undefined,
    });
  } catch (err) {
    console.error("Batch image generation failed:", err);
    return NextResponse.json(
      {
        error: "Batch generation failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
