import type { Metadata } from "next";
import { supabase } from "@no-safe-word/story-engine";
import StoryCard from "@/components/StoryCard";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Stories",
  description:
    "Browse all stories on No Safe Word. Erotic fiction by Nontsikelelo.",
};

async function getAllStories() {
  const { data: series } = await supabase
    .from("story_series")
    .select("id, title, slug, description, total_parts, hashtag")
    .eq("status", "published")
    .order("updated_at", { ascending: false });

  if (!series || series.length === 0) return [];

  // Fetch cover images
  const seriesIds = series.map((s) => s.id);
  const { data: storyChars } = await supabase
    .from("story_characters")
    .select("series_id, approved_image_id")
    .in("series_id", seriesIds)
    .eq("approved", true);

  const coverImageIds = new Map<string, string>();
  for (const sc of storyChars || []) {
    if (sc.approved_image_id && !coverImageIds.has(sc.series_id)) {
      coverImageIds.set(sc.series_id, sc.approved_image_id);
    }
  }

  const imgIds = Array.from(coverImageIds.values());
  let imageUrlMap: Record<string, string> = {};
  if (imgIds.length > 0) {
    const { data: images } = await supabase
      .from("images")
      .select("id, stored_url")
      .in("id", imgIds);
    if (images) {
      imageUrlMap = Object.fromEntries(
        images
          .filter((i) => i.stored_url)
          .map((i) => [i.id, i.stored_url!])
      );
    }
  }

  return series.map((s) => ({
    ...s,
    coverImageUrl: coverImageIds.has(s.id)
      ? imageUrlMap[coverImageIds.get(s.id)!] || null
      : null,
  }));
}

export default async function StoriesBrowsePage() {
  const stories = await getAllStories();

  return (
    <div>
      <header className="mb-10">
        <h1
          className="text-3xl font-bold text-amber-50 sm:text-4xl"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Stories
        </h1>
        <p className="mt-3 text-warm-300">
          All stories by Nontsikelelo. New chapters published regularly.
        </p>
      </header>

      {stories.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {stories.map((story) => (
            <StoryCard
              key={story.id}
              slug={story.slug}
              title={story.title}
              description={story.description}
              totalParts={story.total_parts}
              hashtag={story.hashtag}
              coverImageUrl={story.coverImageUrl}
            />
          ))}
        </div>
      ) : (
        <div className="py-20 text-center">
          <p
            className="text-2xl text-warm-400"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Stories coming soon
          </p>
          <p className="mt-3 text-sm text-warm-500">
            Follow us on Facebook to be notified when new stories are published.
          </p>
        </div>
      )}
    </div>
  );
}
