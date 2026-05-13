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
import { formatChapterTitle } from "@/lib/format";
import { MeetTheCast, type CastCharacter } from "@/components/MeetTheCast";

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
  const authorName = series.author?.name ?? "Nontsikelelo";
  const description =
    shortBlurb || `Read ${series.title} by ${authorName} on No Safe Word.`;

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

  const hideImages = process.env.HIDE_CHAPTER_IMAGES === "true";

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

  // Phase 4 — fetch characters with their Stage-9 profile-card payload.
  // Public render uses the seven reader-facing fields + card_image_url;
  // card_image_prompt and prose_description are editorial-only and stay
  // out of the public surface.
  const { data: characters } = await supabase
    .from("story_characters")
    .select(
      `id, role, character_id,
       characters:character_id (
         id, name,
         card_image_url, card_approved_at,
         archetype_tag, vibe_line, wants, needs,
         defining_quote, watch_out_for, bio_short
       )`
    )
    .eq("series_id", series.id);

  type JoinedCharacter = {
    id: string; // story_characters.id
    role: string | null;
    character_id: string;
    characters:
      | {
          id: string;
          name: string;
          card_image_url: string | null;
          card_approved_at: string | null;
          archetype_tag: string | null;
          vibe_line: string | null;
          wants: string | null;
          needs: string | null;
          defining_quote: string | null;
          watch_out_for: string | null;
          bio_short: string | null;
        }
      | {
          id: string;
          name: string;
          card_image_url: string | null;
          card_approved_at: string | null;
          archetype_tag: string | null;
          vibe_line: string | null;
          wants: string | null;
          needs: string | null;
          defining_quote: string | null;
          watch_out_for: string | null;
          bio_short: string | null;
        }[]
      | null;
  };
  const characterRows = (characters ?? []) as unknown as JoinedCharacter[];
  const baseOf = (r: JoinedCharacter) =>
    Array.isArray(r.characters) ? (r.characters[0] ?? null) : r.characters;

  // MEET THE CAST renders only characters whose profile card has been
  // approved. Unapproved cards never leak to the public site, even when
  // their fields are populated in the DB.
  const cast: CastCharacter[] = characterRows
    .filter((r) => Boolean(baseOf(r)?.card_approved_at))
    .map((r) => {
      const base = baseOf(r)!;
      return {
        id: r.id,
        name: base.name,
        role: r.role,
        card_image_url: base.card_image_url,
        archetype_tag: base.archetype_tag,
        vibe_line: base.vibe_line,
        wants: base.wants,
        needs: base.needs,
        defining_quote: base.defining_quote,
        watch_out_for: base.watch_out_for,
        bio_short: base.bio_short,
      };
    });

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
                className={`w-full rounded-lg border border-amber-900/20 shadow-[0_0_40px_-10px_rgba(217,119,6,0.25)] ${
                  hideImages ? "blur-heavy" : ""
                }`}
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
              By {series.author?.name ?? "Nontsikelelo Mabaso"}
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

      {/* Phase 4 — MEET THE CAST. Replaces the legacy name+role+portrait
          section. Renders only characters with card_approved_at IS NOT NULL.
          Hidden entirely when no approved cards exist. */}
      <MeetTheCast characters={cast} isBlurred={hideImages} />


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
              className="group flex items-center gap-4 rounded-lg border border-amber-500/60 bg-amber-700/40 px-5 py-4 transition-all hover:border-amber-400/80 hover:bg-amber-700/55"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-900/30 text-xs font-bold text-amber-400">
                {post.part_number}
              </span>
              <span className="font-medium text-warm-100 transition-colors group-hover:text-amber-300">
                {formatChapterTitle(post.part_number, post.title)}
              </span>
              <span className="ml-auto text-amber-300/80 transition-transform group-hover:translate-x-0.5">
                &rarr;
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
