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
        approved_image_id, approved_fullbody_image_id,
        approved_seed, approved_prompt, portrait_prompt_locked
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
    approved_fullbody_image_id: string | null;
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
      return [base?.approved_image_id, base?.approved_fullbody_image_id];
    })
    .filter((id): id is string => Boolean(id));

  type ImageMeta = {
    url: string;
    requested_width: number | null;
    requested_height: number | null;
    actual_width: number | null;
    actual_height: number | null;
    dimension_fallback_reason: string | null;
  };
  let imageMeta: Record<string, ImageMeta> = {};
  if (imageIds.length > 0) {
    const { data: images } = await supabase
      .from("images")
      .select(
        "id, stored_url, sfw_url, requested_width, requested_height, actual_width, actual_height, dimension_fallback_reason"
      )
      .in("id", imageIds);

    if (images) {
      imageMeta = Object.fromEntries(
        images.map((img) => [
          img.id,
          {
            url: img.sfw_url || img.stored_url || "",
            requested_width: img.requested_width,
            requested_height: img.requested_height,
            actual_width: img.actual_width,
            actual_height: img.actual_height,
            dimension_fallback_reason: img.dimension_fallback_reason,
          },
        ])
      );
    }
  }

  const characters = storyCharacters.map((sc) => {
    const base = baseOf(sc.characters);
    const faceMeta = base?.approved_image_id
      ? imageMeta[base.approved_image_id]
      : undefined;
    const bodyMeta = base?.approved_fullbody_image_id
      ? imageMeta[base.approved_fullbody_image_id]
      : undefined;
    return {
      id: sc.id,
      role: sc.role,
      prose_description: sc.prose_description,
      character_id: base?.id ?? null,
      name: base?.name ?? null,
      description: base?.description ?? null,
      approved_image_id: base?.approved_image_id ?? null,
      approved_fullbody_image_id: base?.approved_fullbody_image_id ?? null,
      approved_seed: base?.approved_seed ?? null,
      approved_prompt: base?.approved_prompt ?? null,
      approved_image_url: faceMeta?.url ?? null,
      approved_fullbody_image_url: bodyMeta?.url ?? null,
      portrait_prompt_locked: base?.portrait_prompt_locked ?? null,
      // Visible-fallback metadata. Populated when Siray rejected the
      // requested portrait size and we retried at the fallback. Null
      // dimensions = pre-instrumentation row (no fallback to surface).
      face_image_dimensions: faceMeta
        ? {
            requested_width: faceMeta.requested_width,
            requested_height: faceMeta.requested_height,
            actual_width: faceMeta.actual_width,
            actual_height: faceMeta.actual_height,
            fallback_reason: faceMeta.dimension_fallback_reason,
          }
        : null,
      body_image_dimensions: bodyMeta
        ? {
            requested_width: bodyMeta.requested_width,
            requested_height: bodyMeta.requested_height,
            actual_width: bodyMeta.actual_width,
            actual_height: bodyMeta.actual_height,
            fallback_reason: bodyMeta.dimension_fallback_reason,
          }
        : null,
      // Derived flag — the UI reads `approved`.
      approved: Boolean(base?.approved_image_id),
    };
  });

  return NextResponse.json({ characters });
}
