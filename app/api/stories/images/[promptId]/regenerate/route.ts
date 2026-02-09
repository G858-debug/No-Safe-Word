import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { submitGeneration, CivitaiError } from "@/lib/civitai";
import { buildNegativePrompt } from "@/lib/prompt-builder";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import type { CharacterData, SceneData } from "@/lib/types";

// POST /api/stories/images/[promptId]/regenerate — Regenerate a single story image
export async function POST(
  _request: NextRequest,
  { params }: { params: { promptId: string } }
) {
  const { promptId } = params;

  try {
    // 1. Fetch the image prompt
    const { data: imgPrompt, error: fetchError } = await supabase
      .from("story_image_prompts")
      .select("id, post_id, image_type, position, character_name, character_id, prompt")
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
      // Check if this prompt already has an image linked
      if (imgPrompt.image_id) {
        const { data: oldImage } = await supabase
          .from("images")
          .select("stored_url")
          .eq("id", imgPrompt.image_id)
          .single();

        if (oldImage?.stored_url) {
          // Extract storage path from URL
          // URL format: https://{project}.supabase.co/storage/v1/object/public/story-images/{path}
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
      // Continue with regeneration even if cleanup fails
    }

    // 3. Mark as generating
    await supabase
      .from("story_image_prompts")
      .update({ status: "generating" })
      .eq("id", promptId);

    // 4. Look up character data and approved seed if linked
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

      // Look up the approved seed from story_characters via the post's series
      const { data: post } = await supabase
        .from("story_posts")
        .select("series_id")
        .eq("id", imgPrompt.post_id)
        .single();

      if (post) {
        const { data: storyChar } = await supabase
          .from("story_characters")
          .select("approved_seed")
          .eq("series_id", post.series_id)
          .eq("character_id", imgPrompt.character_id)
          .single();

        if (storyChar?.approved_seed != null && storyChar.approved_seed > 0) {
          seed = storyChar.approved_seed + imgPrompt.position;
        }
      }
    }

    // 5. Build scene from the stored prompt
    const isNsfw = imgPrompt.image_type === "website_nsfw_paired";
    const mode: "sfw" | "nsfw" = isNsfw ? "nsfw" : "sfw";

    const scene: SceneData = {
      mode,
      setting: "",
      lighting: "",
      mood: "",
      sfwDescription: isNsfw ? "" : imgPrompt.prompt,
      nsfwDescription: isNsfw ? imgPrompt.prompt : "",
      additionalTags: [],
    };

    // 6. Submit generation
    const settings = { ...DEFAULT_SETTINGS, seed, batchSize: 1 };
    const result = await submitGeneration(charData, scene, settings);

    // 7. Persist image record
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
      throw new Error(`Failed to create image record: ${imgError?.message}`);
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

    // Link new image to the prompt row
    await supabase
      .from("story_image_prompts")
      .update({ image_id: imageRow.id })
      .eq("id", promptId);

    return NextResponse.json({
      jobId: result.jobs[0]?.jobId,
      imageId: imageRow.id,
    });
  } catch (err) {
    // Mark as failed on error
    await supabase
      .from("story_image_prompts")
      .update({ status: "failed" })
      .eq("id", promptId);

    if (err instanceof CivitaiError) {
      return NextResponse.json(
        { error: err.message, details: err.details },
        { status: err.status }
      );
    }
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
