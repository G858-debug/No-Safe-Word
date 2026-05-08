// Build the plan for a one-off "cover reveal" Facebook post that fires
// the night BEFORE Chapter 1. Distinct from the per-chapter Buffer
// schedule chain — a cover post lives on story_series, not story_posts.
//
// The plan is pure projection. The caller (the cover-post POST route)
// hands it to bufferClient.schedulePost and persists the buffer_post_id
// onto story_series.cover_post_buffer_id.

import { supabase } from "@no-safe-word/story-engine";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://nosafeword.co.za";

// If a story has no chapter hashtags for some reason (unusual — every
// imported chapter carries the brand + series + 4 discovery tags), fall
// back to the brand tag alone so the cover post still has SOME tagging.
const FALLBACK_HASHTAGS = ["#NoSafeWord"];

export interface CoverPostPlan {
  seriesId: string;
  scheduledAt: Date;
  /** Final post body: long blurb + blank line + CTA + blank line + hashtags. */
  text: string;
  /** Cover image URL passed to Buffer's `assets.images[0].url`. */
  imageUrl: string;
  /** First-comment text Buffer posts under the parent post. */
  firstComment: string;
}

export class CoverPostPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoverPostPlanError";
  }
}

/**
 * Build the cover-reveal post plan for `seriesId`. Throws
 * CoverPostPlanError on missing prerequisites (no selected long blurb,
 * no composited cover, etc.) so the route can return 400.
 */
export async function buildCoverPostPlan(
  seriesId: string,
  scheduledAt: Date,
  ctaLine: string
): Promise<CoverPostPlan> {
  const ctaTrimmed = ctaLine.trim();
  if (!ctaTrimmed) {
    throw new CoverPostPlanError("ctaLine is required");
  }

  const { data: series, error: seriesErr } = await supabase
    .from("story_series")
    .select(
      "id, title, slug, hashtag, blurb_long_variants, blurb_long_selected, cover_sizes, cover_status"
    )
    .eq("id", seriesId)
    .single();

  if (seriesErr || !series) {
    throw new CoverPostPlanError(
      `Series ${seriesId} not found: ${seriesErr?.message ?? "no row"}`
    );
  }

  // Selected long blurb.
  const longVariants = (series.blurb_long_variants ?? null) as
    | string[]
    | null;
  const longIdx = series.blurb_long_selected;
  const longBlurb =
    longVariants && longIdx !== null && longIdx !== undefined
      ? longVariants[longIdx] ?? null
      : null;
  if (!longBlurb) {
    throw new CoverPostPlanError(
      "No long blurb is selected. Pick one in the Blurbs tab first."
    );
  }

  // Cover image — composited hero (1600×2400 with title typography).
  const coverSizes = (series.cover_sizes ?? null) as
    | { hero?: string; card?: string; og?: string; email?: string }
    | null;
  const heroUrl = coverSizes?.hero ?? null;
  if (!heroUrl) {
    throw new CoverPostPlanError(
      "Cover compositing has not produced a hero image yet. " +
        "Approve the cover and wait for compositing to complete."
    );
  }

  // Hashtags — pull from any chapter (operator confirmed they're
  // consistent per series). We pick part_number=1 deterministically;
  // fall back to ['#NoSafeWord'] if no chapter has hashtags set.
  const { data: firstChapter, error: chapterErr } = await supabase
    .from("story_posts")
    .select("hashtags")
    .eq("series_id", seriesId)
    .order("part_number", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (chapterErr) {
    throw new CoverPostPlanError(
      `Failed to load chapter hashtags: ${chapterErr.message}`
    );
  }
  const chapterTags = (firstChapter?.hashtags ?? []) as string[];
  const hashtags = chapterTags.length > 0 ? chapterTags : FALLBACK_HASHTAGS;

  const text = [longBlurb.trim(), ctaTrimmed, hashtags.join(" ")].join(
    "\n\n"
  );

  const firstComment = [
    "Read it from the start here 👇",
    `${SITE_URL}/stories/${series.slug}`,
  ].join("\n\n");

  return {
    seriesId,
    scheduledAt,
    text,
    imageUrl: heroUrl,
    firstComment,
  };
}
