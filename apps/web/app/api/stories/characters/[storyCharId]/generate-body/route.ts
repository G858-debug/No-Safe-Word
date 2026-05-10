import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import {
  submitSirayPortraitWithFallback,
  generateFlux2Image,
  imageUrlToBase64,
  buildCharacterPortraitPrompt,
  PORTRAIT_COMPOSITION,
  FULLBODY_COMPOSITION,
  type PortraitCharacterDescription,
} from "@no-safe-word/image-gen";
import type { ImageModel } from "@no-safe-word/shared";

// Body portrait targets per pipeline (2:3 framing).
const HUNYUAN_BODY_SIZE = "1024x1536";
const HUNYUAN_BODY_FALLBACK = "1024x1280";
const FLUX_BODY_WIDTH = 1664;
const FLUX_BODY_HEIGHT = 2496;

// POST /api/stories/characters/[storyCharId]/generate-body
//
// Submits a body generation conditioned on the just-completed face image as
// i2i reference. Mirrors /generate but body-specific, kept as a separate
// route for clean face/body separation. The new images row carries
// settings.imageType = "body" so /in-flight-state and other consumers can
// distinguish face vs body without inspecting prompt text.
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const { storyCharId } = await props.params;

  try {
    const body = await request.json().catch(() => ({}));
    const faceImageId: string | undefined =
      typeof body.face_image_id === "string" ? body.face_image_id : undefined;
    const promptOverride: string | undefined =
      typeof body.prompt === "string" && body.prompt.trim().length > 20
        ? body.prompt.trim()
        : undefined;

    if (!faceImageId) {
      return NextResponse.json(
        { error: "face_image_id is required" },
        { status: 400 }
      );
    }

    // Resolve the linked base character + active image_model.
    const { data: storyChar } = await supabase
      .from("story_characters")
      .select("id, character_id, series_id")
      .eq("id", storyCharId)
      .single();
    if (!storyChar) {
      return NextResponse.json(
        { error: "Story character not found" },
        { status: 404 }
      );
    }

    const { data: series } = await supabase
      .from("story_series")
      .select("id, image_model")
      .eq("id", storyChar.series_id)
      .single();
    if (!series) {
      return NextResponse.json(
        { error: "Parent series not found" },
        { status: 404 }
      );
    }
    const imageModel = series.image_model as ImageModel;

    const { data: character } = await supabase
      .from("characters")
      .select("id, name, description")
      .eq("id", storyChar.character_id)
      .single();
    if (!character) {
      return NextResponse.json(
        { error: "Character not found" },
        { status: 404 }
      );
    }

    // Verify the face image is complete + belongs to this character. Without
    // a stored_url the i2i reference would be empty and we'd silently fall
    // back to t2i.
    const { data: faceImage } = await supabase
      .from("images")
      .select("id, character_id, stored_url")
      .eq("id", faceImageId)
      .single();
    if (!faceImage) {
      return NextResponse.json(
        { error: "face_image_id not found" },
        { status: 400 }
      );
    }
    if (faceImage.character_id !== character.id) {
      return NextResponse.json(
        { error: "face_image_id does not belong to this character" },
        { status: 403 }
      );
    }
    if (!faceImage.stored_url) {
      return NextResponse.json(
        { error: "Face image not yet uploaded — wait for completion" },
        { status: 400 }
      );
    }

    const desc = character.description as Record<string, string>;
    const rawPrompt =
      promptOverride ??
      buildCharacterPortraitPrompt(
        desc as PortraitCharacterDescription,
        "body"
      );

    // Body framing guardrail. The dashboard textarea lets users hand-edit the
    // body prompt; if they kept the face-stage PORTRAIT_COMPOSITION text
    // ("Portrait, ... Medium close-up, eye-level."), Hunyuan receives a
    // prompt that asks for both full-body and medium close-up at once and
    // falls back to portrait framing. Swap to FULLBODY_COMPOSITION here so
    // the body route enforces body framing regardless of what the textarea
    // contained.
    const promptText = rawPrompt.includes(PORTRAIT_COMPOSITION)
      ? rawPrompt.replace(PORTRAIT_COMPOSITION, FULLBODY_COMPOSITION)
      : rawPrompt;
    if (promptText !== rawPrompt) {
      console.log(
        `[StoryPublisher] /generate-body swapped PORTRAIT_COMPOSITION → FULLBODY_COMPOSITION for character=${character.name}`
      );
    }

    if (imageModel === "hunyuan3") {
      // Siray i2i — auto-selected when referenceImageUrls is non-empty.
      // Attempts 1024x1536 first; falls back to 1024x1280 (visibly) on
      // size rejection.
      const submitted = await submitSirayPortraitWithFallback({
        prompt: promptText,
        aspectRatio: "2:3",
        size: HUNYUAN_BODY_SIZE,
        fallbackSize: HUNYUAN_BODY_FALLBACK,
        referenceImageUrls: [faceImage.stored_url],
      });

      const [requestedW, requestedH] = parseSize(submitted.requestedSize);
      const [actualW, actualH] = parseSize(submitted.actualSize);

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
            aspect_ratio: "2:3",
            size: submitted.actualSize,
            reference_image_count: submitted.referenceImageCount,
            imageType: "body",
            face_image_id: faceImageId,
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

    if (imageModel === "flux2_dev") {
      const refBase64 = await imageUrlToBase64(faceImage.stored_url);
      const flux2Result = await generateFlux2Image({
        scenePrompt: promptText,
        references: [
          {
            name: `ref_face_${faceImageId}.jpeg`,
            base64: refBase64,
          },
        ],
        // Body portrait at the 4MP cap, 2:3.
        width: FLUX_BODY_WIDTH,
        height: FLUX_BODY_HEIGHT,
        filenamePrefix: "flux2_body",
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
            width: FLUX_BODY_WIDTH,
            height: FLUX_BODY_HEIGHT,
            imageType: "body",
            face_image_id: faceImageId,
          },
          mode: "sfw",
          requested_width: FLUX_BODY_WIDTH,
          requested_height: FLUX_BODY_HEIGHT,
          actual_width: FLUX_BODY_WIDTH,
          actual_height: FLUX_BODY_HEIGHT,
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
    console.error("Character body generation failed:", err);
    return NextResponse.json(
      {
        error: "Body generation failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

function parseSize(size: string): [number, number] {
  const [w, h] = size.split("x").map((s) => Number(s));
  if (!Number.isFinite(w) || !Number.isFinite(h)) {
    throw new Error(`[generate-body] could not parse size string '${size}'`);
  }
  return [w, h];
}
