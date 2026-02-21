import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { extractCharacterTags, buildStoryImagePrompt } from "@no-safe-word/image-gen";
import { submitRunPodJob, imageUrlToBase64, buildWorkflow, classifyScene, selectResources, selectModel } from "@no-safe-word/image-gen";
import type { ImageType } from "@no-safe-word/image-gen";
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

    let seed = -1;
    let approvedCharacterTags: string | null = null;
    let secondaryCharacterTags: string | null = null;

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
      }

      // Look up the approved seed and prompt from story_characters via the post's series
      if (post) {
        const { data: storyChar } = await supabase
          .from("story_characters")
          .select("approved_seed, approved_prompt")
          .eq("series_id", post.series_id)
          .eq("character_id", imgPrompt.character_id)
          .single();

        if (storyChar?.approved_seed != null && storyChar.approved_seed > 0) {
          seed = storyChar.approved_seed + imgPrompt.position;
        }

        if (storyChar?.approved_prompt) {
          approvedCharacterTags = extractCharacterTags(storyChar.approved_prompt);
          console.log(`[StoryImage] Using approved_prompt tags for character ${imgPrompt.character_id}:`, approvedCharacterTags);
        } else {
          console.warn(`[StoryImage] No approved_prompt for character ${imgPrompt.character_id} — falling back to character description. Re-approve the character portrait to save the prompt.`);
        }

        // Look up secondary character's approved tags if linked
        if (imgPrompt.secondary_character_id) {
          const { data: secondaryStoryChar } = await supabase
            .from("story_characters")
            .select("approved_prompt")
            .eq("series_id", post.series_id)
            .eq("character_id", imgPrompt.secondary_character_id)
            .single();

          if (secondaryStoryChar?.approved_prompt) {
            secondaryCharacterTags = extractCharacterTags(secondaryStoryChar.approved_prompt);
            console.log(`[StoryImage] Using approved_prompt tags for secondary character ${imgPrompt.secondary_character_id}:`, secondaryCharacterTags);
          }
        }
      }
    }

    // 5. Determine mode
    const isNsfw = imgPrompt.image_type === "website_nsfw_paired";
    const mode: "sfw" | "nsfw" = isNsfw ? "nsfw" : "sfw";

    // 6. Build prompt — use approved character tags for consistency with approved portraits
    const promptOverride = (approvedCharacterTags || secondaryCharacterTags)
      ? buildStoryImagePrompt(approvedCharacterTags, secondaryCharacterTags, imgPrompt.prompt, mode)
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
    if (seed === -1) {
      seed = Math.floor(Math.random() * 2_147_483_647) + 1;
    }

    const hasSecondary = !!imgPrompt.secondary_character_id;
    const workflowType = imgPrompt.character_id
      ? (hasSecondary ? "dual-character" : "single-character")
      : "portrait";

    // Fetch primary character's approved portrait as base64 for IPAdapter
    const refImages: Array<{ name: string; image: string }> = [];
    let primaryFacePrompt: string | undefined;

    if (imgPrompt.character_id && workflowType !== "portrait" && post) {
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

      primaryFacePrompt = approvedCharacterTags ||
        `portrait of ${charData.name}, ${charData.ethnicity}, ${charData.skinTone} skin, ${charData.hairStyle} ${charData.hairColor} hair, ${charData.eyeColor} eyes, photorealistic`;
    }

    // Build secondary face prompt for dual-character scenes
    let secondaryFacePrompt: string | undefined;
    let secondarySeed: number | undefined;

    if (hasSecondary && imgPrompt.secondary_character_id) {
      secondaryFacePrompt = secondaryCharacterTags || "person, photorealistic";

      if (post) {
        const { data: secStoryChar } = await supabase
          .from("story_characters")
          .select("approved_seed")
          .eq("series_id", post.series_id)
          .eq("character_id", imgPrompt.secondary_character_id)
          .single();
        secondarySeed = secStoryChar?.approved_seed ? secStoryChar.approved_seed + imgPrompt.position : seed + 1000;
      } else {
        secondarySeed = seed + 1000;
      }
    }

    // Determine dimensions
    const promptLower = imgPrompt.prompt.toLowerCase();
    const isLandscape = promptLower.includes("wide") ||
      promptLower.includes("establishing") ||
      promptLower.includes("panoram");
    const width = isLandscape ? 1216 : 832;
    const height = isLandscape ? 832 : 1216;

    const finalPrompt = promptOverride || imgPrompt.prompt;

    // Scene intelligence: classify scene and select LoRAs
    const classification = classifyScene(finalPrompt, imgPrompt.image_type as ImageType);
    const resources = selectResources(classification);

    console.log(`[StoryImage][${promptId}] Scene classification:`, JSON.stringify(classification));
    console.log(`[StoryImage][${promptId}] Selected LoRAs: ${resources.loras.map(l => l.filename).join(', ')}`);

    const modelSelection = selectModel(classification, imgPrompt.image_type as ImageType, {
      contentLevel: classification.contentLevel,
    });
    console.log(`[StoryImage][${promptId}] Model selected: ${modelSelection.checkpointName} — ${modelSelection.reason}`);

    const workflow = buildWorkflow({
      type: workflowType as "portrait" | "single-character" | "dual-character",
      positivePrompt: finalPrompt,
      width,
      height,
      seed,
      filenamePrefix: `story_${imgPrompt.id.substring(0, 8)}`,
      primaryRefImageName: workflowType !== "portrait" ? "primary_ref.png" : undefined,
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

    const { jobId } = await submitRunPodJob(workflow, refImages.length > 0 ? refImages : undefined);

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
