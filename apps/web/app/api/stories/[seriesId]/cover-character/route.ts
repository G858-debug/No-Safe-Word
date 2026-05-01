import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

export const runtime = "nodejs";

// ============================================================
// PATCH /api/stories/[seriesId]/cover-character
// ============================================================
// Set or clear story_series.cover_secondary_character_id — the
// optional override that lets a series feature a non-love_interest
// character as the secondary subject on the cover (e.g. when the
// cover scene is set in a supporting character's location).
//
// Body: { characterId: string | null }
//   characterId = uuid → use this character's portrait + identity
//   characterId = null  → clear the override; fall back to the
//                         love_interest role
//
// Constraints:
//   - The character must be linked to this series via story_characters
//   - The character must have an approved portrait (approved_image_id)
//   - The series cover_status must be in a state where regeneration is
//     possible: pending / failed / variants_ready (let the user swap
//     mid-review, before they approve a variant)
// ============================================================
export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
): Promise<NextResponse> {
  const { seriesId } = await props.params;

  let body: { characterId?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const characterId = body.characterId === undefined ? null : body.characterId;
  if (characterId !== null && (typeof characterId !== "string" || !characterId.trim())) {
    return NextResponse.json(
      { error: "characterId must be a UUID string or null" },
      { status: 400 }
    );
  }

  const { data: series, error: seriesErr } = await supabase
    .from("story_series")
    .select("id, cover_status")
    .eq("id", seriesId)
    .single();

  if (seriesErr || !series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  // Lock the field once the user has committed to a variant — swapping
  // characters at that point would silently invalidate the approved
  // cover. Force them to reset first.
  const lockedStatuses = new Set(["generating", "compositing", "approved", "complete"]);
  if (lockedStatuses.has(series.cover_status)) {
    return NextResponse.json(
      {
        error: `Cannot change secondary character while cover_status='${series.cover_status}'. Reset the cover first.`,
      },
      { status: 409 }
    );
  }

  if (characterId !== null) {
    // Validate: character must be in this series and have an approved portrait
    const { data: link, error: linkErr } = await supabase
      .from("story_characters")
      .select(
        "character_id, characters:character_id ( id, name, approved_image_id )"
      )
      .eq("series_id", seriesId)
      .eq("character_id", characterId)
      .maybeSingle();

    if (linkErr) {
      return NextResponse.json(
        { error: `Failed to validate character: ${linkErr.message}` },
        { status: 500 }
      );
    }
    if (!link) {
      return NextResponse.json(
        { error: "Character is not linked to this series" },
        { status: 400 }
      );
    }
    const baseChar = Array.isArray(link.characters) ? link.characters[0] : link.characters;
    if (!baseChar?.approved_image_id) {
      return NextResponse.json(
        {
          error: `Character "${baseChar?.name ?? characterId}" has no approved portrait. Approve their portrait before selecting them for the cover.`,
        },
        { status: 400 }
      );
    }
  }

  const { error: updErr } = await supabase
    .from("story_series")
    .update({ cover_secondary_character_id: characterId })
    .eq("id", seriesId);

  if (updErr) {
    return NextResponse.json(
      { error: `Failed to update cover character: ${updErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, cover_secondary_character_id: characterId });
}
