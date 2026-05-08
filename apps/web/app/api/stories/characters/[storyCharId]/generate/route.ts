import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import {
  submitSirayPortraitWithFallback,
  generateFlux2Image,
  buildCharacterPortraitPrompt,
  type PortraitCharacterDescription,
} from "@no-safe-word/image-gen";
import type { ImageModel } from "@no-safe-word/shared";

// Portrait resolution targets per pipeline. The fallback only fires for
// HunyuanImage when Siray rejects the higher size at submit time.
const HUNYUAN_FACE_SIZE = "1536x1536";
const HUNYUAN_FACE_FALLBACK = "1280x1280";
const FLUX_FACE_WIDTH = 2048;
const FLUX_FACE_HEIGHT = 2048;

// POST /api/stories/characters/[storyCharId]/generate — Generate a character portrait.
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    // Parse optional customPrompt from request body
    let customPrompt: string | undefined;
    try {
      const body = await request.json();
      if (typeof body.customPrompt === 'string' && body.customPrompt.trim().length > 20) {
        customPrompt = body.customPrompt.trim();
      }
    } catch {
      // No body or invalid JSON — use defaults
    }

    // 1. Fetch the story_character row (including its series for model lookup)
    const { data: storyChar, error: scError } = await supabase
      .from("story_characters")
      .select("id, character_id, series_id")
      .eq("id", storyCharId)
      .single();

    if (scError || !storyChar) {
      console.error(`[StoryPublisher] Story character not found: ${storyCharId}`, scError);
      return NextResponse.json(
        { error: "Story character not found" },
        { status: 404 }
      );
    }

    // 1b. Fetch the parent series to resolve the active image_model
    const { data: series, error: seriesErr } = await supabase
      .from("story_series")
      .select("id, image_model")
      .eq("id", storyChar.series_id)
      .single();

    if (seriesErr || !series) {
      return NextResponse.json(
        { error: "Parent series not found" },
        { status: 404 }
      );
    }

    const imageModel = series.image_model as ImageModel;

    // flux2_dev → currently still uses the Juggernaut Ragnarok path on
    // RunPod. Phase 4 swaps this for Flux 2 Dev once the new endpoint +
    // Docker image are provisioned.
    // hunyuan3 → async submit-and-poll via Siray. Submit returns a
    // task_id immediately; the client polls /api/status/siray-{taskId}
    // until the image is uploaded to Supabase Storage. Decouples the
    // route's HTTP lifetime from Siray's queue depth (sometimes >2min,
    // exceeding browser/proxy timeouts).

    // 2. Fetch the character's structured description
    const { data: character, error: charError } = await supabase
      .from("characters")
      .select("id, name, description")
      .eq("id", storyChar.character_id)
      .single();

    if (charError || !character) {
      console.error(`[StoryPublisher] Character not found: ${storyChar.character_id}`, charError);
      return NextResponse.json(
        { error: "Character not found" },
        { status: 404 }
      );
    }

    const desc = character.description as Record<string, string>;
    const isMale = desc.gender === 'male';

    console.log(`[StoryPublisher] Generating portrait (${isMale ? 'male' : 'female'}) for: ${character.name} [model=${imageModel}]`);

    // ── hunyuan3 portrait path (async submit-and-poll via Siray, t2i) ──
    if (imageModel === "hunyuan3") {
      const promptText =
        customPrompt ??
        buildCharacterPortraitPrompt(desc as PortraitCharacterDescription, "face");

      // Submit to Siray. Attempts 1536x1536 first; if Siray rejects the
      // size at submit time, retries at 1280x1280 and surfaces the fallback
      // visibly via dimension_fallback_reason on the images row.
      const submitted = await submitSirayPortraitWithFallback({
        prompt: promptText,
        aspectRatio: "1:1",
        size: HUNYUAN_FACE_SIZE,
        fallbackSize: HUNYUAN_FACE_FALLBACK,
        referenceImageUrls: [],
      });

      const [requestedW, requestedH] = parseSize(submitted.requestedSize);
      const [actualW, actualH] = parseSize(submitted.actualSize);

      // Insert the images row up-front (stored_url filled in later by the
      // status handler when the job completes).
      const { data: imageRow, error: imgErr } = await supabase
        .from("images")
        .insert({
          character_id: character.id,
          prompt: promptText,
          settings: {
            model: "hunyuan3",
            provider: "siray",
            siray_model: submitted.model,
            siray_task_id: submitted.taskId,
            aspect_ratio: "1:1",
            size: submitted.actualSize,
            reference_image_count: submitted.referenceImageCount,
            imageType: "face",
          },
          mode: "sfw",
          requested_width: requestedW,
          requested_height: requestedH,
          actual_width: actualW,
          actual_height: actualH,
          dimension_fallback_reason: submitted.fallbackReason,
        })
        .select("id")
        .single();

      if (imgErr || !imageRow) {
        throw new Error(`Failed to create image record: ${imgErr?.message}`);
      }

      // 3. Register the job for the polling endpoint to find.
      const jobId = `siray-${submitted.taskId}`;
      const { error: jobErr } = await supabase.from("generation_jobs").insert({
        job_id: jobId,
        image_id: imageRow.id,
        status: "pending",
        cost: 0,
        job_type: "character_portrait",
      });

      if (jobErr) {
        throw new Error(`Failed to register Siray job: ${jobErr.message}`);
      }

      return NextResponse.json({
        jobId,
        imageId: imageRow.id,
        model: "hunyuan3",
        promptUsed: promptText,
      });
    }

    // ── flux2_dev portrait path (async RunPod on Flux 2 Dev endpoint) ──
    // Plain t2i — this IS the reference being created.
    if (imageModel === "flux2_dev") {
      const promptText =
        customPrompt ??
        buildCharacterPortraitPrompt(desc as PortraitCharacterDescription, "face");

      const flux2Result = await generateFlux2Image({
        scenePrompt: promptText,
        references: [],
        // Face portrait at the 4MP cap, 1:1.
        width: FLUX_FACE_WIDTH,
        height: FLUX_FACE_HEIGHT,
        filenamePrefix: "flux2_portrait",
      });

      const { data: imageRow, error: imgErr } = await supabase
        .from("images")
        .insert({
          character_id: character.id,
          prompt: flux2Result.prompt,
          settings: {
            model: "flux2_dev",
            provider: "runpod",
            seed: flux2Result.seed,
            width: FLUX_FACE_WIDTH,
            height: FLUX_FACE_HEIGHT,
            imageType: "face",
          },
          mode: "sfw",
          requested_width: FLUX_FACE_WIDTH,
          requested_height: FLUX_FACE_HEIGHT,
          actual_width: FLUX_FACE_WIDTH,
          actual_height: FLUX_FACE_HEIGHT,
          dimension_fallback_reason: null,
        })
        .select("id")
        .single();

      if (imgErr || !imageRow) {
        throw new Error(`Failed to create image record: ${imgErr?.message}`);
      }

      await supabase.from("generation_jobs").insert({
        job_id: flux2Result.jobId,
        image_id: imageRow.id,
        status: "pending",
        cost: 0,
      });

      return NextResponse.json({
        jobId: flux2Result.jobId,
        imageId: imageRow.id,
        model: "flux2_dev",
        promptUsed: flux2Result.prompt,
      });
    }

    return NextResponse.json(
      { error: `Unsupported image_model: ${imageModel}` },
      { status: 400 }
    );
  } catch (err) {
    console.error("Character portrait generation failed:", err);
    return NextResponse.json(
      {
        error: "Generation failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

function parseSize(size: string): [number, number] {
  const [w, h] = size.split("x").map((s) => Number(s));
  if (!Number.isFinite(w) || !Number.isFinite(h)) {
    throw new Error(`[generate-portrait] could not parse size string '${size}'`);
  }
  return [w, h];
}
