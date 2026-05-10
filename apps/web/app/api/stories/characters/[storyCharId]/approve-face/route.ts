import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { checkAndAdvanceToImagesPending } from "@/lib/server/series-status";

/**
 * POST /api/stories/characters/[storyCharId]/approve-face
 *
 * Persists a face image as the canonical approved face on the base
 * `characters` row. Does NOT touch any body column. Includes the
 * sfw_url → Storage upload step for newly-completed face images.
 *
 * Series-status advancement to 'images_pending' fires via
 * checkAndAdvanceToImagesPending — gated on every character in the
 * series having both face AND body approved. Calling this endpoint
 * when face approval was the last unmet condition triggers the
 * advance; otherwise it's a no-op.
 */
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const { storyCharId } = await props.params;

  try {
    const body = await request.json();
    const { face_image_id, prompt } = body as {
      face_image_id?: string;
      prompt?: string;
    };

    if (!face_image_id) {
      return NextResponse.json(
        { error: "face_image_id is required" },
        { status: 400 }
      );
    }

    // 1. Resolve story_character → character.
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

    // 2. Fetch face image, verify it belongs to this character and is
    //    materialized.
    const { data: faceImage, error: faceErr } = await supabase
      .from("images")
      .select("id, character_id, sfw_url, stored_url, settings, prompt")
      .eq("id", face_image_id)
      .single();
    if (faceErr || !faceImage) {
      return NextResponse.json(
        { error: "Face image not found" },
        { status: 404 }
      );
    }
    if (faceImage.character_id !== storyChar.character_id) {
      return NextResponse.json(
        { error: "face_image_id does not belong to this character" },
        { status: 403 }
      );
    }
    if (!faceImage.sfw_url && !faceImage.stored_url) {
      return NextResponse.json(
        { error: "Face image has no URL yet — is generation complete?" },
        { status: 400 }
      );
    }

    // 3. Ensure face image lives in Supabase Storage. If `stored_url` is
    //    already set, skip the download.
    let publicUrl: string;
    if (faceImage.stored_url) {
      publicUrl = faceImage.stored_url;
    } else {
      const imageResponse = await fetch(faceImage.sfw_url!);
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
      const storagePath = `characters/${face_image_id}.${ext}`;

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
        .eq("id", face_image_id);
    }

    // 4. Write face approval to base `characters`. Body columns untouched.
    const imgSettings = faceImage.settings as Record<string, unknown> | null;
    const resolvedSeed =
      imgSettings?.seed != null && imgSettings.seed !== -1
        ? Number(imgSettings.seed)
        : null;
    const lockedPortraitPrompt = prompt ?? faceImage.prompt ?? null;

    const { error: faceUpdateError } = await supabase
      .from("characters")
      .update({
        approved_image_id: face_image_id,
        approved_seed: resolvedSeed,
        approved_prompt: prompt ?? null,
        portrait_prompt_locked: lockedPortraitPrompt,
      })
      .eq("id", storyChar.character_id);

    if (faceUpdateError) {
      return NextResponse.json(
        { error: `Failed to approve face: ${faceUpdateError.message}` },
        { status: 500 }
      );
    }

    // 5. Maybe advance series status to 'images_pending'. Helper
    //    requires every character in the series to have both face AND
    //    body approved before advancing; idempotent and a no-op
    //    otherwise.
    await checkAndAdvanceToImagesPending(supabase, storyChar.series_id);

    return NextResponse.json({
      story_character_id: storyCharId,
      character_id: storyChar.character_id,
      approved_face_image_id: face_image_id,
      stored_url: publicUrl,
    });
  } catch (err) {
    console.error("[approve-face] error:", err);
    return NextResponse.json(
      {
        error: "Approval failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
