import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { submitGeneration, CivitaiError } from "@no-safe-word/image-gen";
import { buildNegativePrompt, extractCharacterTags, buildStoryImagePrompt, replaceTagsAge } from "@no-safe-word/image-gen";
import { DEFAULT_SETTINGS } from "@no-safe-word/shared";
import type { CharacterData, SceneData } from "@no-safe-word/shared";

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
    const { post_id, model_urn } = body as { post_id?: string; model_urn?: string };

    // 1. Verify all characters in the series are approved
    const { data: storyChars, error: charsError } = await supabase
      .from("story_characters")
      .select("id, character_id, approved, approved_seed, approved_prompt")
      .eq("series_id", seriesId);

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
    storyChars.forEach((sc) => {
      seedMap.set(sc.character_id, sc.approved_seed);
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

    // 3. Fetch pending image prompts for those posts
    const { data: prompts, error: promptsError } = await supabase
      .from("story_image_prompts")
      .select("id, post_id, image_type, position, character_name, character_id, secondary_character_name, secondary_character_id, prompt")
      .in("post_id", postIds)
      .eq("status", "pending");

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

    // 5. Generate each image sequentially with delays to avoid rate limits
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

        // Build scene with the pre-written prompt as the description
        const scene: SceneData = {
          mode,
          setting: "",
          lighting: "",
          mood: "",
          sfwDescription: isNsfw ? "" : imgPrompt.prompt,
          nsfwDescription: isNsfw ? imgPrompt.prompt : "",
          additionalTags: [],
        };

        // Get character data and seed
        const charData = imgPrompt.character_id
          ? characterDataMap.get(imgPrompt.character_id) || emptyCharacter
          : emptyCharacter;

        // Calculate seed: approved_seed + position for consistency, or -1 for random
        let seed = -1;
        if (imgPrompt.character_id) {
          const approvedSeed = seedMap.get(imgPrompt.character_id);
          if (approvedSeed != null && approvedSeed > 0) {
            seed = approvedSeed + imgPrompt.position;
          }
        }

        const settings = { ...DEFAULT_SETTINGS, seed, batchSize: 1, ...(model_urn ? { modelUrn: model_urn } : {}) };

        // Build prompt using approved character tags for consistency with approved portraits.
        // The scene prompt is cleaned of inline character descriptions to avoid
        // contradicting the authoritative tags from the approved portrait.
        const primaryTags = imgPrompt.character_id
          ? approvedTagsMap.get(imgPrompt.character_id) || null
          : null;
        const secondaryTags = imgPrompt.secondary_character_id
          ? approvedTagsMap.get(imgPrompt.secondary_character_id) || null
          : null;

        const promptOverride = (primaryTags || secondaryTags)
          ? buildStoryImagePrompt(primaryTags, secondaryTags, imgPrompt.prompt, mode)
          : undefined;

        // Diagnostic logging — trace the prompt pipeline
        console.log(`[StoryImage][${imgPrompt.id}] Raw scene prompt:`, imgPrompt.prompt.substring(0, 120));
        console.log(`[StoryImage][${imgPrompt.id}] character_id: ${imgPrompt.character_id}, secondary_character_id: ${imgPrompt.secondary_character_id}`);
        console.log(`[StoryImage][${imgPrompt.id}] Primary tags: ${primaryTags ? primaryTags.substring(0, 120) : 'NULL (no approved_prompt)'}`);
        console.log(`[StoryImage][${imgPrompt.id}] Secondary tags: ${secondaryTags ? secondaryTags.substring(0, 120) : 'NULL'}`);
        console.log(`[StoryImage][${imgPrompt.id}] promptOverride: ${promptOverride ? 'YES — using buildStoryImagePrompt' : 'NO — falling back to buildPrompt(charData, scene)'}`);
        if (promptOverride) {
          console.log(`[StoryImage][${imgPrompt.id}] Final prompt to Civitai:`, promptOverride.substring(0, 200));
        }

        // Submit to Civitai
        const result = await submitGeneration(charData, scene, settings, promptOverride ? { prompt: promptOverride } : undefined);

        // Persist image record
        const negativePrompt = buildNegativePrompt(scene);
        const { data: imageRow, error: imgError } = await supabase
          .from("images")
          .insert({
            character_id: imgPrompt.character_id || null,
            prompt: imgPrompt.prompt,
            negative_prompt: negativePrompt,
            settings: {
              modelUrn: settings.modelUrn,
              width: settings.width,
              height: settings.height,
              steps: settings.steps,
              cfgScale: settings.cfgScale,
              scheduler: settings.scheduler,
              seed: settings.seed,
              clipSkip: settings.clipSkip,
              batchSize: settings.batchSize,
            },
            mode,
          })
          .select("id")
          .single();

        if (imgError || !imageRow) {
          throw new Error(
            `Failed to create image record: ${imgError?.message}`
          );
        }

        // Save generation jobs
        if (result.jobs.length > 0) {
          const jobRows = result.jobs.map((job) => ({
            job_id: job.jobId,
            image_id: imageRow.id,
            status: "pending" as const,
            cost: job.cost,
          }));
          await supabase.from("generation_jobs").insert(jobRows);
        }

        // Link image to the prompt row
        await supabase
          .from("story_image_prompts")
          .update({ image_id: imageRow.id })
          .eq("id", imgPrompt.id);

        jobs.push({
          promptId: imgPrompt.id,
          jobId: result.jobs[0]?.jobId,
        });

        // Wait 2 seconds before the next generation to avoid rate limits
        if (i < prompts.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } catch (err) {
        // Mark as failed and continue with the rest
        await supabase
          .from("story_image_prompts")
          .update({ status: "failed" })
          .eq("id", imgPrompt.id);

        const message =
          err instanceof CivitaiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Unknown error";

        console.error(
          `Failed to generate image for prompt ${imgPrompt.id}:`,
          message
        );
        failed.push({ promptId: imgPrompt.id, error: message });

        // Wait 2 seconds even after failure to avoid rate limits
        if (i < prompts.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
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
