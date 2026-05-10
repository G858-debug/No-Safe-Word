import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { checkAndAdvanceToImagesPending } from "@/lib/server/series-status";

/**
 * POST /api/stories/characters/[storyCharId]/approve-body
 *
 * New body-only approval endpoint introduced for the two-panel UI.
 * Persists a body image as the approved body, AND clears
 * `body_invalidated_at` (clearing any pending stale-banner state).
 *
 * Returns 400 if face is not approved — body cannot be approved before
 * face under the new state model.
 *
 * After the body write, fires checkAndAdvanceToImagesPending — the
 * series advances to 'images_pending' iff every character now has both
 * face AND body approved. No-op otherwise.
 */
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const { storyCharId } = await props.params;

  try {
    const body = await request.json();
    const { body_image_id } = body as { body_image_id?: string };

    if (!body_image_id) {
      return NextResponse.json(
        { error: "body_image_id is required" },
        { status: 400 }
      );
    }

    // 1. Resolve story_character → character. We pull series_id too so
    //    we can fire the series-status gate after the body write.
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

    // 2. Face precondition: face must already be approved.
    const { data: char, error: charErr } = await supabase
      .from("characters")
      .select("approved_image_id")
      .eq("id", storyChar.character_id)
      .single();
    if (charErr || !char) {
      return NextResponse.json(
        { error: "Character not found" },
        { status: 404 }
      );
    }
    if (!char.approved_image_id) {
      return NextResponse.json(
        { error: "Approve the face portrait before approving the body." },
        { status: 400 }
      );
    }

    // 3. Verify body image belongs to this character and is materialized.
    const { data: bodyImage, error: bodyErr } = await supabase
      .from("images")
      .select("id, character_id, stored_url, sfw_url")
      .eq("id", body_image_id)
      .single();
    if (bodyErr || !bodyImage) {
      return NextResponse.json(
        { error: "Body image not found" },
        { status: 404 }
      );
    }
    if (bodyImage.character_id !== storyChar.character_id) {
      return NextResponse.json(
        { error: "body_image_id does not belong to this character" },
        { status: 403 }
      );
    }
    if (!bodyImage.sfw_url && !bodyImage.stored_url) {
      return NextResponse.json(
        { error: "Body image has no URL yet — is generation complete?" },
        { status: 400 }
      );
    }

    // 4. Single UPDATE — set approved body, clear staleness signal.
    const { error: updErr } = await supabase
      .from("characters")
      .update({
        approved_fullbody_image_id: body_image_id,
        body_invalidated_at: null,
      })
      .eq("id", storyChar.character_id);

    if (updErr) {
      return NextResponse.json(
        { error: `Failed to approve body: ${updErr.message}` },
        { status: 500 }
      );
    }

    // 5. Body may have been the last unmet condition for series-status
    //    advancement. Helper is idempotent — no-op if face is missing
    //    on any sibling character or status is already past draft.
    await checkAndAdvanceToImagesPending(supabase, storyChar.series_id);

    return NextResponse.json({
      story_character_id: storyCharId,
      character_id: storyChar.character_id,
      approved_body_image_id: body_image_id,
    });
  } catch (err) {
    console.error("[approve-body] error:", err);
    return NextResponse.json(
      {
        error: "Approval failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
