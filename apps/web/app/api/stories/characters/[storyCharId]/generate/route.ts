import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import {
  submitSirayImage,
  generateFlux2Image,
  buildCharacterPortraitPrompt,
  imageUrlToBase64,
  type PortraitCharacterDescription,
} from "@no-safe-word/image-gen";
import type { ImageModel } from "@no-safe-word/shared";

type ImageType = "portrait" | "fullBody";
type GenerationStage = "face" | "body";

// POST /api/stories/characters/[storyCharId]/generate — Generate a character portrait or full body
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    // Parse optional type, stage, and customPrompt from request body
    let imageType: ImageType = "portrait";
    let stage: GenerationStage = "face";
    let customPrompt: string | undefined;
    try {
      const body = await request.json();
      if (body.type === "fullBody") {
        imageType = "fullBody";
      }
      if (body.stage === "body") {
        stage = "body";
      }
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
      .select("id, name, description, approved_image_id")
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

    console.log(`[StoryPublisher] Generating ${stage} (${isMale ? 'male' : 'female'}) for: ${character.name} [model=${imageModel}]`);

    // For body stage, look up the approved face portrait so we can pass it
    // as a reference image (PuLID for Flux 2, i2i for Hunyuan/Siray). Falls
    // through silently if no approved face exists yet — body generation will
    // run as plain t2i. Face stage never references anything (this IS the
    // reference being created).
    let approvedFaceUrl: string | null = null;
    if (stage === "body" && character.approved_image_id) {
      const { data: faceImg } = await supabase
        .from("images")
        .select("stored_url, sfw_url")
        .eq("id", character.approved_image_id)
        .single();
      approvedFaceUrl = faceImg?.stored_url ?? faceImg?.sfw_url ?? null;
    }

    // ── hunyuan3 portrait path (async submit-and-poll via Siray, t2i) ──
    if (imageModel === "hunyuan3") {
      const promptText =
        customPrompt ??
        buildCharacterPortraitPrompt(desc as PortraitCharacterDescription, stage);

      // 1. Submit to Siray; returns immediately with a task_id.
      // For body stage, pass the approved face as an i2i reference so the
      // body image inherits identity. For face stage, plain t2i.
      const referenceImageUrls = approvedFaceUrl ? [approvedFaceUrl] : [];
      const submitted = await submitSirayImage({
        prompt: promptText,
        aspectRatio: "3:4",
        referenceImageUrls,
      });

      // 2. Insert the images row up-front (stored_url filled in later by
      //    the status handler when the job completes).
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
            aspect_ratio: "3:4",
            size: submitted.size,
            imageType,
            stage,
            reference_image_count: submitted.referenceImageCount,
          },
          mode: "sfw",
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
    // Face stage: no references — this IS the reference being created.
    // Body stage: PuLID-injects the approved face so the body inherits identity.
    if (imageModel === "flux2_dev") {
      const promptText =
        customPrompt ??
        buildCharacterPortraitPrompt(desc as PortraitCharacterDescription, stage);

      // For body stage, inject the approved face via PuLID so the body
      // image inherits the locked identity. Face stage has no reference yet.
      const references: Array<{ name: string; base64: string }> = [];
      if (approvedFaceUrl) {
        references.push({
          name: `ref_face_${character.id}.jpeg`,
          base64: await imageUrlToBase64(approvedFaceUrl),
        });
      }

      const flux2Result = await generateFlux2Image({
        scenePrompt: promptText,
        references,
        // Portraits are always 3:4 (768×1024) per the standard portrait framing.
        width: 768,
        height: 1024,
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
            width: 768,
            height: 1024,
            imageType,
            stage,
          },
          mode: "sfw",
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
