// Build a Buffer publishing schedule for a story.
//
// Stories drop one chapter per day at 20:00 SAST. The chain is global —
// story #2's day 1 is the day AFTER the last scheduled chapter of any
// other story. This avoids two chapters from different stories landing
// on the same evening.
//
// In addition to the chapter chain, an approved author note is scheduled
// as a single Facebook post on the day AFTER the last chapter of THIS
// series. The author-note item lives on story_series, not story_posts,
// so it's surfaced as a separate `authorNote` field on the result; the
// route handles it with a parallel write path against story_series.
//
// The plan returned by buildScheduleForStory is purely projection — no
// Buffer or DB writes. The caller (the buffer-schedule route) iterates
// the plan, calls bufferClient.schedulePost for each item, and persists
// the returned buffer_post_id back onto story_posts.

import { supabase } from "@no-safe-word/story-engine";
import type { AuthorNotes } from "@no-safe-word/shared";

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

/**
 * Synthesised plan item for the series' author note. The text is
 * `story_series.author_notes.social_caption`; the image is
 * `story_series.author_note_image_url`. Scheduled for 20:00 SAST on
 * the day after the latest chapter date in this series.
 */
export interface AuthorNotePlan {
  socialCaption: string;
  imageUrl: string;
  scheduledAt: Date;
}

export interface BuildScheduleOptions {
  /**
   * If provided, the chain starts on this day at 20:00 SAST instead of
   * "the day after the last scheduled post". The caller is responsible
   * for warning the operator if this collides with another story.
   */
  startDate?: Date;
}

/**
 * Thrown by buildScheduleForStory when an operator-supplied startDate
 * is invalid. Routes should map this to a 400 response.
 */
export class ScheduleStartDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleStartDateError";
  }
}

export interface BuildScheduleResult {
  plan: ScheduledPostPlan[];
  /**
   * Author-note Facebook post for THIS series, if eligible and not yet
   * scheduled. `null` when:
   *   - the note is not approved (`author_note_approved_at` is null)
   *   - `social_caption` or `author_note_image_url` is missing
   *   - the note is already on Buffer (`author_note_buffer_post_id`
   *     non-null AND status is not 'error')
   */
  authorNote: AuthorNotePlan | null;
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
  buffer_post_id: string | null;
  buffer_status: string | null;
  scheduled_for: string | null;
}

interface SeriesAuthorNoteRow {
  author_notes: AuthorNotes | null;
  author_note_image_url: string | null;
  author_note_approved_at: string | null;
  author_note_buffer_post_id: string | null;
  author_note_buffer_status: string | null;
}

/**
 * Compute the publish-schedule plan for the given series. Does not
 * write to the DB and does not call Buffer. A chapter is schedulable
 * if it has never been sent to Buffer (buffer_post_id IS NULL) or a
 * previous Buffer attempt failed (buffer_status = 'error'). post.status
 * is intentionally NOT consulted — status='published' from the
 * website-publish flow does not mean a chapter has shipped to Facebook.
 */
