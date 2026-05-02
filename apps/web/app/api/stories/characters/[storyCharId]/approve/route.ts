import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { cleanupOrphanedImage } from "@/lib/server/cleanup-orphaned-image";

// POST /api/stories/characters/[storyCharId]/approve — Approve a character
// portrait. Pass 3: dual-image — the face is the canonical identity and the
// body is its paired preview. Both are written together; either both succeed
// or both are rolled back and torn down.
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    const body = await request.json();
    const { face_image_id, body_image_id, prompt } = body as {
      face_image_id?: string;
      body_image_id?: string;
      prompt?: string;
    };

    if (!face_image_id || !body_image_id) {
      return NextResponse.json(
        { error: "face_image_id and body_image_id are both required" },
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

    // 2. Fetch BOTH images — face is the canonical identity, body is the
    //    paired preview rendered alongside it.
    const { data: faceImage, error: faceErr } = await supabase
      .from("images")
      .select("id, sfw_url, stored_url, settings, prompt")
      .eq("id", face_image_id)
      .single();
    if (faceErr || !faceImage) {
      return NextResponse.json(
        { error: "Face image not found" },
        { status: 404 }
      );
    }
    if (!faceImage.sfw_url && !faceImage.stored_url) {
      return NextResponse.json(
        { error: "Face image has no URL yet — is generation complete?" },
        { status: 400 }
      );
    }

    const { data: bodyImage, error: bodyErr } = await supabase
      .from("images")
      .select("id, stored_url, sfw_url")
      .eq("id", body_image_id)
      .single();
    if (bodyErr || !bodyImage) {
      return NextResponse.json(
        { error: "Body image not found" },
        { status: 404 }
      );
    }
    if (!bodyImage.sfw_url && !bodyImage.stored_url) {
      return NextResponse.json(
        { error: "Body image has no URL yet — is generation complete?" },
        { status: 400 }
      );
    }

    const imgSettings = faceImage.settings as Record<string, unknown> | null;
    const resolvedSeed =
      imgSettings?.seed != null && imgSettings.seed !== -1
        ? Number(imgSettings.seed)
        : null;

    // 3. Ensure face image is in Supabase Storage. The body image's URL
    //    isn't republished here — we only need its image_id for the FK.
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

    // 4. Write portrait state to the BASE `characters` row. Pass 3 writes
    //    face + body together. The face write happens first so the existing
    //    series-readiness logic (gated on approved_image_id) still works
    //    even if the body write fails — but we'll roll the face back below
    //    if the body update errors.
    //
    // approved_fullbody_image_id was killed in Pass 2 (separate body
    // approval gate, dormant column) and resurrected in Pass 3 with
    // different semantics: it now stores the body-preview image that
    // pairs with the approved face. There is no separate "body
    // approval" — face and body are approved together. Despite the
    // column name, this is NOT an independent approval; it's a
    // paired-preview reference.
    const lockedPortraitPrompt = prompt ?? faceImage.prompt ?? null;

    // Snapshot prior state for rollback. NOTE: this read + the face write
    // below are not atomic — a concurrent update landing between the two
    // would be lost. Acceptable under Pass 3's single-user, single-card
    // assumption; revisit if multi-author editing of one character row
    // becomes a real workflow.
    const { data: priorChar } = await supabase
      .from("characters")
      .select(
        "approved_image_id, approved_seed, approved_prompt, portrait_prompt_locked, approved_fullbody_image_id"
      )
      .eq("id", storyChar.character_id)
      .single();

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
      // Nothing committed yet — clean up both candidate images and bail.
      await cleanupOrphanedImage(supabase, face_image_id);
      await cleanupOrphanedImage(supabase, body_image_id);
      return NextResponse.json(
        { error: `Failed to approve face: ${faceUpdateError.message}` },
        { status: 500 }
      );
    }

    const { error: bodyUpdateError } = await supabase
      .from("characters")
      .update({ approved_fullbody_image_id: body_image_id })
      .eq("id", storyChar.character_id);

    if (bodyUpdateError) {
      // Roll the face write back to its pre-call state, then tear down both
      // candidates. The user is returned to whatever state existed before
      // (likely pre_approval client-side, with pending images in flight).
      if (priorChar) {
        await supabase
          .from("characters")
          .update({
            approved_image_id: priorChar.approved_image_id,
            approved_seed: priorChar.approved_seed,
            approved_prompt: priorChar.approved_prompt,
            portrait_prompt_locked: priorChar.portrait_prompt_locked,
          })
          .eq("id", storyChar.character_id);
      }
      await cleanupOrphanedImage(supabase, face_image_id);
      await cleanupOrphanedImage(supabase, body_image_id);
      return NextResponse.json(
        { error: `Failed to approve body: ${bodyUpdateError.message}` },
        { status: 500 }
      );
    }

    // 5. If every character in this series has a portrait approved on the
    //    base row, advance series to images_pending.
    const { data: seriesChars } = await supabase
      .from("story_characters")
      .select(
        "character_id, characters:character_id ( approved_image_id )"
      )
      .eq("series_id", storyChar.series_id);

    if (seriesChars && seriesChars.length > 0) {
      const allReady = seriesChars.every((sc) => {
        const base = sc.characters as
          | { approved_image_id: string | null }
          | { approved_image_id: string | null }[]
          | null;
        // PostgREST returns a single row here, but TS types it as array. Normalize.
        const row = Array.isArray(base) ? base[0] : base;
        return Boolean(row?.approved_image_id);
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
      approved_face_image_id: face_image_id,
      approved_body_image_id: body_image_id,
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
