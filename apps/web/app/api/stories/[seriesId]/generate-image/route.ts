import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import {
  generateHunyuanImage,
  generateFlux2Image,
  imageUrlToBase64,
  buildSceneCharacterBlock,
  buildSceneCharacterBlockFromLocked,
  type PortraitCharacterDescription,
} from "@no-safe-word/image-gen";
import type { ImageModel } from "@no-safe-word/shared";
import { uploadRemoteImageToStorage } from "@/lib/server/upload-generated-image";

/**
 * POST /api/stories/[seriesId]/generate-image
 *
 * Unified story-image generation entry point. Reads
 * story_series.image_model and dispatches to the correct backend:
 *
 *   - flux2_dev  → Flux 2 Dev via RunPod/ComfyUI (Phase 4)
 *   - hunyuan3   → HunyuanImage 3.0 via Replicate (Phase 3, implemented below)
 *
 * Body: { promptId: string }
 */
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const { seriesId } = await props.params;

  let promptId: string;
  try {
    const body = await request.json();
    if (typeof body?.promptId !== "string" || !body.promptId) {
      return NextResponse.json(
        { error: "promptId is required" },
        { status: 400 }
      );
    }
    promptId = body.promptId;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // 1. Resolve series + model
  const { data: series, error: seriesErr } = await supabase
    .from("story_series")
    .select("id, image_model")
    .eq("id", seriesId)
    .single();

  if (seriesErr || !series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  const model = series.image_model as ImageModel;

  // 2. Dispatcher
  switch (model) {
    case "flux2_dev":
      return await runFlux2Generation(seriesId, promptId);

    case "hunyuan3":
      return await runHunyuanGeneration(seriesId, promptId);

    default:
      return NextResponse.json(
        { error: `Unknown image_model: ${model}` },
        { status: 500 }
      );
  }
}

async function runHunyuanGeneration(seriesId: string, promptId: string) {
  // 1. Fetch the prompt row + linked character IDs
  const { data: prompt, error: promptErr } = await supabase
    .from("story_image_prompts")
    .select(
      "id, prompt, character_id, secondary_character_id, character_name, secondary_character_name, image_type"
    )
    .eq("id", promptId)
    .single();

  if (promptErr || !prompt) {
    return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
  }

  // 2. Mark prompt as generating
  await supabase
    .from("story_image_prompts")
    .update({ status: "generating" })
    .eq("id", promptId);

  try {
    // 3. Resolve locked portrait prompts for linked characters from the
    //    base `characters` table. Portrait approval is canonical per identity
    //    (not per story), so any story using this character inherits it.
    const charIds = [
      prompt.character_id,
      prompt.secondary_character_id,
    ].filter((id): id is string => Boolean(id));

    // Build scene character blocks from `portrait_prompt_locked` (the exact
    // text that produced the approved portrait), stripped of portrait framing
    // and prepended with the character's name. Same source of truth as the
    // cover Hunyuan path. Falls back to the structured description only when
    // the locked prompt is missing (e.g. legacy approvals before the column
    // was populated) — that path emits a warning so we can spot drift.
    const charBlocks: Record<string, string> = {};
    const charApproved: Record<string, boolean> = {};
    if (charIds.length > 0) {
      const { data: chars } = await supabase
        .from("characters")
        .select("id, name, description, approved_image_id, portrait_prompt_locked")
        .in("id", charIds);

      for (const c of chars ?? []) {
        charApproved[c.id] = Boolean(c.approved_image_id);
        if (!c.name) continue;
        if (c.portrait_prompt_locked) {
          charBlocks[c.id] = buildSceneCharacterBlockFromLocked(
            c.name,
            c.portrait_prompt_locked
          );
        } else if (c.description) {
          console.warn(
            `[generate-image:hunyuan] character ${c.id} (${c.name}) has no portrait_prompt_locked; falling back to description-derived scene block`
          );
          charBlocks[c.id] = buildSceneCharacterBlock(
            c.name,
            c.description as PortraitCharacterDescription
          );
        }
      }
    }

    const primaryBlock = prompt.character_id
      ? charBlocks[prompt.character_id]
      : undefined;
    const secondaryBlock = prompt.secondary_character_id
      ? charBlocks[prompt.secondary_character_id]
      : undefined;

    // Guard — require portrait approval before generating scenes so the
    // character's appearance is anchored in the system.
    if (prompt.character_id && !charApproved[prompt.character_id]) {
      throw new Error(
        `Character "${prompt.character_name ?? prompt.character_id}" has no approved portrait yet — approve the portrait before generating scenes under hunyuan3.`
      );
    }
    if (prompt.secondary_character_id && !charApproved[prompt.secondary_character_id]) {
      throw new Error(
        `Secondary character "${prompt.secondary_character_name ?? prompt.secondary_character_id}" has no approved portrait yet.`
      );
    }

    // 4. Aspect ratio — two-character scenes get landscape, single/none get portrait
    const aspectRatio =
      prompt.character_id && prompt.secondary_character_id ? "4:3" : "3:4";

    // 5. Generate.
    //
    // Model-aware injection rule (Hunyuan / scene): character text REQUIRED.
    // HunyuanImage 3.0 has no reference-image conditioning, so identity has
    // to be carried by prompt text. The blocks above were derived from the
    // canonical `portrait_prompt_locked` (same source the cover path uses),
    // stripped of portrait framing/lighting so they don't fight the scene's
    // own composition. Flux is the opposite — see `runFlux2Generation`.
    const result = await generateHunyuanImage({
      scenePrompt: prompt.prompt,
      characterBlock: primaryBlock,
      secondaryCharacterBlock: secondaryBlock,
      aspectRatio,
    });

    // 6. Create the images row first so we have a DB-generated UUID, then
    // upload to Supabase Storage under that ID and back-fill stored_url.
    const { data: imageRow, error: imageErr } = await supabase
      .from("images")
      .insert({
        prompt: result.prompt,
        settings: {
          model: "hunyuan3",
          provider: "replicate",
          replicate_model: result.model,
          aspect_ratio: aspectRatio,
        },
        mode: deriveMode(prompt.image_type),
      })
      .select("id")
      .single();

    if (imageErr || !imageRow) {
      throw new Error(
        `Failed to create image record: ${imageErr?.message ?? "unknown"}`
      );
    }

    const imageId = imageRow.id;
    const storagePath = `stories/${imageId}.jpeg`;
    const storedUrl = await uploadRemoteImageToStorage(
      result.imageUrl,
      storagePath
    );

    await supabase
      .from("images")
      .update({ stored_url: storedUrl })
      .eq("id", imageId);

    // 7. Update prompt — link + mark generated. image_id swap is tracked via
    // previous_image_id for the revert flow.
    const { data: currentPrompt } = await supabase
      .from("story_image_prompts")
      .select("image_id")
      .eq("id", promptId)
      .single();

    await supabase
      .from("story_image_prompts")
      .update({
        status: "generated",
        image_id: imageId,
        previous_image_id: currentPrompt?.image_id ?? null,
      })
      .eq("id", promptId);

    return NextResponse.json({
      success: true,
      promptId,
      imageId,
      imageUrl: storedUrl,
      model: "hunyuan3",
    });
  } catch (err) {
    await supabase
      .from("story_image_prompts")
      .update({ status: "failed" })
      .eq("id", promptId);

    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Generation failed",
        model: "hunyuan3",
        promptId,
      },
      { status: 500 }
    );
  }
}

