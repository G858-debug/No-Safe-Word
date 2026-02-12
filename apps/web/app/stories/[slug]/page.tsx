import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@no-safe-word/story-engine";
import type { StorySeriesRow } from "@no-safe-word/shared";

export const revalidate = 3600;

interface PageProps {
  params: Promise<{ slug: string }>;
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;

  const { data: seriesData } = await supabase
    .from("story_series")
    .select("title, description")
    .eq("slug", slug)
    .eq("status", "published")
    .single();

  const series = seriesData as Pick<
    StorySeriesRow,
    "title" | "description"
  > | null;
  if (!series) return { title: "Not Found" };

  return {
    title: series.title,
    description:
      series.description ||
      `Read ${series.title} by Nontsikelelo on No Safe Word.`,
    openGraph: {
      title: series.title,
      description:
        series.description ||
        `Read ${series.title} by Nontsikelelo on No Safe Word.`,
      type: "article",
    },
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function SeriesPage({ params }: PageProps) {
  const { slug } = await params;

  // 1. Fetch series
  const { data: seriesData } = await supabase
    .from("story_series")
    .select("id, title, slug, description, total_parts, hashtag")
    .eq("slug", slug)
    .eq("status", "published")
    .single();

  const series = seriesData as Pick<
    StorySeriesRow,
    "id" | "title" | "slug" | "description" | "total_parts" | "hashtag"
  > | null;
  if (!series) notFound();

  // 2. Fetch published chapters
  const { data: posts } = await supabase
    .from("story_posts")
    .select("part_number, title")
    .eq("series_id", series.id)
    .eq("status", "published")
    .order("part_number", { ascending: true });

  // 3. Fetch characters with portraits
  const { data: characters } = await supabase
    .from("story_characters")
    .select(
      "role, prose_description, character_id, approved_image_id, approved"
    )
    .eq("series_id", series.id)
    .eq("approved", true);

  // Fetch character names and portrait URLs
  let characterDetails: {
    name: string;
    role: string;
    description: string | null;
    imageUrl: string | null;
  }[] = [];

  if (characters && characters.length > 0) {
    const charIds = characters.map((c) => c.character_id);
    const imgIds = characters
      .map((c) => c.approved_image_id)
      .filter((id): id is string => id !== null);

    const [{ data: charData }, { data: imgData }] = await Promise.all([
      supabase.from("characters").select("id, name").in("id", charIds),
      imgIds.length > 0
        ? supabase.from("images").select("id, stored_url").in("id", imgIds)
        : Promise.resolve({
            data: [] as { id: string; stored_url: string | null }[],
          }),
    ]);

    const nameMap = Object.fromEntries(
      (charData || []).map((c) => [c.id, c.name])
    );
    const urlMap = Object.fromEntries(
      (imgData || [])
        .filter((i) => i.stored_url)
        .map((i) => [i.id, i.stored_url!])
    );

    characterDetails = characters.map((c) => ({
      name: nameMap[c.character_id] || "Unknown",
      role: c.role,
      description: c.prose_description,
      imageUrl: c.approved_image_id
        ? urlMap[c.approved_image_id] || null
        : null,
    }));
  }

  return (
    <div>
      {/* Series header */}
      <header className="mb-12">
        {series.hashtag && (
          <p className="mb-3 text-xs uppercase tracking-[0.2em] text-amber-700">
            #{series.hashtag}
          </p>
        )}
        <h1
          className="text-3xl font-bold text-amber-50 sm:text-4xl lg:text-5xl"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {series.title}
        </h1>
        <p className="mt-3 text-sm italic text-warm-400">By Nontsikelelo</p>
        {series.description && (
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-warm-200">
            {series.description}
          </p>
        )}
        <p className="mt-4 text-sm text-warm-500">
          {series.total_parts} {series.total_parts === 1 ? "part" : "parts"}
        </p>
      </header>

      {/* Characters */}
      {characterDetails.length > 0 && (
        <section className="mb-12">
          <h2 className="mb-6 text-sm font-semibold uppercase tracking-widest text-warm-400">
            Characters
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {characterDetails.map((char) => (
              <div
                key={char.name}
                className="overflow-hidden rounded-xl border border-amber-900/20 bg-surface-raised"
              >
                {char.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={char.imageUrl}
                    alt={char.name}
                    className="aspect-[3/4] w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex aspect-[3/4] items-center justify-center bg-surface-overlay">
                    <span className="text-2xl text-warm-500">
                      {char.name[0]}
                    </span>
                  </div>
                )}
                <div className="p-3">
                  <p className="font-semibold text-amber-50">{char.name}</p>
                  <p className="text-xs capitalize text-warm-400">
                    {char.role.replace("_", " ")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Chapters */}
      <section>
        <h2 className="mb-6 text-sm font-semibold uppercase tracking-widest text-warm-400">
          Chapters
        </h2>

        {/* Start reading CTA */}
        {posts && posts.length > 0 && (
          <Link
            href={`/stories/${series.slug}/${posts[0].part_number}`}
            className="mb-8 inline-flex items-center gap-2 rounded-lg bg-amber-700 px-6 py-3 text-sm font-semibold text-amber-50 transition-colors hover:bg-amber-600"
          >
            Start Reading
            <span>&rarr;</span>
          </Link>
        )}

        {/* Chapter list */}
        <div className="mt-6 space-y-2">
          {(posts || []).map((post) => (
            <Link
              key={post.part_number}
              href={`/stories/${series.slug}/${post.part_number}`}
              className="group flex items-center gap-4 rounded-lg border border-amber-900/20 bg-surface-raised px-5 py-4 transition-all hover:border-amber-900/40 hover:bg-surface-overlay"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-900/30 text-xs font-bold text-amber-400">
                {post.part_number}
              </span>
              <span className="text-warm-100 transition-colors group-hover:text-amber-300">
                {post.title}
              </span>
              <span className="ml-auto text-warm-500 transition-transform group-hover:translate-x-0.5">
                &rarr;
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
