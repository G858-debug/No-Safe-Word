import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { extractCharacterTags, buildStoryImagePrompt, replaceTagsAge } from "@no-safe-word/image-gen";
import { submitRunPodJob, imageUrlToBase64, buildWorkflow, classifyScene, selectResources, selectModel } from "@no-safe-word/image-gen";
import { augmentComposition, buildCharacterLoraEntry } from "@no-safe-word/image-gen";
import type { ImageType, CharacterLoraEntry } from "@no-safe-word/image-gen";
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
    const { post_id } = body as { post_id?: string };

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
          characterDataMap.set(char.id, {
            name: char.name,
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
        // LoRA-first workflow selection:
        // If characters have deployed LoRAs, prefer portrait workflow (no IPAdapter)
        const primaryHasLora = !!primaryCharLora;
        const secondaryHasLora = !!secondaryCharLora;

        let workflowType: "portrait" | "single-character" | "dual-character";
        if (!imgPrompt.character_id) {
          workflowType = "portrait";
        } else if (primaryHasLora && !hasSecondary) {
          // Single character with LoRA → portrait (LoRA handles identity)
          workflowType = "portrait";
          console.log(`[StoryImage][${imgPrompt.id}] LoRA-first: primary has LoRA, using portrait workflow (no IPAdapter)`);
        } else if (hasSecondary) {
          // ANY dual-character scene → always use dual-character workflow
          // Even with LoRAs, we need:
          //   - Spatial composition from the dual-character workflow
          //   - Separate FaceDetailer passes for each face
          //   - IPAdapter reference for at least the primary character
          // LoRAs are still loaded in the chain and help, but dual workflow
          // provides the structural scaffolding for two distinct people.
          workflowType = "dual-character";
          if (primaryHasLora || secondaryHasLora) {
            console.log(`[StoryImage][${imgPrompt.id}] Dual-character scene: using dual-character workflow with LoRAs + IPAdapter for structural composition`);
          }
        } else {
          // Primary has NO LoRA, single character → IPAdapter fallback
          workflowType = "single-character";
        }

        // Fetch primary character's approved portrait as base64 for IPAdapter
        // For dual-character scenes: ALWAYS fetch, even with LoRAs — IPAdapter provides
        // face-specific anchoring while LoRAs handle general identity in base generation.
        // Only skip for portrait workflow (single char with LoRA, or no character).
        const images: Array<{ name: string; image: string }> = [];
        let primaryFacePrompt: string | undefined;
        const needsIPAdapter = workflowType !== "portrait";

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

          // Build face prompt from approved tags or character data
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

        // Determine dimensions
        const promptLower = imgPrompt.prompt.toLowerCase();
        const isLandscape = promptLower.includes("wide") ||
          promptLower.includes("establishing") ||
          promptLower.includes("panoram");
        const width = isLandscape ? 1216 : 832;
        const height = isLandscape ? 832 : 1216;

        // Use promptOverride if available, otherwise raw prompt
        const finalPrompt = promptOverride || imgPrompt.prompt;

        // Scene intelligence: classify scene and select LoRAs
        const classification = classifyScene(finalPrompt, imgPrompt.image_type as ImageType);
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
          loras: resources.loras,
          negativePromptAdditions: resources.negativePromptAdditions,
          checkpointName: modelSelection.checkpointName,
          cfg: modelSelection.paramOverrides?.cfg,
          hiresFixEnabled: resources.paramOverrides?.hiresFixEnabled ?? true,
        });

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
