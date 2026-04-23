import { supabase } from "@no-safe-word/story-engine";

// ============================================================
// Assemble full-story text from all posts in a series
// ============================================================
// Queries story_posts for the given series, ordered by part_number
// ASC, and joins the website_content fields with a horizontal-rule
// separator. Used by Prompt 5's regenerate-blurbs and regenerate-
// cover-prompt endpoints as the full-text context for Claude.
//
// Reusable for any future AI feature that needs the whole narrative
// in one blob: derivative prompt generation, TL;DR summaries, teaser
// lines, social captions, etc. Kept here rather than co-located with
// the first caller so the next feature doesn't have to move it.
//
// Returns "" (empty string) if the series has no posts — callers
// should treat that as "no text to work with" and fail loudly rather
// than sending an empty prompt to Claude. The regenerate endpoints
// check post count as a precondition before calling this helper.
// ============================================================

const SEPARATOR = "\n\n---\n\n";

export async function assembleFullStoryText(seriesId: string): Promise<string> {
  const { data, error } = await supabase
    .from("story_posts")
    .select("part_number, website_content")
    .eq("series_id", seriesId)
    .order("part_number", { ascending: true });

  if (error) {
    throw new Error(`Failed to load story posts for assembly: ${error.message}`);
  }

  const posts = data ?? [];
  if (posts.length === 0) return "";

  return posts
    .map((p) => (p.website_content ?? "").trim())
    .filter((text) => text.length > 0)
    .join(SEPARATOR);
}
