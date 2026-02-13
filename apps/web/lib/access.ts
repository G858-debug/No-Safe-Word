import { supabase } from "@no-safe-word/story-engine";

type AccessResult =
  | { hasAccess: true; reason: "free" | "purchased" | "subscribed" }
  | { hasAccess: false; reason: "no_access" };

/**
 * Check if a user has access to a specific part of a story series.
 * Part 1 is always free. Part 2+ requires purchase or subscription.
 * Uses service role client (called from server components).
 */
export async function checkSeriesAccess(
  authUserId: string | null,
  seriesId: string,
  partNumber: number
): Promise<AccessResult> {
  // Part 1 is always free
  if (partNumber <= 1) {
    return { hasAccess: true, reason: "free" };
  }

  // Not logged in — no access to Part 2+
  if (!authUserId) {
    return { hasAccess: false, reason: "no_access" };
  }

  // Look up the nsw_users record
  const { data: nswUser } = await supabase
    .from("nsw_users")
    .select("id")
    .eq("auth_user_id", authUserId)
    .single();

  if (!nswUser) {
    return { hasAccess: false, reason: "no_access" };
  }

  // Check for individual purchase
  const { data: purchase } = await supabase
    .from("nsw_purchases")
    .select("id")
    .eq("user_id", nswUser.id)
    .eq("series_id", seriesId)
    .single();

  if (purchase) {
    return { hasAccess: true, reason: "purchased" };
  }

  // Check for active subscription
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
 * Truncate text to approximately N words, splitting on paragraph breaks.
 */
export function truncateToWords(text: string, wordLimit: number): string {
  const blocks = text.split(/\n\n+/);
  const result: string[] = [];
  let count = 0;

  for (const block of blocks) {
    const blockWords = block.trim().split(/\s+/).length;
    if (count + blockWords > wordLimit && count > 0) break;
    result.push(block);
    count += blockWords;
  }

  return result.join("\n\n");
}