function deriveMode(imageType: string): "sfw" | "nsfw" {
  return imageType === "facebook_sfw" ? "sfw" : "nsfw";
}

async function runFlux2Generation(seriesId: string, promptId: string) {
  // 1. Fetch the prompt row + linked character IDs
  const { data: prompt, error: promptErr } = await supabase
    .from("story_image_prompts")
    .select(
      "id, prompt, character_id, secondary_character_id, character_name, secondary_character_name, image_type"
    )
    .eq("id", promptId)
    .single();

  if (promptErr || !prompt) {
    return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
  }

  // 2. Mark prompt as generating
  await supabase
    .from("story_image_prompts")
    .update({ status: "generating" })
    .eq("id", promptId);

  try {
    // 3. Resolve approved portrait URLs for each linked character from the
    //    base `characters` table. Flux 2 uses these as reference images
    //    (character identity anchor); the approval is canonical per identity.
    const charIds = [
      prompt.character_id,
      prompt.secondary_character_id,
    ].filter((id): id is string => Boolean(id));

    const portraitUrls: Record<string, string> = {};
    if (charIds.length > 0) {
      const { data: chars } = await supabase
        .from("characters")
        .select("id, approved_image_id")
        .in("id", charIds);

      const approvedIds = (chars ?? [])
        .map((c) => c.approved_image_id)
        .filter((id): id is string => Boolean(id));

      if (approvedIds.length > 0) {
        const { data: approvedImages } = await supabase
          .from("images")
          .select("id, stored_url, sfw_url")
          .in("id", approvedIds);

        const urlById = new Map<string, string>();
        for (const img of approvedImages ?? []) {
          const url = img.stored_url ?? img.sfw_url ?? null;
          if (url) urlById.set(img.id, url);
        }

        for (const c of chars ?? []) {
          const url = c.approved_image_id
            ? urlById.get(c.approved_image_id)
            : undefined;
          if (url) portraitUrls[c.id] = url;
        }
      }
    }

    const primaryUrl = prompt.character_id
      ? portraitUrls[prompt.character_id]
      : undefined;
    const secondaryUrl = prompt.secondary_character_id
      ? portraitUrls[prompt.secondary_character_id]
      : undefined;

    if (prompt.character_id && !primaryUrl) {
      throw new Error(
        `Character "${prompt.character_name ?? prompt.character_id}" has no approved portrait yet — approve the portrait before generating scenes under flux2_dev.`
      );
    }
    if (prompt.secondary_character_id && !secondaryUrl) {
      throw new Error(
        `Secondary character "${prompt.secondary_character_name ?? prompt.secondary_character_id}" has no approved portrait yet.`
      );
    }

    // 4. Dimensions — landscape for two characters, portrait otherwise
    const twoCharacter = Boolean(
      prompt.character_id && prompt.secondary_character_id
    );
    const width = twoCharacter ? 1024 : 768;
    const height = twoCharacter ? 768 : 1024;

    // 5. Encode portrait references as base64 for the RunPod payload
    const references: Array<{ name: string; base64: string }> = [];
    if (primaryUrl) {
      references.push({
        name: `ref_primary_${prompt.character_id}.jpeg`,
        base64: await imageUrlToBase64(primaryUrl),
      });
    }
    if (secondaryUrl) {
      references.push({
        name: `ref_secondary_${prompt.secondary_character_id}.jpeg`,
        base64: await imageUrlToBase64(secondaryUrl),
      });
    }

    // 6. Submit to RunPod — async, returns a jobId the client polls.
    //
    // Model-aware injection rule (Flux 2 Dev / scene): NO character text.
    // Character identity is anchored by the PuLID reference images above
    // (built from `characters.approved_image_id`). Adding a text block
    // describing the same character competes with the image reference and
    // measurably degrades both likeness and scene fidelity. Hunyuan is the
    // opposite — see `runHunyuanGeneration` for the text-injection branch.
    const result = await generateFlux2Image({
      scenePrompt: prompt.prompt,
      references,
      width,
      height,
    });

    // 7. Create the images row now so polling can associate status → image.
    // stored_url remains null until the status endpoint fetches the RunPod
    // output and uploads to Supabase Storage (same pattern as Juggernaut).
    const { data: imageRow, error: imgErr } = await supabase
      .from("images")
      .insert({
        prompt: result.prompt,
        settings: {
          model: "flux2_dev",
          provider: "runpod",
          seed: result.seed,
          width,
          height,
        },
        mode: deriveMode(prompt.image_type),
      })
      .select("id")
      .single();

    if (imgErr || !imageRow) {
      throw new Error(
        `Failed to create image record: ${imgErr?.message ?? "unknown"}`
      );
    }

    // 8. Register the job for the generic status poller
    await supabase.from("generation_jobs").insert({
      job_id: result.jobId,
      image_id: imageRow.id,
      status: "pending",
      cost: 0,
    });

    // 9. Link prompt → image, preserve previous_image_id for revert
    const { data: currentPrompt } = await supabase
      .from("story_image_prompts")
      .select("image_id")
      .eq("id", promptId)
      .single();

    await supabase
      .from("story_image_prompts")
      .update({
        status: "generating",
        image_id: imageRow.id,
        previous_image_id: currentPrompt?.image_id ?? null,
      })
      .eq("id", promptId);

    return NextResponse.json({
      success: true,
      promptId,
      imageId: imageRow.id,
      jobId: result.jobId,
      seed: result.seed,
      model: "flux2_dev",
    });
  } catch (err) {
    await supabase
      .from("story_image_prompts")
      .update({ status: "failed" })
      .eq("id", promptId);

    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Generation failed",
        model: "flux2_dev",
        promptId,
      },
      { status: 500 }
    );
  }
}
