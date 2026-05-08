import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// POST /api/characters/[characterId]/approve-card
//
// Stamps `characters.card_approved_at = now()`. Server-side preconditions
// mirror the UI's gating so a malicious client can't approve a card with
// missing prerequisites:
//   - All seven profile-card text fields must be non-null and non-empty
//   - card_image_id must be present (the card image has been generated +
//     the status handler has propagated it onto the character row)
//
// 200 on success, 400 if preconditions unmet (with a per-field list).
//
// DELETE on the same path clears the timestamp — used by the dashboard's
// "Unapprove" affordance and the self-test step that verifies the
// publisher snaps back to Stage 9 when approval is revoked.

const REQUIRED_TEXT_FIELDS = [
  "archetype_tag",
  "vibe_line",
  "wants",
  "needs",
  "defining_quote",
  "watch_out_for",
  "bio_short",
] as const;

export async function POST(
  _request: NextRequest,
  props: { params: Promise<{ characterId: string }> }
) {
  const { characterId } = await props.params;

  try {
    const { data: character, error: fetchErr } = await supabase
      .from("characters")
      .select(
        "id, archetype_tag, vibe_line, wants, needs, defining_quote, watch_out_for, bio_short, card_image_id"
      )
      .eq("id", characterId)
      .maybeSingle();

    if (fetchErr) throw new Error(fetchErr.message);
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const missing: string[] = [];
    for (const field of REQUIRED_TEXT_FIELDS) {
      const value = character[field as keyof typeof character];
      if (typeof value !== "string" || value.trim().length === 0) {
        missing.push(field);
      }
    }
    if (!character.card_image_id) {
      missing.push("card_image_id");
    }

    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: "Cannot approve — missing required fields",
          missing,
        },
        { status: 400 }
      );
    }

    const approvedAt = new Date().toISOString();
    const { error: updErr } = await supabase
      .from("characters")
      .update({ card_approved_at: approvedAt })
      .eq("id", characterId);
    if (updErr) throw new Error(updErr.message);

    return NextResponse.json({ card_approved_at: approvedAt });
  } catch (err) {
    console.error("[approve-card] failed:", err);
    return NextResponse.json(
      {
        error: "Approval failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  props: { params: Promise<{ characterId: string }> }
) {
  const { characterId } = await props.params;

  try {
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
      .update({ card_approved_at: null })
      .eq("id", characterId);
    if (updErr) throw new Error(updErr.message);

    return NextResponse.json({ card_approved_at: null });
  } catch (err) {
    console.error("[revoke-card-approval] failed:", err);
    return NextResponse.json(
      {
        error: "Revocation failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
