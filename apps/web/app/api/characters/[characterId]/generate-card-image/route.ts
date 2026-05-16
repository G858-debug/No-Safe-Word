import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import {
  submitSirayImage,
  generateFlux2Image,
} from "@no-safe-word/image-gen";
import type { ImageModel } from "@no-safe-word/shared";
import { downscaleRefToBase64 } from "@/lib/server/downscale-ref";

// 4:5 portrait — environmental "MEET THE CAST" character card.
//
// Hunyuan honours the explicit size override; Flux 2 Dev consumes width +
// height directly. Both within the supported aspect-ratio set.
const CARD_ASPECT_RATIO = "4:5";
const HUNYUAN_CARD_SIZE = "1024x1280";
const FLUX_CARD_WIDTH = 1024;
const FLUX_CARD_HEIGHT = 1280;

// POST /api/characters/[characterId]/generate-card-image
//
// Submits a character-card image generation job. Async — returns a jobId
// immediately; the client polls /api/status/[jobId] until completion.
//
// Body: { prompt_override?: string, seriesId?: string }
//   - prompt_override: when supplied (non-empty), used as the prompt AND
//     persisted to characters.card_image_prompt for future regenerations.
//   - seriesId: disambiguates which story's image_model to use when the
//     character is linked to multiple stories. Optional; defaults to the
//     most recent story_characters linkage.
//
// Prerequisites enforced on this route (400 otherwise):
//   - characters.card_image_prompt non-empty (or prompt_override supplied)
//   - characters.approved_fullbody_image_id present (body portrait approved)
//
// Reference defaulting: body portrait first, face portrait second if
// approved. Both pipelines support multi-reference natively.
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ characterId: string }> }
) {
  const { characterId } = await props.params;

  try {
    const body = await request.json().catch(() => ({}));
    const promptOverride: string | undefined =
      typeof body.prompt_override === "string" && body.prompt_override.trim().length > 0
        ? body.prompt_override.trim()
        : undefined;
    const seriesIdHint: string | undefined =
      typeof body.seriesId === "string" && body.seriesId.length > 0
        ? body.seriesId
        : undefined;

    // 1. Load the base character.
    const { data: character } = await supabase
      .from("characters")
      .select(
        "id, name, card_image_prompt, approved_image_id, approved_fullbody_image_id"
      )
      .eq("id", characterId)
      .single();

    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    if (!character.approved_fullbody_image_id) {
      return NextResponse.json(
        {
          error:
            "Character has no approved body portrait. Approve the body portrait before generating a card image.",
        },
        { status: 400 }
      );
    }

    // 2. Resolve the prompt. Prefer override; fall back to stored.
    const promptText = promptOverride ?? (character.card_image_prompt?.trim() || "");
    if (!promptText) {
      return NextResponse.json(
        {
          error:
            "card_image_prompt is empty for this character and no prompt_override supplied.",
        },
        { status: 400 }
      );
    }

    // Persist the override if supplied — Phase 3 UI relies on this so
    // edited prompts stick across regenerations.
    if (promptOverride && promptOverride !== character.card_image_prompt) {
      const { error: updErr } = await supabase
        .from("characters")
        .update({ card_image_prompt: promptOverride })
        .eq("id", character.id);
      if (updErr) {
        throw new Error(`Failed to persist prompt override: ${updErr.message}`);
      }
    }

    // 3. Resolve image_model. Characters can be linked to multiple stories;
    //    seriesId disambiguates. Fall back to the most recent linkage. Two
    //    stories with different models for the same character is a rare
    //    edge case — characters' visual identity is locked at portrait
    //    approval — but we still need to pick one model to dispatch.
    let series: { id: string; image_model: ImageModel; slug: string } | null = null;
    if (seriesIdHint) {
      const { data: hintedLink } = await supabase
        .from("story_characters")
        .select("series_id, story_series:series_id ( id, image_model, slug )")
        .eq("character_id", character.id)
        .eq("series_id", seriesIdHint)
        .maybeSingle();
      const hinted = hintedLink?.story_series as unknown as {
        id: string;
        image_model: ImageModel;
        slug: string;
      } | null;
      if (hinted) series = hinted;
    }
    if (!series) {
      const { data: linkRows } = await supabase
        .from("story_characters")
        .select(
          "id, series_id, story_series:series_id ( id, image_model, slug, created_at )"
        )
        .eq("character_id", character.id);
      const linked = (linkRows ?? [])
        .map((r) => r.story_series as unknown as {
          id: string;
          image_model: ImageModel;
          slug: string;
          created_at: string;
        } | null)
        .filter((s): s is NonNullable<typeof s> => s !== null)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      series = linked[0] ?? null;
    }

    if (!series) {
      return NextResponse.json(
        {
          error:
            "Character is not linked to any story. Cannot resolve image_model.",
        },
        { status: 400 }
      );
    }

    const imageModel: ImageModel = series.image_model;

    // 4. Resolve reference URLs from the FK columns. Body first (primary),
    //    face second if approved.
    const refIds: string[] = [character.approved_fullbody_image_id];
    if (character.approved_image_id) refIds.push(character.approved_image_id);

    const { data: refImages, error: refErr } = await supabase
      .from("images")
      .select("id, stored_url")
      .in("id", refIds);
    if (refErr) {
      throw new Error(`Failed to load reference images: ${refErr.message}`);
    }
    const refUrlsById = new Map(
      (refImages ?? []).map((i) => [i.id, i.stored_url] as const)
    );
    const referenceImageUrls: string[] = refIds
      .map((id) => refUrlsById.get(id))
      .filter((u): u is string => typeof u === "string" && u.length > 0);

    if (referenceImageUrls.length === 0) {
      return NextResponse.json(
        {
          error:
            "Reference images have no stored_url yet (still uploading?). Try again in a moment.",
        },
        { status: 400 }
      );
    }

    // 5. Dispatch on image_model.
    if (imageModel === "hunyuan3") {
      const submitted = await submitSirayImage({
        prompt: promptText,
        aspectRatio: CARD_ASPECT_RATIO,
        size: HUNYUAN_CARD_SIZE,
        referenceImageUrls,
      });

      const [w, h] = parseSize(submitted.size);

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
            aspect_ratio: CARD_ASPECT_RATIO,
            size: submitted.size,
            reference_image_count: submitted.referenceImageCount,
            imageType: "character_card",
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
        job_type: "character_card",
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
      const refsBase64 = await Promise.all(
        referenceImageUrls.map(async (url, i) => ({
          name: `ref_card_${i}.jpeg`,
          base64: await downscaleRefToBase64(url),
        }))
      );

      const flux2Result = await generateFlux2Image({
        scenePrompt: promptText,
        references: refsBase64,
        width: FLUX_CARD_WIDTH,
        height: FLUX_CARD_HEIGHT,
        filenamePrefix: "flux2_card",
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
            width: FLUX_CARD_WIDTH,
            height: FLUX_CARD_HEIGHT,
            imageType: "character_card",
            seriesId: series.id,
          },
          mode: "sfw",
          requested_width: FLUX_CARD_WIDTH,
          requested_height: FLUX_CARD_HEIGHT,
          actual_width: FLUX_CARD_WIDTH,
          actual_height: FLUX_CARD_HEIGHT,
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
        job_type: "character_card",
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
    console.error("[generate-card-image] failed:", err);
    return NextResponse.json(
      {
        error: "Card image generation failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

function parseSize(size: string): [number, number] {
  const [w, h] = size.split("x").map((s) => Number(s));
  if (!Number.isFinite(w) || !Number.isFinite(h)) {
    throw new Error(`[generate-card-image] could not parse size '${size}'`);
  }
  return [w, h];
}
