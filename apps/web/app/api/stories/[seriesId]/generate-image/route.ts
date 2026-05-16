import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import {
  submitSirayImage,
  generateFlux2Image,
} from "@no-safe-word/image-gen";
import type { ImageModel } from "@no-safe-word/shared";
import { getPortraitUrlsForScene } from "@/lib/server/get-portrait-urls";
import { draftAndPersistScenePrompt } from "@/lib/server/draft-scene-prompt-from-db";
import { downscaleRefToBase64 } from "@/lib/server/downscale-ref";

/**
 * POST /api/stories/[seriesId]/generate-image
 *
 * Unified story-image generation entry point. Reads
 * story_series.image_model and dispatches to the correct backend:
 *
 *   - flux2_dev  → Flux 2 Dev via RunPod/ComfyUI (Phase 4)
 *   - hunyuan3   → HunyuanImage 3.0 via Siray.ai (text + reference-image i2i)
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

async function runHunyuanGeneration(_seriesId: string, promptId: string) {
  // 1. Fetch the prompt row. The final_prompt column is the source of
  //    truth for what gets sent to Siray — it is drafted by Mistral (see
  //    draft-scene-prompt-from-db.ts) and optionally edited by the user
  //    on the image card.
  const { data: prompt, error: promptErr } = await supabase
    .from("story_image_prompts")
    .select(
      "id, character_id, secondary_character_id, image_type, final_prompt, pose_template_id, primary_ref_type, secondary_ref_type"
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
    // 3. Auto-draft if the user has never run Mistral on this prompt.
    //    draftAndPersistScenePrompt also validates that linked characters
    //    have approved descriptions + portraits, and writes final_prompt
    //    back to the DB.
    let finalPrompt = prompt.final_prompt?.trim();
    let autoDrafted = false;
    if (!finalPrompt) {
      const drafted = await draftAndPersistScenePrompt(promptId);
      finalPrompt = drafted.finalPrompt;
      autoDrafted = true;
    }

    // 4. Aspect ratio — two-character scenes get landscape, single/none get portrait.
    const aspectRatio =
      prompt.character_id && prompt.secondary_character_id ? "5:4" : "4:5";

    // 5. Resolve i2i reference image URLs from the linked characters' approved
    //    portraits. Identity flows through these references; the text prompt
    //    that Mistral wrote intentionally avoids re-describing faces/skin/hair.
    //    The ref_type columns pick face vs body per character.
    const primaryRefType = (prompt.primary_ref_type as "face" | "body") ?? "body";
    const secondaryRefType =
      (prompt.secondary_ref_type as "face" | "body" | null) ?? "body";
    const referenceImageUrls = await getPortraitUrlsForScene([
      { characterId: prompt.character_id, refType: primaryRefType },
      { characterId: prompt.secondary_character_id, refType: secondaryRefType },
    ]);

    // 5b. If a pose template is attached AND the template explicitly opts
    //     in via send_image_to_model, also append its reference image as a
    //     3rd i2i input. Default is OFF because Hunyuan i2i bleeds the
    //     reference person's identity into the rendered character — only
    //     identity-safe references (silhouettes, line drawings) should be
    //     sent. The pose's text description is consumed by Mistral
    //     unconditionally; this flag controls only the image channel.
    if (prompt.pose_template_id) {
      const { data: poseRow } = await supabase
        .from("pose_templates")
        .select("send_image_to_model, images:image_id(stored_url)")
        .eq("id", prompt.pose_template_id)
        .single();
      if (poseRow?.send_image_to_model) {
        const linked = poseRow.images as
          | { stored_url: string | null }
          | { stored_url: string | null }[]
          | null;
        const poseImage = Array.isArray(linked) ? linked[0] : linked;
        if (poseImage?.stored_url) {
          referenceImageUrls.push(poseImage.stored_url);
        }
      }
    }

    // 6. Submit to Siray (async). The status route polls the task_id and
    //    handles download/upload/DB-update when the generation completes.
    const submitted = await submitSirayImage({
      prompt: finalPrompt,
      aspectRatio,
      referenceImageUrls,
    });

    // 7. Create the images row up-front (stored_url filled in later by the
    //    status handler).
    const { data: imageRow, error: imageErr } = await supabase
      .from("images")
      .insert({
        prompt: finalPrompt,
        settings: {
          model: "hunyuan3",
          provider: "siray",
          siray_model: submitted.model,
          siray_task_id: submitted.taskId,
          aspect_ratio: aspectRatio,
          size: submitted.size,
          reference_image_count: submitted.referenceImageCount,
          primary_ref_type: prompt.character_id ? primaryRefType : null,
          secondary_ref_type: prompt.secondary_character_id
            ? secondaryRefType
            : null,
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
    const jobId = `siray-${submitted.taskId}`;

    // 8. Register the job so the polling endpoint can find it.
    const { error: jobErr } = await supabase.from("generation_jobs").insert({
      job_id: jobId,
      image_id: imageId,
      status: "pending",
      cost: 0,
      job_type: "scene_image",
    });

    if (jobErr) {
      throw new Error(`Failed to register Siray job: ${jobErr.message}`);
    }

    // 9. Link prompt → image, preserve previous_image_id for revert. Status
    //    stays at "generating" until the status handler flips it to
    //    "generated" on completion.
    const { data: currentPrompt } = await supabase
      .from("story_image_prompts")
      .select("image_id")
      .eq("id", promptId)
      .single();

    await supabase
      .from("story_image_prompts")
      .update({
        status: "generating",
        image_id: imageId,
        previous_image_id: currentPrompt?.image_id ?? null,
        debug_data: {
          prompt_source: autoDrafted ? "mistral_auto_draft" : "stored_final_prompt",
        },
      })
      .eq("id", promptId);

    return NextResponse.json({
      success: true,
      promptId,
      imageId,
      jobId,
      model: "hunyuan3",
      auto_drafted: autoDrafted,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[generate-image:hunyuan] prompt=${promptId} failed: ${message}`,
      err
    );
    await supabase
      .from("story_image_prompts")
      .update({ status: "failed" })
      .eq("id", promptId);

    return NextResponse.json(
      {
        error: message,
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
      "id, prompt, character_id, secondary_character_id, character_name, secondary_character_name, image_type, primary_ref_type, secondary_ref_type"
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
    //    base `characters` table. Flux 2 uses these as PuLID reference images.
    //    The ref_type columns choose face vs body portrait per character:
    //      - face → characters.approved_image_id
    //      - body → characters.approved_fullbody_image_id
    const primaryRefType = (prompt.primary_ref_type as "face" | "body") ?? "body";
    const secondaryRefType =
      (prompt.secondary_ref_type as "face" | "body" | null) ?? "body";

    const charIds = [
      prompt.character_id,
      prompt.secondary_character_id,
    ].filter((id): id is string => Boolean(id));

    const facePortraitUrls: Record<string, string> = {};
    const bodyPortraitUrls: Record<string, string> = {};
    if (charIds.length > 0) {
      const { data: chars } = await supabase
        .from("characters")
        .select("id, approved_image_id, approved_fullbody_image_id")
        .in("id", charIds);

      const allImageIds = (chars ?? []).flatMap((c) =>
        [c.approved_image_id, c.approved_fullbody_image_id].filter(
          (id): id is string => Boolean(id)
        )
      );

      if (allImageIds.length > 0) {
        const { data: approvedImages } = await supabase
          .from("images")
          .select("id, stored_url, sfw_url")
          .in("id", allImageIds);

        const urlById = new Map<string, string>();
        for (const img of approvedImages ?? []) {
          const url = img.stored_url ?? img.sfw_url ?? null;
          if (url) urlById.set(img.id, url);
        }

        for (const c of chars ?? []) {
          const faceUrl = c.approved_image_id
            ? urlById.get(c.approved_image_id)
            : undefined;
          const bodyUrl = c.approved_fullbody_image_id
            ? urlById.get(c.approved_fullbody_image_id)
            : undefined;
          if (faceUrl) facePortraitUrls[c.id] = faceUrl;
          if (bodyUrl) bodyPortraitUrls[c.id] = bodyUrl;
        }
      }
    }

    const pickUrl = (charId: string, refType: "face" | "body") =>
      refType === "body"
        ? bodyPortraitUrls[charId]
        : facePortraitUrls[charId];

    const primaryUrl = prompt.character_id
      ? pickUrl(prompt.character_id, primaryRefType)
      : undefined;
    const secondaryUrl = prompt.secondary_character_id
      ? pickUrl(prompt.secondary_character_id, secondaryRefType)
      : undefined;

    if (prompt.character_id && !primaryUrl) {
      throw new Error(
        `Character "${prompt.character_name ?? prompt.character_id}" has no approved ${primaryRefType} portrait yet — approve the ${primaryRefType} portrait before generating scenes under flux2_dev.`
      );
    }
    if (prompt.secondary_character_id && !secondaryUrl) {
      throw new Error(
        `Secondary character "${prompt.secondary_character_name ?? prompt.secondary_character_id}" has no approved ${secondaryRefType} portrait yet.`
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
        base64: await downscaleRefToBase64(primaryUrl),
      });
    }
    if (secondaryUrl) {
      references.push({
        name: `ref_secondary_${prompt.secondary_character_id}.jpeg`,
        base64: await downscaleRefToBase64(secondaryUrl),
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
          primary_ref_type: prompt.character_id ? primaryRefType : null,
          secondary_ref_type: prompt.secondary_character_id
            ? secondaryRefType
            : null,
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
