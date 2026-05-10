import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Idempotent series-status advancement gate.
 *
 * Advances `story_series.status` from 'draft' to 'images_pending' iff
 * every character linked to this series has BOTH `approved_image_id`
 * AND `approved_fullbody_image_id` set on the base `characters` row.
 *
 * Returns `{ advanced: true }` only on the call that performs the
 * UPDATE. Returns `{ advanced: false }` for: status already past
 * 'draft', any character missing face or body, zero characters in the
 * series, or a DB error.
 *
 * Safe to call from /approve-face (face was the last unmet condition)
 * AND /approve-body (body was the last unmet condition) — whichever
 * action completes the gate triggers the advance; the other becomes a
 * no-op.
 */
export async function checkAndAdvanceToImagesPending(
  supabase: SupabaseClient,
  seriesId: string
): Promise<{ advanced: boolean }> {
  // 1. Status gate — only advance from 'draft'. Reading first lets us
  //    short-circuit before the join query and surfaces the no-op case
  //    cleanly when the series is already past draft.
  const { data: series } = await supabase
    .from("story_series")
    .select("status")
    .eq("id", seriesId)
    .single();
  if (!series || series.status !== "draft") {
    return { advanced: false };
  }

  // 2. Every character in the series must have both face AND body
  //    approved on the base row.
  const { data: links } = await supabase
    .from("story_characters")
    .select(
      "character_id, characters:character_id ( approved_image_id, approved_fullbody_image_id )"
    )
    .eq("series_id", seriesId);
  if (!links || links.length === 0) {
    return { advanced: false };
  }

  const allReady = links.every((sc) => {
    const base = sc.characters as
      | {
          approved_image_id: string | null;
          approved_fullbody_image_id: string | null;
        }
      | {
          approved_image_id: string | null;
          approved_fullbody_image_id: string | null;
        }[]
      | null;
    const row = Array.isArray(base) ? base[0] : base;
    return (
      Boolean(row?.approved_image_id) &&
      Boolean(row?.approved_fullbody_image_id)
    );
  });
  if (!allReady) {
    return { advanced: false };
  }

  // 3. Advance.
  const { error } = await supabase
    .from("story_series")
    .update({ status: "images_pending" })
    .eq("id", seriesId);
  if (error) {
    return { advanced: false };
  }
  return { advanced: true };
}
