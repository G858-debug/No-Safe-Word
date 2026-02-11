import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@no-safe-word/story-engine";
import type { StorySeriesRow } from "@no-safe-word/shared";

export const revalidate = 3600;

interface PageProps {
  params: { slug: string };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { data } = await supabase
    .from("story_series")
    .select("title, description")
    .eq("slug", params.slug)
    .eq("status", "published")
    .single();

  const series = data as Pick<StorySeriesRow, "title" | "description"> | null;
  if (!series) return { title: "Story Not Found | No Safe Word" };

  return {
    title: `${series.title} | No Safe Word`,
    description: series.description || undefined,
  };
}

export default async function SeriesPage({ params }: PageProps) {
  const { data: seriesData } = await supabase
    .from("story_series")
    .select("*")
    .eq("slug", params.slug)
    .eq("status", "published")
    .single();

  const series = seriesData as StorySeriesRow | null;
  if (!series) notFound();

  const { data: posts } = await supabase
    .from("story_posts")
    .select("id, part_number, title, published_at")
    .eq("series_id", series.id)
    .eq("status", "published")
    .order("part_number", { ascending: true });

  return (
    <div>
      {/* Back link */}
      <Link
        href="/stories"
        className="mb-8 inline-flex items-center text-sm text-[#6a5f52] transition-colors hover:text-amber-400"
      >
        &larr; All Stories
      </Link>

      {/* Series header */}
      <div className="mb-12">
        <h2
          className="mb-2 text-4xl font-bold text-amber-50"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {series.title}
        </h2>
        <p className="mb-4 text-sm italic text-amber-700">By Nontsikelelo</p>
        {series.description && (
          <p className="max-w-2xl leading-relaxed text-[#a89b88]">
            {series.description}
          </p>
        )}
        {series.hashtag && (
          <p className="mt-3 text-sm text-amber-800">{series.hashtag}</p>
        )}
      </div>

      {/* Chapter listing */}
      <div>
        <h3 className="mb-4 text-xs font-medium uppercase tracking-widest text-[#6a5f52]">
          Chapters
        </h3>

        {posts && posts.length > 0 ? (
          <div className="space-y-2">
            {posts.map((post) => (
              <Link
                key={post.id}
                href={`/stories/${series.slug}/${post.part_number}`}
                className="group flex items-center justify-between rounded-lg border border-amber-900/20 bg-[#111] px-5 py-4 transition-all hover:border-amber-700/40 hover:bg-[#151210]"
              >
                <div className="flex items-center gap-4">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border border-amber-900/40 text-sm font-medium text-amber-700">
                    {post.part_number}
                  </span>
                  <span className="font-medium text-amber-50 transition-colors group-hover:text-amber-300">
                    {post.title}
                  </span>
                </div>
                {post.published_at && (
                  <span className="text-xs text-[#5a5245]">
                    {new Date(post.published_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                )}
              </Link>
            ))}
          </div>
        ) : (
          <p className="py-8 text-[#6a5f52]">Chapters coming soon.</p>
        )}
      </div>
    </div>
  );
}
