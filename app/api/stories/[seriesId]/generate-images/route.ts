import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { submitGeneration, CivitaiError } from "@/lib/civitai";
import { buildNegativePrompt } from "@/lib/prompt-builder";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import type { CharacterData, SceneData } from "@/lib/types";

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
  { params }: { params: { seriesId: string } }
) {
  const { seriesId } = params;

  try {
    const body = await request.json().catch(() => ({}));
    const { post_id } = body as { post_id?: string };

    // 1. Verify all characters in the series are approved
    const { data: storyChars, error: charsError } = await supabase
      .from("story_characters")
      .select("id, character_id, approved, approved_seed")
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

    // Build a character_id → approved_seed map
    const seedMap = new Map<string, number | null>();
    storyChars.forEach((sc) => seedMap.set(sc.character_id, sc.approved_seed));

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
      .select("id, post_id, image_type, position, character_name, character_id, prompt")
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

    // 4. Pre-fetch all linked characters for building CharacterData
    const characterIds = Array.from(
      new Set(
        prompts
          .map((p) => p.character_id)
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

    // 5. Generate each image
    const jobs: QueuedJob[] = [];
    const failed: FailedJob[] = [];
    let skipped = 0;

    for (const imgPrompt of prompts) {
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

        const settings = { ...DEFAULT_SETTINGS, seed, batchSize: 1 };

        // Submit to Civitai
        const result = await submitGeneration(charData, scene, settings);

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
