import { supabase } from "@no-safe-word/story-engine";

// ============================================================
// Single source of truth for "what fields do we select for
// published-story rendering."
// ============================================================
// Both the library page (/stories) and the detail page
// (/stories/[slug]) use these helpers — including the detail page's
// generateMetadata. Keeping the column list centralised prevents the
// meta tags and the page body from diverging on which fields they
// pull.
//
// No caching layer here. The individual pages set `export const
// revalidate = 3600` at the route level. If we later want request-
// level memoization (to avoid duplicating the query between
// generateMetadata and the page body), React `cache()` wrapping would
// happen here — deferred per the prompt instructions.
// ============================================================

export interface PublishedSeries {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  total_parts: number;
  hashtag: string | null;

  // Cover composites (Prompt 3). May be null if compositing has not
  // completed — UI fallbacks apply.
  cover_base_url: string | null;
  cover_status: string;
  cover_sizes: {
    hero?: string;
    card?: string;
    og?: string;
    email?: string;
  } | null;

  // Blurb variants + selections (Prompt 4). May be null; UI falls back
  // to `description` when the selected blurb is unavailable.
  blurb_short_variants: string[] | null;
  blurb_short_selected: number | null;
  blurb_long_variants: string[] | null;
  blurb_long_selected: number | null;
}

/**
 * Columns pulled for published-story rendering. Update this list and
 * the PublishedSeries interface together — do not inline a separate
 * select string anywhere.
 */
const SELECT_COLUMNS =
  "id, title, slug, description, total_parts, hashtag, " +
  "cover_base_url, cover_status, cover_sizes, " +
  "blurb_short_variants, blurb_short_selected, " +
  "blurb_long_variants, blurb_long_selected";

export interface GetPublishedSeriesListOptions {
  /** Maximum number of rows to return. Undefined = no limit. */
  limit?: number;
}

export async function getPublishedSeriesList(
  options: GetPublishedSeriesListOptions = {}
): Promise<PublishedSeries[]> {
  let query = supabase
    .from("story_series")
    .select(SELECT_COLUMNS)
    .eq("status", "published")
    .order("updated_at", { ascending: false });

  if (typeof options.limit === "number") {
    query = query.limit(options.limit);
  }

  const { data } = await query;
  if (!data) return [];
  return data as unknown as PublishedSeries[];
}

export async function getPublishedSeriesBySlug(
  slug: string
): Promise<PublishedSeries | null> {
  const { data } = await supabase
    .from("story_series")
    .select(SELECT_COLUMNS)
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();

  return (data as unknown as PublishedSeries | null) ?? null;
}

/**
 * Resolve the selected short blurb text, falling back through the
 * defined precedence order: short blurb → description → null. UI
 * components call this so the fallback chain stays consistent.
 */
export function resolveShortBlurb(series: PublishedSeries): string | null {
  const { blurb_short_variants: vs, blurb_short_selected: i } = series;
  if (vs && i !== null && i !== undefined) {
    const v = vs[i];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return series.description ?? null;
}

/**
 * Resolve the selected long blurb text, falling back through:
 * long → short → description → null.
 */
export function resolveLongBlurb(series: PublishedSeries): string | null {
  const { blurb_long_variants: ls, blurb_long_selected: li } = series;
  if (ls && li !== null && li !== undefined) {
    const v = ls[li];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return resolveShortBlurb(series);
}
