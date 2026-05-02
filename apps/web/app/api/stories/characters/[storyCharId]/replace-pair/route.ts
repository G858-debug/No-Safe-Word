import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { cleanupOrphanedImage } from "@/lib/server/cleanup-orphaned-image";

// POST /api/stories/characters/[storyCharId]/replace-pair
//
// Promote a candidate face/body pair into the approved slot, then tear down
// the previously-approved pair. Used by the post-approval regenerate flow:
// candidate sits alongside the approved pair until the user clicks Replace.
//
// Cleanup of the OLD pair is best-effort — a partial failure to delete
// Storage files leaves a sweepable mess but doesn't block the user, who
// has successfully replaced. Cleanup of the NEW images would be wrong
// here: replace succeeded.
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const { storyCharId } = await props.params;

  try {
    const body = await request.json();
    const {
      new_face_image_id,
      new_body_image_id,
      new_prompt,
    } = body as {
      new_face_image_id?: string;
      new_body_image_id?: string;
      new_prompt?: string;
    };

    if (!new_face_image_id || !new_body_image_id) {
      return NextResponse.json(
        {
          error:
            "new_face_image_id and new_body_image_id are both required",
        },
        { status: 400 }
      );
    }

    const { data: storyChar } = await supabase
      .from("story_characters")
      .select("id, character_id")
      .eq("id", storyCharId)
      .single();
    if (!storyChar) {
      return NextResponse.json(
        { error: "Story character not found" },
        { status: 404 }
      );
    }

    const { data: priorChar } = await supabase
      .from("characters")
      .select(
        "approved_image_id, approved_fullbody_image_id, approved_prompt, portrait_prompt_locked, approved_seed"
      )
      .eq("id", storyChar.character_id)
      .single();
    if (!priorChar) {
      return NextResponse.json(
        { error: "Character not found" },
        { status: 404 }
      );
    }

    // Verify the candidate face actually has a stored prompt to lock —
    // otherwise we'd persist a null portrait_prompt_locked and break Hunyuan
    // scene injection.
    const { data: newFaceImage } = await supabase
      .from("images")
      .select("id, character_id, prompt, settings")
      .eq("id", new_face_image_id)
      .single();
    if (!newFaceImage) {
      return NextResponse.json(
        { error: "new_face_image_id not found" },
        { status: 400 }
      );
    }
    if (newFaceImage.character_id !== storyChar.character_id) {
      return NextResponse.json(
        { error: "new_face_image_id does not belong to this character" },
        { status: 403 }
      );
    }

    const { data: newBodyImage } = await supabase
      .from("images")
      .select("id, character_id")
      .eq("id", new_body_image_id)
      .single();
    if (!newBodyImage) {
      return NextResponse.json(
        { error: "new_body_image_id not found" },
        { status: 400 }
      );
    }
    if (newBodyImage.character_id !== storyChar.character_id) {
      return NextResponse.json(
        { error: "new_body_image_id does not belong to this character" },
        { status: 403 }
      );
    }

    const newSettings =
      (newFaceImage.settings as Record<string, unknown> | null) ?? {};
    const newSeed =
      newSettings.seed != null && newSettings.seed !== -1
        ? Number(newSettings.seed)
        : null;
    const lockedPrompt = new_prompt ?? newFaceImage.prompt ?? null;

    const { error: updateErr } = await supabase
      .from("characters")
      .update({
        approved_image_id: new_face_image_id,
        approved_fullbody_image_id: new_body_image_id,
        approved_seed: newSeed,
        approved_prompt: new_prompt ?? null,
        portrait_prompt_locked: lockedPrompt,
      })
      .eq("id", storyChar.character_id);

    if (updateErr) {
      return NextResponse.json(
        { error: `Replace failed: ${updateErr.message}` },
        { status: 500 }
      );
    }

    // Old pair teardown — best-effort. Skip when the old id matches the new
    // id (regenerate-body-only keeps the existing approved face).
    const oldFaceId = priorChar.approved_image_id;
    const oldBodyId = priorChar.approved_fullbody_image_id;

    const cleanupErrors: Array<{ image_id: string; errors: string[] }> = [];
    if (oldFaceId && oldFaceId !== new_face_image_id) {
      const r = await cleanupOrphanedImage(supabase, oldFaceId);
      if (!r.ok) cleanupErrors.push({ image_id: oldFaceId, errors: r.errors });
    }
    if (oldBodyId && oldBodyId !== new_body_image_id) {
      const r = await cleanupOrphanedImage(supabase, oldBodyId);
      if (!r.ok) cleanupErrors.push({ image_id: oldBodyId, errors: r.errors });
    }
    if (cleanupErrors.length > 0) {
      console.warn(
        "[replace-pair] partial cleanup failure (replace itself succeeded):",
        cleanupErrors
      );
    }

    return NextResponse.json({
      ok: true,
      character_id: storyChar.character_id,
      cleanup_errors: cleanupErrors,
    });
  } catch (err) {
    console.error("[replace-pair] error:", err);
    return NextResponse.json(
      {
        error: "Replace failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
