import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// ============================================================
// POST /api/stories/posts/[postId]/images/[promptId]/exclude
// ============================================================
// Toggle excluded_from_publish on a story_image_prompt. Excluded rows
// stay in the dashboard (rendered dimmed) but are filtered out of the
// public chapter page and Facebook post composer.
//
// If the row being excluded is the chapter hero, the hero flag is
// cleared in the same transaction (CHECK constraint forbids the
// excluded+hero combination). The set_image_excluded SQL function
// handles the ordering — see migration 20260503100000.
//
// Body: { excluded: boolean }
// ============================================================

type ExcludeBody = { excluded: boolean };

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ postId: string; promptId: string }> }
) {
  const { postId, promptId } = await props.params;

  let body: ExcludeBody;
  try {
    body = (await request.json()) as ExcludeBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.excluded !== "boolean") {
    return NextResponse.json(
      { error: "excluded must be a boolean" },
      { status: 400 }
    );
  }

  // Validate the prompt belongs to the post before calling the RPC.
  // The RPC RAISES on missing rows, but we want a 404 with a clean
  // body rather than a Postgres exception bubbling up.
  const { data: prompt, error: lookupErr } = await supabase
    .from("story_image_prompts")
    .select("id, post_id")
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

  const { data, error: rpcErr } = await supabase.rpc("set_image_excluded", {
    p_post_id: postId,
    p_prompt_id: promptId,
    p_excluded: body.excluded,
  });

  if (rpcErr) {
    return NextResponse.json(
      { error: `Failed to update exclude flag: ${rpcErr.message}` },
      { status: 500 }
    );
  }

  // RPC returns a TABLE with out_* prefixed columns (the prefix
  // sidesteps a plpgsql variable/column ambiguity inside the
  // function body — see migration 20260503110000).
  const result = Array.isArray(data) ? data[0] : data;

  return NextResponse.json({
    ok: true,
    promptId,
    excluded: result?.out_excluded_from_publish ?? body.excluded,
    heroCleared: result?.out_hero_was_cleared ?? false,
  });
}
