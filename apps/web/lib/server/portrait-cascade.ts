import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side face-revoke cascade. The single place that decides whether
 * revoking a face approval should also invalidate the body approval.
 *
 * Cascade rule: when revoking a face, if the character has any body image
 * (approved OR a Generated-unapproved body that was already produced),
 * clear the approved body slot AND set `body_invalidated_at = now()`. The
 * body image row itself is preserved — the UI shows it with a stale banner
 * until the user regenerates and approves.
 *
 * If no body image exists (body panel was Locked or Empty), face is cleared
 * alone and `body_invalidated_at` stays NULL.
 *
 * Idempotent: a re-call when face is already cleared simply re-runs the
 * body-existence check and re-sets `body_invalidated_at` to a fresh `now()`
 * if a body still exists. Harmless.
 */
export async function runFaceRevokeCascade(
  supabase: SupabaseClient,
  characterId: string
): Promise<{ ok: boolean; cascaded: boolean; error?: string }> {
  // 1. Read current approved body, if any.
  const { data: char, error: readErr } = await supabase
    .from("characters")
    .select("approved_fullbody_image_id")
    .eq("id", characterId)
    .single();

  if (readErr || !char) {
    return {
      ok: false,
      cascaded: false,
      error: readErr?.message ?? "Character not found",
    };
  }

  // 2. Independently check whether ANY body image exists for this character
  //    (covers the Generated-unapproved case where the body row exists but
  //    `approved_fullbody_image_id` is null).
  let hasUnapprovedBody = false;
  {
    const { data: bodyRows } = await supabase
      .from("images")
      .select("id")
      .eq("character_id", characterId)
      .filter("settings->>imageType", "eq", "body")
      .limit(1);
    hasUnapprovedBody = (bodyRows ?? []).length > 0;
  }

  const hasBody =
    char.approved_fullbody_image_id != null || hasUnapprovedBody;

  // 3. Build update payload. Face fields always cleared; body fields and
  //    invalidation timestamp only when a body image actually exists.
  const update: Record<string, unknown> = {
    approved_image_id: null,
    approved_seed: null,
    approved_prompt: null,
    portrait_prompt_locked: null,
  };
  if (hasBody) {
    update.approved_fullbody_image_id = null;
    update.body_invalidated_at = new Date().toISOString();
  }

  const { error: updErr } = await supabase
    .from("characters")
    .update(update)
    .eq("id", characterId);

  if (updErr) {
    return { ok: false, cascaded: false, error: updErr.message };
  }
  return { ok: true, cascaded: hasBody };
}
