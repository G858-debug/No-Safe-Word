import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import {
  generateCharacterPortrait,
  generateFlux2Image,
  buildCharacterPortraitPrompt,
  type PortraitCharacterDescription,
} from "@no-safe-word/image-gen";
import { uploadRemoteImageToStorage } from "@/lib/server/upload-generated-image";
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
    // hunyuan3 → synchronous Siray call, handled below. No reference
    // images yet — this IS the portrait being created.

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

    console.log(`[StoryPublisher] Generating ${stage} (${isMale ? 'male' : 'female'}) for: ${character.name} [model=${imageModel}]`);

    // ── hunyuan3 portrait path (synchronous Siray, t2i — no references) ──
    if (imageModel === "hunyuan3") {
      const promptText =
        customPrompt ??
        buildCharacterPortraitPrompt(desc as PortraitCharacterDescription, stage);

      const generatedUrl = await generateCharacterPortrait(promptText);

      const { data: imageRow, error: imgErr } = await supabase
        .from("images")
        .insert({
          character_id: character.id,
          prompt: promptText,
          settings: {
            model: "hunyuan3",
            provider: "siray",
            siray_model: "hunyuan3-instruct",
            aspect_ratio: "3:4",
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

      const imageId = imageRow.id;
      const storagePath = `characters/${imageId}.jpeg`;
      const storedUrl = await uploadRemoteImageToStorage(
        generatedUrl,
        storagePath
      );

      await supabase
        .from("images")
        .update({ stored_url: storedUrl })
        .eq("id", imageId);

      return NextResponse.json({
        jobId: `siray-${imageId}`,
        imageId,
        imageUrl: storedUrl,
        model: "hunyuan3",
        promptUsed: promptText,
      });
    }

    // ── flux2_dev portrait path (async RunPod on Flux 2 Dev endpoint) ──
    // Generates the portrait that will itself become the reference image
    // used for all subsequent scene generations. No references on input —
    // this IS the reference being created.
    if (imageModel === "flux2_dev") {
      const promptText =
        customPrompt ??
        buildCharacterPortraitPrompt(desc as PortraitCharacterDescription, stage);

      const flux2Result = await generateFlux2Image({
        scenePrompt: promptText,
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
