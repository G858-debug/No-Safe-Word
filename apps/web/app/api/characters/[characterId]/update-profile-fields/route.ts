import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// PATCH /api/characters/[characterId]/update-profile-fields
//
// Manual-edit endpoint for the seven Stage 9 profile-card text fields plus
// the card_image_prompt. The body accepts any subset; only the supplied
// keys are updated. Empty strings are coerced to null so the DB column
// reflects "not set" rather than an empty placeholder.
//
// This is NOT an AI-regen endpoint. Phase 3a explicitly excludes any
// model-call rewrites of these fields — the values come from the imported
// JSON (written by Claude with full story context); the publisher is for
// manual review and tweaks.

const ALLOWED_FIELDS = new Set([
  "archetype_tag",
  "vibe_line",
  "wants",
  "needs",
  "defining_quote",
  "watch_out_for",
  "bio_short",
  "card_image_prompt",
]);

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ characterId: string }> }
) {
  const { characterId } = await props.params;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Body must be a JSON object" },
        { status: 400 }
      );
    }

    // Whitelist + coerce empty strings to null.
    const update: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(body)) {
      if (!ALLOWED_FIELDS.has(key)) continue;
      if (value === null || value === undefined) {
        update[key] = null;
      } else if (typeof value === "string") {
        update[key] = value.trim().length === 0 ? null : value;
      } else {
        return NextResponse.json(
          { error: `Field '${key}' must be a string or null` },
          { status: 400 }
        );
      }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: "No editable fields supplied" },
        { status: 400 }
      );
    }

    // Verify character exists. The update itself would silently no-op on a
    // missing id; an explicit 404 is friendlier.
    const { data: existing } = await supabase
      .from("characters")
      .select("id")
      .eq("id", characterId)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const { error: updErr } = await supabase
      .from("characters")
      .update(update)
      .eq("id", characterId);
    if (updErr) {
      throw new Error(updErr.message);
    }

    return NextResponse.json({ updated: Object.keys(update) });
  } catch (err) {
    console.error("[update-profile-fields] failed:", err);
    return NextResponse.json(
      {
        error: "Update failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
