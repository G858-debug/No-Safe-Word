import type { MetadataRoute } from "next";
import { supabase } from "@no-safe-word/story-engine";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://nosafeword.co.za";

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: `${baseUrl}/stories`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: `${baseUrl}/about`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
  ];

  // Published series
  const { data: series } = await supabase
    .from("story_series")
    .select("slug, updated_at")
    .eq("status", "published");

  const seriesPages: MetadataRoute.Sitemap = (series || []).map((s) => ({
    url: `${baseUrl}/stories/${s.slug}`,
    lastModified: new Date(s.updated_at),
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  // Published posts
  const { data: posts } = await supabase
    .from("story_posts")
    .select("part_number, updated_at, series_id")
    .eq("status", "published");

  // Map series_id to slug
  const slugMap = Object.fromEntries(
    (series || []).map((s) => [s.slug, s.slug])
  );

  // Need series_id -> slug mapping
  let seriesIdToSlug: Record<string, string> = {};
  if (series) {
    const { data: allSeries } = await supabase
      .from("story_series")
      .select("id, slug")
      .eq("status", "published");
    if (allSeries) {
      seriesIdToSlug = Object.fromEntries(
        allSeries.map((s) => [s.id, s.slug])
      );
    }
  }

  const postPages: MetadataRoute.Sitemap = (posts || [])
    .filter((p) => seriesIdToSlug[p.series_id])
    .map((p) => ({
      url: `${baseUrl}/stories/${seriesIdToSlug[p.series_id]}/${p.part_number}`,
      lastModified: new Date(p.updated_at),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    }));

  return [...staticPages, ...seriesPages, ...postPages];
}
