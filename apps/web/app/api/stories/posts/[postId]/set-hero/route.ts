import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// ============================================================
// POST /api/stories/posts/[postId]/set-hero
// ============================================================
// Flags exactly one facebook_sfw image as the chapter hero, or clears
// the flag entirely. The website chapter page renders only the flagged
// image at the top of the chapter; all other facebook_sfw rows are
// excluded from the public site.
//
// Body:
//   { promptId: string }   -> set this prompt as the hero
//   { promptId: null }     -> clear the hero (zero flagged on this chapter)
//
// Atomicity: delegated to the set_chapter_hero(p_post_id, p_prompt_id)
// SQL function. The function runs in a single transaction; the partial
// unique index story_image_prompts_one_hero_per_post backstops it
// against concurrent writers.
// ============================================================

type SetHeroBody = { promptId: string | null };

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ postId: string }> }
) {
  const { postId } = await props.params;

  let body: SetHeroBody;
  try {
    body = (await request.json()) as SetHeroBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { promptId } = body;
  if (promptId !== null && typeof promptId !== "string") {
    return NextResponse.json(
      { error: "promptId must be a string or null" },
      { status: 400 }
    );
  }

  // Validate the prompt belongs to this post and is a facebook_sfw row.
  // The CHECK constraint would block a misuse at write time, but we
  // want a 4xx with a clear error rather than a Postgres exception.
  if (promptId !== null) {
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
    if (prompt.image_type !== "facebook_sfw") {
      return NextResponse.json(
        { error: "Only facebook_sfw images can be set as chapter hero" },
        { status: 400 }
      );
    }
  }

  // The generated supabase function type marks p_prompt_id as string,
  // but the SQL function explicitly handles NULL (clears all heroes for
  // the post). Cast to satisfy the generated types — a JS null becomes
  // JSON null and PostgREST forwards it as SQL NULL.
  const { error: rpcErr } = await supabase.rpc("set_chapter_hero", {
    p_post_id: postId,
    p_prompt_id: promptId as unknown as string,
  });

  if (rpcErr) {
    return NextResponse.json(
      { error: `Failed to set hero: ${rpcErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, postId, heroPromptId: promptId });
}
