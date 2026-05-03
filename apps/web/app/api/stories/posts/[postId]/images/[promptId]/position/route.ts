import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// ============================================================
// POST /api/stories/posts/[postId]/images/[promptId]/position
// ============================================================
// Set or clear position_after_word on a website-side image prompt.
// Used by the Publish tab's drag-to-reposition flow.
//
// Body:
//   { positionAfterWord: number }   -> place the image after that word
//   { positionAfterWord: null }     -> clear (image becomes orphan,
//                                      shown in the "Unplaced images"
//                                      tray on the Publish tab)
//
// Only website_only and website_nsfw_paired rows are positionable.
// facebook_sfw rows have no position_after_word concept; attempting
// to set one returns 400.
// ============================================================

type PositionBody = { positionAfterWord: number | null };

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ postId: string; promptId: string }> }
) {
  const { postId, promptId } = await props.params;

  let body: PositionBody;
  try {
    body = (await request.json()) as PositionBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { positionAfterWord } = body;

  if (positionAfterWord !== null) {
    if (
      typeof positionAfterWord !== "number" ||
      !Number.isFinite(positionAfterWord) ||
      !Number.isInteger(positionAfterWord) ||
      positionAfterWord < 0
    ) {
      return NextResponse.json(
        { error: "positionAfterWord must be a non-negative integer or null" },
        { status: 400 }
      );
    }
  }

  const { data: prompt, error: lookupErr } = await supabase
    .from("story_image_prompts")
    .select("id, post_id, image_type")
    .eq("id", promptId)
    .single();

  if (lookupErr || !prompt) {
    return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
  }
  if (prompt.post_id !== postId) {
    return NextResponse.json(
      { error: "Prompt does not belong to this post" },
      { status: 400 }
    );
  }
  if (
    prompt.image_type !== "website_only" &&
    prompt.image_type !== "website_nsfw_paired"
  ) {
    return NextResponse.json(
      {
        error:
          "Only website_only and website_nsfw_paired images can be repositioned",
      },
      { status: 400 }
    );
  }

  const { error: updateErr } = await supabase
    .from("story_image_prompts")
    .update({ position_after_word: positionAfterWord })
    .eq("id", promptId);

  if (updateErr) {
    return NextResponse.json(
      { error: `Failed to update position: ${updateErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    promptId,
    positionAfterWord,
  });
}
