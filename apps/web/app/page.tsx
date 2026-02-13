import Link from "next/link";
import { supabase } from "@no-safe-word/story-engine";
import type { StorySeriesRow } from "@no-safe-word/shared";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import StoryCard from "@/components/StoryCard";
import AgeGate from "@/components/AgeGate";

export const revalidate = 3600;

async function getFeaturedStories() {
  const { data: series } = await supabase
    .from("story_series")
    .select("id, title, slug, description, total_parts, hashtag")
    .eq("status", "published")
    .order("updated_at", { ascending: false })
    .limit(6);

  if (!series || series.length === 0) return [];

  // Fetch cover images: first approved character portrait per series
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

export default async function HomePage() {
  const stories = await getFeaturedStories();

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-amber-900/20">
        <div className="absolute inset-0 bg-gradient-to-b from-amber-950/30 via-amber-950/10 to-[#0a0a0a]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center_top,_rgba(180,83,9,0.12)_0%,_transparent_60%)]" />
        <div className="relative mx-auto max-w-5xl px-4 py-20 text-center sm:px-6 sm:py-32">
          <h1
            className="text-4xl font-bold tracking-tight text-amber-50 sm:text-5xl lg:text-6xl"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            No Safe Word
          </h1>
          <p className="mx-auto mt-6 max-w-lg text-lg text-warm-200 sm:text-xl">
            Immersive erotic fiction by Nontsikelelo. Beautiful stories crafted
            for adults.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/stories"
              className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-8 py-3.5 text-sm font-semibold text-amber-50 transition-colors hover:bg-amber-600"
            >
              Browse Stories
              <span>&rarr;</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Featured Stories */}
      {stories.length > 0 && (
        <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6">
          <h2 className="mb-8 text-sm font-semibold uppercase tracking-widest text-warm-400">
            Featured Stories
          </h2>
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
          {stories.length >= 6 && (
            <div className="mt-10 text-center">
              <Link
                href="/stories"
                className="text-sm text-amber-700 transition-colors hover:text-amber-500"
              >
                View all stories &rarr;
              </Link>
            </div>
          )}
        </section>
      )}

      {/* How it works */}
      <section className="border-t border-amber-900/20">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
          <h2 className="mb-10 text-center text-sm font-semibold uppercase tracking-widest text-warm-400">
            How It Works
          </h2>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            {[
              {
                step: "1",
                title: "Read Free",
                desc: "Every story has a free chapter. No login needed — just dive in.",
              },
              {
                step: "2",
                title: "Buy a Story",
                desc: "Love what you read? Unlock a full story for R29. It's yours forever.",
              },
              {
                step: "3",
                title: "Subscribe",
                desc: "Get unlimited access to every story for R55/month. Cancel anytime.",
              },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-amber-900/30 text-sm font-bold text-amber-400">
                  {item.step}
                </div>
                <h3
                  className="mb-2 text-lg font-semibold text-amber-50"
                  style={{ fontFamily: "var(--font-serif)" }}
                >
                  {item.title}
                </h3>
                <p className="text-sm text-warm-300">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="flex-1" />
      <Footer />
      <AgeGate />
    </div>
  );
}
