import type { Metadata } from "next";
import Link from "next/link";
import { supabase } from "@no-safe-word/story-engine";

export const metadata: Metadata = {
  title: "Stories | No Safe Word",
  description:
    "Erotic fiction by Nontsikelelo. Explicit South African stories for adults.",
};

export const revalidate = 3600;

export default async function StoriesPage() {
  const { data: seriesList } = await supabase
    .from("story_series")
    .select("id, title, slug, description, total_parts, hashtag, status")
    .eq("status", "published")
    .order("created_at", { ascending: false });

  if (!seriesList || seriesList.length === 0) {
    return (
      <div className="py-24 text-center">
        <h2
          className="mb-4 text-3xl font-bold text-amber-50"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Coming Soon
        </h2>
        <p className="mx-auto max-w-md text-[#8a7e6b]">
          New stories are on the way. Follow us on Facebook to be the first to
          know when they drop.
        </p>
      </div>
    );
  }

  // Count published posts per series
  const seriesWithCounts = await Promise.all(
    seriesList.map(async (series) => {
      const { count } = await supabase
        .from("story_posts")
        .select("id", { count: "exact", head: true })
        .eq("series_id", series.id)
        .eq("status", "published");
      return { ...series, publishedParts: count || 0 };
    })
  );

  return (
    <div>
      {/* Page header */}
      <div className="mb-12 text-center">
        <h2
          className="mb-3 text-4xl font-bold text-amber-50"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Stories
        </h2>
        <p className="text-[#8a7e6b]">
          Erotic fiction for adults. Explicit content.
        </p>
      </div>

      {/* Series cards */}
      <div className="grid gap-6 sm:grid-cols-2">
        {seriesWithCounts.map((series) => (
          <Link
            key={series.id}
            href={`/stories/${series.slug}`}
            className="group block rounded-lg border border-amber-900/30 bg-[#111] p-6 transition-all hover:border-amber-700/50 hover:bg-[#151210]"
          >
            <h3
              className="mb-2 text-xl font-bold text-amber-50 transition-colors group-hover:text-amber-300"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              {series.title}
            </h3>
            {series.description && (
              <p className="mb-4 line-clamp-3 text-sm leading-relaxed text-[#a89b88]">
                {series.description}
              </p>
            )}
            <div className="flex items-center gap-3 text-xs text-[#6a5f52]">
              <span>
                {series.publishedParts} chapter
                {series.publishedParts !== 1 ? "s" : ""}
              </span>
              {series.hashtag && (
                <>
                  <span className="text-amber-900">&middot;</span>
                  <span className="text-amber-700">{series.hashtag}</span>
                </>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
