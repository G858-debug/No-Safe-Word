// Build a Buffer publishing schedule for a story.
//
// Stories drop one chapter per day at 20:00 SAST. The chain is global —
// story #2's day 1 is the day AFTER the last scheduled chapter of any
// other story. This avoids two chapters from different stories landing
// on the same evening.
//
// The plan returned by buildScheduleForStory is purely projection — no
// Buffer or DB writes. The caller (the buffer-schedule route) iterates
// the plan, calls bufferClient.schedulePost for each item, and persists
// the returned buffer_post_id back onto story_posts.

import { supabase } from "@no-safe-word/story-engine";

// SAST is UTC+2 with no DST. 20:00 SAST = 18:00 UTC year-round.
const PUBLISH_HOUR_UTC = 18;
const PUBLISH_MINUTE_UTC = 0;

export interface ScheduledPostPlan {
  postId: string;
  partNumber: number;
  title: string;
  scheduledAt: Date;
  facebookContent: string;
  firstComment: string;
  imageUrls: string[];
}

export interface BuildScheduleOptions {
  /**
   * If provided, the chain starts on this day at 20:00 SAST instead of
   * "the day after the last scheduled post". The caller is responsible
   * for warning the operator if this collides with another story.
   */
  startDate?: Date;
}

export interface BuildScheduleResult {
  plan: ScheduledPostPlan[];
  startDate: Date;
  /**
   * The latest scheduled_for we observed across ALL series. Useful for
   * the UI to explain "scheduling story #2 starting [date X+1] because
   * story #1's last chapter is [date X]."
   */
  chainTailDate: Date | null;
}

interface PostRow {
  id: string;
  part_number: number;
  title: string;
  facebook_content: string;
  facebook_comment: string | null;
  status: string;
}

/**
 * Compute the publish-schedule plan for the given series. Does not
 * write to the DB and does not call Buffer. The plan only includes
 * posts that haven't been published yet (status != 'published') —
 * already-live chapters are skipped silently.
 */
export async function buildScheduleForStory(
  seriesId: string,
  options: BuildScheduleOptions = {}
): Promise<BuildScheduleResult> {
  // 1. Load every post in the series in part-number order.
  const { data: rawPosts, error: postsError } = await supabase
    .from("story_posts")
    .select(
      "id, part_number, title, facebook_content, facebook_comment, status"
    )
    .eq("series_id", seriesId)
    .order("part_number", { ascending: true });

  if (postsError) {
    throw new Error(`Failed to load posts: ${postsError.message}`);
  }
  const posts = (rawPosts ?? []) as PostRow[];
  if (posts.length === 0) {
    throw new Error("No posts found for this series");
  }

  const unpublished = posts.filter((p) => p.status !== "published");
  if (unpublished.length === 0) {
    return {
      plan: [],
      startDate: nextEveningUTC(new Date()),
      chainTailDate: await loadGlobalChainTail(),
    };
  }

  // 2. Resolve the chain start date.
  const chainTailDate = await loadGlobalChainTail();
  const startDate = options.startDate
    ? toEveningUTC(options.startDate)
    : chainTailDate
      ? addDaysUTC(chainTailDate, 1)
      : nextEveningUTC(new Date());

  // 3. Resolve images for the posts in one batch.
  const imageUrlsByPost = await loadFacebookSfwImageUrls(
    unpublished.map((p) => p.id)
  );

  // 4. Build the plan.
  const plan: ScheduledPostPlan[] = unpublished.map((post, idx) => ({
    postId: post.id,
    partNumber: post.part_number,
    title: post.title,
    scheduledAt: addDaysUTC(startDate, idx),
    facebookContent: post.facebook_content,
    firstComment: post.facebook_comment ?? "",
    imageUrls: imageUrlsByPost.get(post.id) ?? [],
  }));

  return { plan, startDate, chainTailDate };
}

/**
 * The latest scheduled_for across every series. Returns null if no
 * post anywhere has been scheduled yet.
 */
async function loadGlobalChainTail(): Promise<Date | null> {
  const { data, error } = await supabase
    .from("story_posts")
    .select("scheduled_for")
    .not("scheduled_for", "is", null)
    .order("scheduled_for", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to load chain tail: ${error.message}`);
  }
  const row = data?.[0];
  if (!row?.scheduled_for) return null;
  return new Date(row.scheduled_for);
}

/**
 * Resolve the public image URL for each post's approved Facebook SFW
 * images, ordered by the prompt's `position`. Excluded prompts are
 * filtered out — they were intentionally hidden by the operator.
 */
async function loadFacebookSfwImageUrls(
  postIds: string[]
): Promise<Map<string, string[]>> {
  if (postIds.length === 0) return new Map();

  const { data: prompts, error: promptsError } = await supabase
    .from("story_image_prompts")
    .select("id, post_id, image_id, position")
    .in("post_id", postIds)
    .eq("image_type", "facebook_sfw")
    .eq("status", "approved")
    .eq("excluded_from_publish", false)
    .order("position", { ascending: true });

  if (promptsError) {
    throw new Error(
      `Failed to load image prompts: ${promptsError.message}`
    );
  }

  const imageIds = (prompts ?? [])
    .map((p) => p.image_id)
    .filter((id): id is string => !!id);

  if (imageIds.length === 0) {
    return new Map(postIds.map((id) => [id, []]));
  }

  const { data: images, error: imagesError } = await supabase
    .from("images")
    .select("id, stored_url, sfw_url")
    .in("id", imageIds);

  if (imagesError) {
    throw new Error(`Failed to load images: ${imagesError.message}`);
  }

  const urlByImageId = new Map<string, string>();
  for (const img of images ?? []) {
    const url = img.stored_url || img.sfw_url;
    if (url) urlByImageId.set(img.id, url);
  }

  const byPost = new Map<string, string[]>();
  for (const id of postIds) byPost.set(id, []);
  for (const p of prompts ?? []) {
    if (!p.image_id) continue;
    const url = urlByImageId.get(p.image_id);
    if (!url) continue;
    const list = byPost.get(p.post_id);
    if (list) list.push(url);
  }
  return byPost;
}

// ---------------------------------------------------------------------------
// Date helpers — all UTC, all 20:00 SAST = 18:00 UTC.
// ---------------------------------------------------------------------------

function toEveningUTC(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(PUBLISH_HOUR_UTC, PUBLISH_MINUTE_UTC, 0, 0);
  return d;
}

function addDaysUTC(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(PUBLISH_HOUR_UTC, PUBLISH_MINUTE_UTC, 0, 0);
  return d;
}

/**
 * 20:00 SAST tomorrow. Used when no scheduled post exists anywhere yet.
 */
function nextEveningUTC(now: Date): Date {
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(PUBLISH_HOUR_UTC, PUBLISH_MINUTE_UTC, 0, 0);
  return tomorrow;
}
