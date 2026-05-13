import type { Metadata } from "next";
import StoryCard from "@/components/StoryCard";
import {
  getPublishedSeriesList,
  resolveShortBlurb,
} from "@/lib/server/get-published-series";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Stories",
  description:
    "Browse all stories on No Safe Word. Erotic fiction by Nontsikelelo.",
};

export default async function StoriesBrowsePage() {
  const stories = await getPublishedSeriesList();
  const hideImages = process.env.HIDE_CHAPTER_IMAGES === "true";

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
              shortBlurb={resolveShortBlurb(story)}
              totalParts={story.total_parts}
              hashtag={story.hashtag}
              coverCardUrl={story.cover_sizes?.card ?? null}
              isBlurred={hideImages}
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
