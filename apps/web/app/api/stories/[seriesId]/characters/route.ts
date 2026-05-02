import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// GET /api/stories/[seriesId]/characters — List characters linked to this
// series. Portrait state is canonical on the base `characters` row and is
// returned alongside the story-specific linkage.
export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const params = await props.params;
  const { seriesId } = params;

  const { data: storyCharacters, error } = await supabase
    .from("story_characters")
    .select(
      `
      id, role, prose_description,
      characters:character_id (
        id, name, description,
        approved_image_id, approved_seed, approved_prompt, portrait_prompt_locked
      )
    `
    )
    .eq("series_id", seriesId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!storyCharacters || storyCharacters.length === 0) {
    return NextResponse.json({ characters: [] });
  }

  // PostgREST types the joined row as an array — normalize.
  type BaseChar = {
    id: string;
    name: string;
    description: unknown;
    approved_image_id: string | null;
    approved_seed: number | null;
    approved_prompt: string | null;
    portrait_prompt_locked: string | null;
  };

  const baseOf = (row: unknown): BaseChar | null => {
    if (!row) return null;
    return Array.isArray(row) ? (row[0] as BaseChar) ?? null : (row as BaseChar);
  };

  // Collect image ids to resolve URLs in one query
  const imageIds = storyCharacters
    .flatMap((sc) => {
      const base = baseOf(sc.characters);
      return [base?.approved_image_id];
    })
    .filter((id): id is string => Boolean(id));

  let imageUrls: Record<string, string> = {};
  if (imageIds.length > 0) {
    const { data: images } = await supabase
      .from("images")
      .select("id, stored_url, sfw_url")
      .in("id", imageIds);

    if (images) {
      imageUrls = Object.fromEntries(
        images.map((img) => [img.id, img.sfw_url || img.stored_url || ""])
      );
    }
  }

  const characters = storyCharacters.map((sc) => {
    const base = baseOf(sc.characters);
    return {
      id: sc.id,
      role: sc.role,
      prose_description: sc.prose_description,
      character_id: base?.id ?? null,
      name: base?.name ?? null,
      description: base?.description ?? null,
      approved_image_id: base?.approved_image_id ?? null,
      approved_seed: base?.approved_seed ?? null,
      approved_prompt: base?.approved_prompt ?? null,
      approved_image_url: base?.approved_image_id
        ? imageUrls[base.approved_image_id] || null
        : null,
      portrait_prompt_locked: base?.portrait_prompt_locked ?? null,
      // Derived flag — the UI reads `approved`.
      approved: Boolean(base?.approved_image_id),
    };
  });

  return NextResponse.json({ characters });
}
