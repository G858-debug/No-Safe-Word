import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import {
  submitSirayImage,
  generateFlux2Image,
} from "@no-safe-word/image-gen";
import type { ImageModel } from "@no-safe-word/shared";

// 16:9 landscape — atmospheric/editorial accompanying image for the
// Author's Notes block. Not a portrait of the character or the author —
// a still life, an empty room, a glass of wine on a kitchen table.
//
// Hunyuan's ASPECT_RATIO_TO_SIZE map only covers 4:5 and 5:4 by default;
// the explicit `size` override below makes 16:9 work without changing
// the map. Flux 2 Dev consumes width/height directly with no constraints.
const NOTE_ASPECT_RATIO = "16:9";
const HUNYUAN_NOTE_SIZE = "1280x720";
const FLUX_NOTE_WIDTH = 1280;
const FLUX_NOTE_HEIGHT = 720;

// POST /api/stories/[seriesId]/generate-author-note-image
//
// Submits the accompanying image for a story's Author's Notes block.
// Async — returns a jobId; client polls /api/status/[jobId].
//
// Body: { prompt_override?: string }
//   - prompt_override: when supplied, used as the prompt AND persisted to
//     story_series.author_note_image_prompt for future regenerations.
//
// Prerequisites enforced (400 otherwise):
//   - story_series.author_notes is non-null (no point generating an image
//     for a story that didn't earn editorial notes)
//   - story_series.author_note_image_prompt is non-empty (or override
//     supplied)
//
// No reference images. The image is environmental, not a person.
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const { seriesId } = await props.params;

  try {
    const body = await request.json().catch(() => ({}));
    const promptOverride: string | undefined =
      typeof body.prompt_override === "string" && body.prompt_override.trim().length > 0
        ? body.prompt_override.trim()
        : undefined;

    const { data: series } = await supabase
      .from("story_series")
      .select(
        "id, slug, image_model, author_notes, author_note_image_prompt, author_note_approved_at"
      )
      .eq("id", seriesId)
      .single();

    if (!series) {
      return NextResponse.json({ error: "Series not found" }, { status: 404 });
    }

    // Phase 3b approval lock — author notes are part of the package that
    // gets scheduled to Buffer + sent via email. Edits after approval can
    // desync from the scheduled snapshot, so we hard-lock generation while
    // approved. Caller revokes first, regenerates, re-approves.
    if (series.author_note_approved_at !== null) {
      return NextResponse.json(
        {
          error:
            "Author's notes are approved and locked. Revoke approval before regenerating the image.",
          code: "approved_locked",
        },
        { status: 409 }
      );
    }

    if (series.author_notes === null) {
      return NextResponse.json(
        {
          error:
            "This story has no author_notes. Generate the notes first, then come back for the accompanying image.",
        },
        { status: 400 }
      );
    }

    const promptText =
      promptOverride ?? (series.author_note_image_prompt?.trim() || "");
    if (!promptText) {
      return NextResponse.json(
        {
          error:
            "author_note_image_prompt is empty for this story and no prompt_override supplied.",
        },
        { status: 400 }
      );
    }

    if (promptOverride && promptOverride !== series.author_note_image_prompt) {
      const { error: updErr } = await supabase
        .from("story_series")
        .update({ author_note_image_prompt: promptOverride })
        .eq("id", series.id);
      if (updErr) {
        throw new Error(`Failed to persist prompt override: ${updErr.message}`);
      }
    }

    const imageModel = series.image_model as ImageModel;

    if (imageModel === "hunyuan3") {
      const submitted = await submitSirayImage({
        prompt: promptText,
        aspectRatio: NOTE_ASPECT_RATIO,
        size: HUNYUAN_NOTE_SIZE,
        referenceImageUrls: [],
      });

      const [w, h] = parseSize(submitted.size);

      const { data: imageRow, error: imgErr } = await supabase
        .from("images")
        .insert({
          // No character_id — author-note images are story-scoped.
          prompt: promptText,
          settings: {
            model: "hunyuan3",
            provider: "siray",
            siray_model: submitted.model,
            siray_task_id: submitted.taskId,
            aspect_ratio: NOTE_ASPECT_RATIO,
            size: submitted.size,
            reference_image_count: 0,
            imageType: "author_note",
            seriesId: series.id,
          },
          mode: "sfw",
          requested_width: w,
          requested_height: h,
          actual_width: w,
          actual_height: h,
          dimension_fallback_reason: null,
        })
        .select("id")
        .single();
      if (imgErr || !imageRow) {
        throw new Error(`Failed to create images row: ${imgErr?.message}`);
      }

      const jobId = `siray-${submitted.taskId}`;
      const { error: jobErr } = await supabase.from("generation_jobs").insert({
        job_id: jobId,
        image_id: imageRow.id,
        status: "pending",
        cost: 0,
        job_type: "author_note",
        series_id: series.id,
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
      const flux2Result = await generateFlux2Image({
        scenePrompt: promptText,
        references: [],
        width: FLUX_NOTE_WIDTH,
        height: FLUX_NOTE_HEIGHT,
        filenamePrefix: "flux2_author_note",
      });

      const { data: imageRow, error: imgErr } = await supabase
        .from("images")
        .insert({
          prompt: flux2Result.prompt,
          settings: {
            model: "flux2_dev",
            provider: "runpod",
            seed: flux2Result.seed,
            width: FLUX_NOTE_WIDTH,
            height: FLUX_NOTE_HEIGHT,
            imageType: "author_note",
            seriesId: series.id,
          },
          mode: "sfw",
          requested_width: FLUX_NOTE_WIDTH,
          requested_height: FLUX_NOTE_HEIGHT,
          actual_width: FLUX_NOTE_WIDTH,
          actual_height: FLUX_NOTE_HEIGHT,
          dimension_fallback_reason: null,
        })
        .select("id")
        .single();
      if (imgErr || !imageRow) {
        throw new Error(`Failed to create images row: ${imgErr?.message}`);
      }

      const { error: jobErr } = await supabase.from("generation_jobs").insert({
        job_id: flux2Result.jobId,
        image_id: imageRow.id,
        status: "pending",
        cost: 0,
        job_type: "author_note",
        series_id: series.id,
      });
      if (jobErr) {
        throw new Error(`Failed to register Flux 2 Dev job: ${jobErr.message}`);
      }

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
    console.error("[generate-author-note-image] failed:", err);
    return NextResponse.json(
      {
        error: "Author-note image generation failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

function parseSize(size: string): [number, number] {
  const [w, h] = size.split("x").map((s) => Number(s));
  if (!Number.isFinite(w) || !Number.isFinite(h)) {
    throw new Error(`[generate-author-note-image] could not parse size '${size}'`);
  }
  return [w, h];
}
