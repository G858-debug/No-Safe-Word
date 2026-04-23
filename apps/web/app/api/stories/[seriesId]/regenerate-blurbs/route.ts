import { NextRequest, NextResponse } from "next/server";
import type { Json } from "@no-safe-word/shared";
import { supabase } from "@no-safe-word/story-engine";
import { assembleFullStoryText } from "@/lib/server/assemble-story-text";
import {
  generateBlurbsForStory,
  type BlurbCharacterInput,
} from "@/lib/server/generate-blurbs";

// Node runtime — the Anthropic SDK and the assemble-story helper both
// use Node APIs.
export const runtime = "nodejs";
// Claude calls can take 20–45s for a story of ~7000 characters with
// claude-opus-4-7; give the route headroom before Vercel/Railway cuts.
export const maxDuration = 120;

// ============================================================
// POST /api/stories/[seriesId]/regenerate-blurbs
// ============================================================
// Calls claude-opus-4-7 to generate 3 short + 3 long blurb variants
// for a story, overwriting any existing variants and clearing
// selections (user reselects from the new variants).
//
// Precondition: at least one story_posts row. Any series status is
// allowed — admin may regenerate for draft or published stories.
// ============================================================

export async function POST(
  _request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const { seriesId } = await props.params;

  // 1. Load series (any status — the prompt explicitly allows regen
  //    from drafts through published)
  const { data: series, error: seriesErr } = await supabase
    .from("story_series")
    .select("id, title, hashtag, description")
    .eq("id", seriesId)
    .single();

  if (seriesErr || !series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  // 2. Precondition: story has posts
  const { count: postCount, error: countErr } = await supabase
    .from("story_posts")
    .select("id", { count: "exact", head: true })
    .eq("series_id", seriesId);

  if (countErr) {
    return NextResponse.json(
      { error: `Failed to count posts: ${countErr.message}` },
      { status: 500 }
    );
  }
  if ((postCount ?? 0) === 0) {
    return NextResponse.json(
      {
        error:
          "Cannot regenerate blurbs: no story posts found. Import or write posts before calling this endpoint.",
      },
      { status: 400 }
    );
  }

  // 3. Assemble full story text
  const fullStoryText = await assembleFullStoryText(seriesId);
  if (!fullStoryText) {
    return NextResponse.json(
      {
        error:
          "Assembled story text is empty — posts exist but website_content is blank across all of them.",
      },
      { status: 400 }
    );
  }

  // 4. Fetch character data with prose descriptions
  const { data: storyChars, error: charsErr } = await supabase
    .from("story_characters")
    .select("role, prose_description, character_id")
    .eq("series_id", seriesId);

  if (charsErr) {
    return NextResponse.json(
      { error: `Failed to load characters: ${charsErr.message}` },
      { status: 500 }
    );
  }

  const charIds = (storyChars ?? [])
    .map((c) => c.character_id)
    .filter((id): id is string => Boolean(id));

  const nameMap = new Map<string, string>();
  if (charIds.length > 0) {
    const { data: charRows } = await supabase
      .from("characters")
      .select("id, name")
      .in("id", charIds);
    for (const row of charRows ?? []) {
      nameMap.set(row.id, row.name);
    }
  }

  const characters: BlurbCharacterInput[] = (storyChars ?? []).map((c) => ({
    name: nameMap.get(c.character_id) ?? "Unknown",
    role: c.role ?? "",
    proseDescription: c.prose_description,
  }));

  // 5. Call Claude
  let result;
  try {
    result = await generateBlurbsForStory({
      seriesId,
      title: series.title,
      hashtag: series.hashtag,
      description: series.description,
      fullStoryText,
      characters,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Claude error";
    console.error(`[regenerate-blurbs][${seriesId}] Claude call failed:`, message);
    // 502 — upstream (Anthropic) failed or returned malformed output.
    return NextResponse.json(
      { error: `Blurb generation failed: ${message}` },
      { status: 502 }
    );
  }

  // 6. Overwrite variants + clear selections. The user reselects from
  //    the new variants via the existing Blurbs tab; keeping the old
  //    selection would point at the wrong text after overwrite.
  const { error: updErr } = await supabase
    .from("story_series")
    .update({
      blurb_short_variants: result.blurbShortVariants as unknown as Json,
      blurb_long_variants: result.blurbLongVariants as unknown as Json,
      blurb_short_selected: null,
      blurb_long_selected: null,
    })
    .eq("id", seriesId);

  if (updErr) {
    return NextResponse.json(
      { error: `Failed to save blurbs: ${updErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    seriesId,
    blurbShortVariants: result.blurbShortVariants,
    blurbLongVariants: result.blurbLongVariants,
  });
}
