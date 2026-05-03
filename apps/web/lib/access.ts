import { supabase } from "@no-safe-word/story-engine";

type AccessResult =
  | {
      hasAccess: true;
      reason: "free" | "free_authenticated" | "purchased" | "subscribed";
    }
  | { hasAccess: false; reason: "no_access" };

/**
 * Check if a user has access to a specific part of a story series.
 *
 * Rules:
 *   - Part 1 is always free for everyone (no auth needed).
 *   - For Part 2+, behaviour depends on `story_series.access_tier`:
 *       'free_authenticated' → any signed-in user gets access.
 *       'paid'               → requires a row in nsw_purchases for
 *                              this series, OR an active row in
 *                              nsw_subscriptions for this user.
 *
 * Uses the service-role client (called from server components). The
 * caller is responsible for resolving authUserId from the SSR session.
 */
export async function checkSeriesAccess(
  authUserId: string | null,
  seriesId: string,
  partNumber: number
): Promise<AccessResult> {
  // Part 1 is always free, regardless of tier.
  if (partNumber <= 1) {
    return { hasAccess: true, reason: "free" };
  }

  // Read the series tier early so we know which predicate applies.
  const { data: seriesRow } = await supabase
    .from("story_series")
    .select("access_tier")
    .eq("id", seriesId)
    .single();

  const accessTier = seriesRow?.access_tier ?? "paid";

  // Not logged in — no access to Part 2+ on either tier. Free-tier
  // stories still require a session because the email gate is what
  // captures the subscriber; bypassing it would defeat the funnel.
  if (!authUserId) {
    return { hasAccess: false, reason: "no_access" };
  }

  // Free-tier stories: any authenticated user gets through.
  if (accessTier === "free_authenticated") {
    return { hasAccess: true, reason: "free_authenticated" };
  }

  // Paid tier: existing predicate. Look up nsw_users → check for an
  // individual purchase or active subscription.
  const { data: nswUser } = await supabase
    .from("nsw_users")
    .select("id")
    .eq("auth_user_id", authUserId)
    .single();

  if (!nswUser) {
    return { hasAccess: false, reason: "no_access" };
  }

  const { data: purchase } = await supabase
    .from("nsw_purchases")
    .select("id")
    .eq("user_id", nswUser.id)
    .eq("series_id", seriesId)
    .single();

  if (purchase) {
    return { hasAccess: true, reason: "purchased" };
  }

  const { data: subscription } = await supabase
    .from("nsw_subscriptions")
    .select("id")
    .eq("user_id", nswUser.id)
    .eq("status", "active")
    .limit(1)
    .single();

  if (subscription) {
    return { hasAccess: true, reason: "subscribed" };
  }

  return { hasAccess: false, reason: "no_access" };
}

/**
 * Split text at approximately N words, on paragraph boundaries.
 *
 * Returns the head (whole paragraphs whose total word count fits
 * within `wordLimit`), the tail (everything after), and the actual
 * head word count — which is usually less than `wordLimit` because
 * we don't slice mid-paragraph.
 *
 * Edge cases:
 *   - First paragraph alone exceeds the limit → head = [first
 *     paragraph], tail = [rest]. Better to over-show by one paragraph
 *     than to render a zero-word head.
 *   - Total words ≤ limit → head = full text, tail = "".
 *
 * Used by the chapter page to render an in-prose anchor at the
 * boundary where the email gate previously appeared, so authenticated
 * readers landing via magic-link land on the same word position they
 * were stopped at.
 */
export function splitAtWords(
  text: string,
  wordLimit: number
): { head: string; tail: string; headWords: number } {
  const blocks = text.split(/\n\n+/);
  const head: string[] = [];
  const tail: string[] = [];
  let count = 0;
  let headDone = false;

  for (const block of blocks) {
    if (headDone) {
      tail.push(block);
      continue;
    }
    const blockWords = block.trim().split(/\s+/).length;
    if (count + blockWords > wordLimit && count > 0) {
      headDone = true;
      tail.push(block);
      continue;
    }
    head.push(block);
    count += blockWords;
  }

  return {
    head: head.join("\n\n"),
    tail: tail.join("\n\n"),
    headWords: count,
  };
}
