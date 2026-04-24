import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@no-safe-word/story-engine";
import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/server/events";
import {
  getPublishedSeriesBySlug,
  resolveShortBlurb,
  resolveLongBlurb,
} from "@/lib/server/get-published-series";

export const revalidate = 3600;

interface PageProps {
  params: Promise<{ slug: string }>;
}

// ---------------------------------------------------------------------------
// Metadata (shared helper ensures meta tags + page body see identical data)
// ---------------------------------------------------------------------------

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const series = await getPublishedSeriesBySlug(slug);
  if (!series) return { title: "Not Found" };

  const shortBlurb = resolveShortBlurb(series);
  const ogImage = series.cover_sizes?.og ?? series.cover_sizes?.card ?? null;
  const description =
    shortBlurb || `Read ${series.title} by Nontsikelelo on No Safe Word.`;

  const metadata: Metadata = {
    title: series.title,
    description,
    openGraph: {
      title: series.title,
      description,
      type: "article",
      ...(ogImage
        ? {
            images: [
              {
                url: ogImage,
                // Dimensions match Prompt 3 composite sizes. Explicit
                // width/height helps social scrapers avoid re-fetching
                // for metadata discovery.
                width: series.cover_sizes?.og ? 1200 : 600,
                height: series.cover_sizes?.og ? 630 : 900,
                alt: series.title,
              },
            ],
          }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: series.title,
      description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };

  return metadata;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function SeriesPage({ params }: PageProps) {
  const { slug } = await params;

  const series = await getPublishedSeriesBySlug(slug);
  if (!series) notFound();

  // Analytics: series summary view. Log userId if the reader is signed in,
  // else null (most summary-page visitors are anonymous).
  const authSupabase = await createClient();
  const {
    data: { user: summaryUser },
  } = await authSupabase.auth.getUser();
  await logEvent({
    eventType: "reading.story_view",
    userId: summaryUser?.id ?? null,
    metadata: { series_slug: slug },
  });

  // Fetch published chapters
  const { data: posts } = await supabase
    .from("story_posts")
    .select("part_number, title")
    .eq("series_id", series.id)
    .eq("status", "published")
    .order("part_number", { ascending: true });

  // Fetch characters with portraits
  // Portrait state (approved_image_id) now lives on the base `characters`
  // row. Join to fetch it.
  const { data: characters } = await supabase
    .from("story_characters")
    .select(
      "role, prose_description, character_id, characters:character_id ( id, name, approved_image_id )"
    )
    .eq("series_id", series.id);

  // Resolve character display metadata
  let characterDetails: {
    name: string;
    role: string;
    description: string | null;
    imageUrl: string | null;
  }[] = [];

  type Joined = {
    role: string | null;
    prose_description: string | null;
    character_id: string;
    characters:
      | { id: string; name: string; approved_image_id: string | null }
      | { id: string; name: string; approved_image_id: string | null }[]
      | null;
  };
  const rows = (characters ?? []) as unknown as Joined[];
  const baseOf = (r: Joined) =>
    Array.isArray(r.characters) ? r.characters[0] ?? null : r.characters;

  // Filter to only characters with an approved portrait (old `approved`
  // boolean is gone; use approved_image_id on the base row as the signal).
  const approvedRows = rows.filter((r) => baseOf(r)?.approved_image_id);

  if (approvedRows.length > 0) {
    const imgIds = approvedRows
      .map((r) => baseOf(r)?.approved_image_id)
      .filter((id): id is string => Boolean(id));

    const { data: imgData } =
      imgIds.length > 0
        ? await supabase
            .from("images")
            .select("id, stored_url")
            .in("id", imgIds)
        : { data: [] as { id: string; stored_url: string | null }[] };

    const urlMap = Object.fromEntries(
      (imgData || [])
        .filter((i) => i.stored_url)
        .map((i) => [i.id, i.stored_url!])
    );

    characterDetails = approvedRows.map((r) => {
      const base = baseOf(r);
      return {
        name: base?.name || "Unknown",
        role: r.role || "",
        description: r.prose_description,
        imageUrl: base?.approved_image_id
          ? urlMap[base.approved_image_id] || null
          : null,
      };
    });
  }

  const heroUrl = series.cover_sizes?.hero ?? null;
  const longBlurb = resolveLongBlurb(series);
  const firstChapterHref =
    posts && posts.length > 0
      ? `/stories/${series.slug}/${posts[0].part_number}`
      : null;

  return (
    <div>
      {/* ===== HERO ===== */}
      {/* Desktop: two-column (cover left ~40%, text right ~60%).         */}
      {/* Mobile: stacked, cover first, constrained max-height.           */}
      <header className="mb-12">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-12">
          {heroUrl && (
            <div className="mx-auto w-full max-w-sm lg:mx-0 lg:w-[40%] lg:max-w-none lg:shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={heroUrl}
                alt={`${series.title} cover`}
                className="w-full rounded-lg border border-amber-900/20 shadow-[0_0_40px_-10px_rgba(217,119,6,0.25)]"
                loading="eager"
              />
            </div>
          )}
          <div className={heroUrl ? "lg:w-[60%]" : "mx-auto w-full max-w-2xl text-center"}>
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
            <p className="mt-3 text-sm italic text-warm-400">
              By Nontsikelelo Mabaso
            </p>
            {longBlurb && (
              <p className="mt-6 max-w-2xl whitespace-pre-line text-base leading-relaxed text-warm-200">
                {longBlurb}
              </p>
            )}
            <p className="mt-4 text-sm text-warm-500">
              {series.total_parts}{" "}
              {series.total_parts === 1 ? "part" : "parts"}
            </p>
            {firstChapterHref && (
              <Link
                href={firstChapterHref}
                className="mt-8 inline-flex items-center gap-2 rounded-lg bg-amber-700 px-6 py-3 text-sm font-semibold text-amber-50 transition-colors hover:bg-amber-600"
              >
                Start Reading
                <span>&rarr;</span>
              </Link>
            )}
          </div>
        </div>
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