export async function buildScheduleForStory(
  seriesId: string,
  options: BuildScheduleOptions = {}
): Promise<BuildScheduleResult> {
  // 1. Load every post in the series in part-number order.
  const { data: rawPosts, error: postsError } = await supabase
    .from("story_posts")
    .select(
      "id, part_number, title, facebook_content, facebook_comment, buffer_post_id, buffer_status, scheduled_for"
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

  const schedulable = posts.filter(
    (p) => p.buffer_post_id == null || p.buffer_status === "error"
  );

  // 2. Resolve the chain start date.
  const chainTailDate = await loadGlobalChainTail();
  const startDate = options.startDate
    ? toEveningUTC(validateStartDate(options.startDate))
    : chainTailDate
      ? addDaysUTC(chainTailDate, 1)
      : nextEveningUTC(new Date());

  // 3. Resolve images for the posts in one batch.
  const imageUrlsByPost = await loadFacebookSfwImageUrls(
    schedulable.map((p) => p.id)
  );

  // 4. Build the plan.
  const plan: ScheduledPostPlan[] = schedulable.map((post, idx) => ({
    postId: post.id,
    partNumber: post.part_number,
    title: post.title,
    scheduledAt: addDaysUTC(startDate, idx),
    facebookContent: post.facebook_content,
    firstComment: post.facebook_comment ?? "",
    imageUrls: imageUrlsByPost.get(post.id) ?? [],
  }));

  // 5. Compute the author-note plan. Scheduled for the day after the
  //    last chapter in THIS series — derived from the actual scheduled
  //    dates already on disk plus the new plan items we're about to
  //    schedule. Falls through to null when the note isn't eligible.
  const authorNote = await loadAuthorNotePlanForSeries(
    seriesId,
    posts,
    plan
  );

  // 6. Empty-plan short-circuit. We bail with an empty plan only when
  //    there's nothing to schedule across BOTH chapters and the author
  //    note. That preserves the "everything already on Buffer" guard
  //    for the route while still allowing a standalone author-note
  //    schedule when chapters are done.
  if (plan.length === 0 && authorNote == null) {
    return { plan: [], authorNote: null, startDate, chainTailDate };
  }

  return { plan, authorNote, startDate, chainTailDate };
}

/**
 * Compute the author-note plan for a series, or `null` when not eligible.
 *
 * Eligibility:
 *   - `author_note_approved_at` is non-null (operator approved the note)
 *   - `author_notes.social_caption` is non-empty after trim
 *   - `author_note_image_url` is non-empty
 *   - the note is not already on Buffer (post_id is null OR status='error')
 *
 * Scheduled-for: 20:00 SAST on the day AFTER the latest chapter in the
 * series. The "latest chapter date" is the max of (already-scheduled
 * `scheduled_for` columns on story_posts, projected `scheduledAt` on
 * the new chapter plan items). That makes the note land on day N+1
 * regardless of whether we're scheduling all chapters in one call or
 * topping up after a partial schedule.
 */
async function loadAuthorNotePlanForSeries(
  seriesId: string,
  allPosts: PostRow[],
  chapterPlan: ScheduledPostPlan[]
): Promise<AuthorNotePlan | null> {
  const { data: row, error } = await supabase
    .from("story_series")
    .select(
      "author_notes, author_note_image_url, author_note_approved_at, author_note_buffer_post_id, author_note_buffer_status"
    )
    .eq("id", seriesId)
    .single();

  if (error) {
    throw new Error(`Failed to load series for author note: ${error.message}`);
  }
  const series = row as SeriesAuthorNoteRow;

  if (!series.author_note_approved_at) return null;

  const alreadyScheduled =
    series.author_note_buffer_post_id != null &&
    series.author_note_buffer_status !== "error";
  if (alreadyScheduled) return null;

  const socialCaption = series.author_notes?.social_caption?.trim() ?? "";
  if (socialCaption.length === 0) return null;

  const imageUrl = series.author_note_image_url?.trim() ?? "";
  if (imageUrl.length === 0) return null;

  // Latest chapter date = max(already-scheduled rows, new plan dates).
  let latestMs = 0;
  for (const post of allPosts) {
    if (!post.scheduled_for) continue;
    const t = new Date(post.scheduled_for).getTime();
    if (t > latestMs) latestMs = t;
  }
  for (const item of chapterPlan) {
    const t = item.scheduledAt.getTime();
    if (t > latestMs) latestMs = t;
  }
  if (latestMs === 0) {
    // No chapter is scheduled or pending — nothing to anchor "day after"
    // to. Skip rather than guess; the note will pick up on a later
    // schedule run once at least one chapter has a date.
    return null;
  }

  return {
    socialCaption,
    imageUrl,
    scheduledAt: addDaysUTC(new Date(latestMs), 1),
  };
}

/**
 * The latest scheduled_for across every series. Returns null if no
 * post anywhere has been scheduled yet.
 */
export async function loadGlobalChainTail(): Promise<Date | null> {
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

/**
 * Validate an operator-supplied startDate. Must parse as a real Date
 * and must not fall before today (in SAST). Throws with a clear message
 * on failure so the route can return a 400.
 */
function validateStartDate(date: Date): Date {
  if (Number.isNaN(date.getTime())) {
    throw new ScheduleStartDateError("startDate is not a valid date");
  }
  // We accept any startDate whose 20:00-SAST instant is >= now.
  const evening = toEveningUTC(date);
  if (evening.getTime() < Date.now()) {
    throw new ScheduleStartDateError(
      "startDate is in the past. Pick today or a future date."
    );
  }
  return date;
}

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
