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
        approved_seed, approved_prompt, portrait_prompt_locked,
        archetype_tag, vibe_line, wants, needs, defining_quote,
        watch_out_for, bio_short,
        card_image_id, card_image_url, card_image_prompt,
        card_approved_at
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
    // Phase 1 + Phase 2 + Phase 3a fields ----------------------
    archetype_tag: string | null;
    vibe_line: string | null;
    wants: string | null;
    needs: string | null;
    defining_quote: string | null;
    watch_out_for: string | null;
    bio_short: string | null;
    card_image_id: string | null;
    card_image_url: string | null;
    card_image_prompt: string | null;
    card_approved_at: string | null;
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

  // ───────────────────────────────────────────────────────────────
  // Resolve `reused_from` per character. Heuristic for now:
  //   "reused" = base character has a story_characters link to a
  //              series OTHER than this one AND has an approved face
  //              portrait already.
  //   The "most recent prior series" is picked by story_series.created_at.
  //
  // Once a face_approved_at column lands (follow-up epic), switch to
  // ordering by that — the current proxy is good enough but not
  // provably correct (an older approval on a newer series would win).
  // ───────────────────────────────────────────────────────────────
  const characterIds = storyCharacters
    .map((sc) => baseOf(sc.characters)?.id)
    .filter((id): id is string => Boolean(id));

  const reusedFromByCharacterId = new Map<
    string,
    { series_id: string; series_title: string; slug: string }
  >();

  if (characterIds.length > 0) {
    const { data: priorLinks } = await supabase
      .from("story_characters")
      .select(
        "character_id, series_id, story_series:series_id ( id, title, slug, created_at )"
      )
      .in("character_id", characterIds)
      .neq("series_id", seriesId);

    if (priorLinks) {
      type Prior = {
        character_id: string;
        story_series:
          | { id: string; title: string; slug: string; created_at: string }
          | { id: string; title: string; slug: string; created_at: string }[]
          | null;
      };
      const seenAt = new Map<string, string>();
      for (const row of priorLinks as Prior[]) {
        const ss = Array.isArray(row.story_series)
          ? row.story_series[0]
          : row.story_series;
        if (!ss) continue;
        const prior = seenAt.get(row.character_id);
        if (!prior || ss.created_at > prior) {
          seenAt.set(row.character_id, ss.created_at);
          reusedFromByCharacterId.set(row.character_id, {
            series_id: ss.id,
            series_title: ss.title,
            slug: ss.slug,
          });
        }
      }
    }

    // Only flag "reused" when the base row actually has an approved
    // face — a prior link with no portrait isn't a reuse, it's a stub.
    for (const sc of storyCharacters) {
      const base = baseOf(sc.characters);
      if (!base?.id) continue;
      if (!base.approved_image_id) {
        reusedFromByCharacterId.delete(base.id);
      }
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

      // Phase 3a — character profile card fields ----------------
      archetype_tag: base?.archetype_tag ?? null,
      vibe_line: base?.vibe_line ?? null,
      wants: base?.wants ?? null,
      needs: base?.needs ?? null,
      defining_quote: base?.defining_quote ?? null,
      watch_out_for: base?.watch_out_for ?? null,
      bio_short: base?.bio_short ?? null,
      card_image_id: base?.card_image_id ?? null,
      card_image_url: base?.card_image_url ?? null,
      card_image_prompt: base?.card_image_prompt ?? null,
      card_approved_at: base?.card_approved_at ?? null,
      card_approved: Boolean(base?.card_approved_at),
      reused_from: base?.id
        ? reusedFromByCharacterId.get(base.id) ?? null
        : null,
    };
  });

  return NextResponse.json({ characters });
}
