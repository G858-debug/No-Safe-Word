import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// POST /api/stories/characters/[storyCharId]/approve — Approve a character
// portrait or full-body image. Writes to the base `characters` table so the
// approval persists across every story that features this character.
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    const body = await request.json();
    const { image_id, seed, prompt, type: imageType } = body as {
      image_id: string;
      seed?: number;
      prompt?: string;
      type?: "portrait" | "fullBody";
    };
    const isFullBody = imageType === "fullBody";

    if (!image_id) {
      return NextResponse.json(
        { error: "image_id is required" },
        { status: 400 }
      );
    }

    // 1. Resolve the base character via the story_characters linkage
    const { data: storyChar, error: scError } = await supabase
      .from("story_characters")
      .select("id, character_id, series_id")
      .eq("id", storyCharId)
      .single();

    if (scError || !storyChar) {
      return NextResponse.json(
        { error: "Story character not found" },
        { status: 404 }
      );
    }

    // 2. Fetch image URL, stored_url, prompt, seed
    const { data: image, error: imgError } = await supabase
      .from("images")
      .select("id, sfw_url, stored_url, settings, prompt")
      .eq("id", image_id)
      .single();

    if (imgError || !image) {
      return NextResponse.json(
        { error: "Image not found" },
        { status: 404 }
      );
    }

    if (!image.sfw_url && !image.stored_url) {
      return NextResponse.json(
        { error: "Image has no URL yet — is the generation complete?" },
        { status: 400 }
      );
    }

    const imgSettings = image.settings as Record<string, unknown> | null;
    const resolvedSeed =
      seed ??
      (imgSettings?.seed != null && imgSettings.seed !== -1
        ? Number(imgSettings.seed)
        : null);

    // 3. Ensure image is in Supabase Storage
    let publicUrl: string;

    if (image.stored_url) {
      publicUrl = image.stored_url;
    } else {
      const imageResponse = await fetch(image.sfw_url!);
      if (!imageResponse.ok) {
        return NextResponse.json(
          { error: `Failed to download image: ${imageResponse.statusText}` },
          { status: 502 }
        );
      }

      const buffer = await imageResponse.arrayBuffer();
      const contentType =
        imageResponse.headers.get("content-type") || "image/jpeg";
      const ext = contentType.includes("png") ? "png" : "jpeg";
      const storagePath = `characters/${image_id}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("story-images")
        .upload(storagePath, buffer, {
          contentType,
          upsert: true,
        });

      if (uploadError) {
        return NextResponse.json(
          { error: `Storage upload failed: ${uploadError.message}` },
          { status: 500 }
        );
      }

      const { data: urlData } = supabase.storage
        .from("story-images")
        .getPublicUrl(storagePath);
      publicUrl = urlData.publicUrl;

      await supabase
        .from("images")
        .update({ stored_url: publicUrl })
        .eq("id", image_id);
    }

    // 4. Write portrait/fullbody state to the BASE `characters` row.
    //    This makes the approved face reusable across every story.
    const lockedPortraitPrompt = isFullBody
      ? null
      : prompt ?? image.prompt ?? null;

    const updateFields = isFullBody
      ? {
          approved_fullbody_image_id: image_id,
          approved_fullbody_seed: resolvedSeed,
          approved_fullbody_prompt: prompt ?? null,
        }
      : {
          approved_image_id: image_id,
          approved_seed: resolvedSeed,
          approved_prompt: prompt ?? null,
          portrait_prompt_locked: lockedPortraitPrompt,
        };

    const { error: updateError } = await supabase
      .from("characters")
      .update(updateFields)
      .eq("id", storyChar.character_id);

    if (updateError) {
      return NextResponse.json(
        { error: `Failed to approve character: ${updateError.message}` },
        { status: 500 }
      );
    }

    // 5. If every character in this series has both portrait + fullbody
    //    approved on the base row, advance series to images_pending.
    const { data: seriesChars } = await supabase
      .from("story_characters")
      .select(
        "character_id, characters:character_id ( approved_image_id, approved_fullbody_image_id )"
      )
      .eq("series_id", storyChar.series_id);

    if (seriesChars && seriesChars.length > 0) {
      const allReady = seriesChars.every((sc) => {
        const base = sc.characters as
          | { approved_image_id: string | null; approved_fullbody_image_id: string | null }
          | { approved_image_id: string | null; approved_fullbody_image_id: string | null }[]
          | null;
        // PostgREST returns a single row here, but TS types it as array. Normalize.
        const row = Array.isArray(base) ? base[0] : base;
        return Boolean(row?.approved_image_id && row?.approved_fullbody_image_id);
      });

      if (allReady) {
        await supabase
          .from("story_series")
          .update({ status: "images_pending" })
          .eq("id", storyChar.series_id);
      }
    }

    return NextResponse.json({
      story_character_id: storyCharId,
      character_id: storyChar.character_id,
      stored_url: publicUrl,
    });
  } catch (err) {
    console.error("Character approval failed:", err);
    return NextResponse.json(
      {
        error: "Approval failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
