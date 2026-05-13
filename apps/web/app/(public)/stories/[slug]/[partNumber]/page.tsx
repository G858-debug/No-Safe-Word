import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@no-safe-word/story-engine";
import type { StoryPostRow, StoryImagePromptRow } from "@no-safe-word/shared";
import StoryRenderer from "@/components/StoryRenderer";
import ChapterNav from "@/components/ChapterNav";
import ReadingProgress from "@/components/ReadingProgress";
import EmailGate from "@/components/EmailGate";
import PaywallGate from "@/components/PaywallGate";
import { GatePulse } from "@/components/GatePulse";
import { AuthorsNotes } from "@/components/AuthorsNotes";
import { createClient } from "@/lib/supabase/server";
import { checkSeriesAccess, splitAtWords } from "@/lib/access";
import { logEvent } from "@/lib/server/events";
import { formatChapterTitle } from "@/lib/format";
import { getPublishedSeriesBySlug } from "@/lib/server/get-published-series";

export const revalidate = 3600;

interface PageProps {
  params: Promise<{ slug: string; partNumber: string }>;
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug, partNumber: partNumberStr } = await params;
  const partNumber = parseInt(partNumberStr, 10);
  if (isNaN(partNumber)) return { title: "Not Found" };

  // Use the shared helper so metadata sees the same field set as the
  // page body (including the joined author row used for the byline).
  const series = await getPublishedSeriesBySlug(slug);
  if (!series) return { title: "Not Found" };

  const { data: postData } = await supabase
    .from("story_posts")
    .select("title")
    .eq("series_id", series.id)
    .eq("part_number", partNumber)
    .eq("status", "published")
    .single();

  const post = postData as Pick<StoryPostRow, "title"> | null;
  if (!post) return { title: "Not Found" };

  const chapterLabel = formatChapterTitle(partNumber, post.title);
  const authorName = series.author?.name ?? "Nontsikelelo";
  return {
    title: `${chapterLabel} — ${series.title}`,
    description: `${chapterLabel} of ${series.title} by ${authorName}. Erotic fiction for adults.`,
    openGraph: {
      title: `${chapterLabel} — ${series.title}`,
      description: `${chapterLabel} of ${series.title} by ${authorName}.`,
      type: "article",
    },
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ChapterPage({ params }: PageProps) {
  const { slug, partNumber: partNumberStr } = await params;
  const partNumber = parseInt(partNumberStr, 10);
  if (isNaN(partNumber)) notFound();

  // 1. Fetch series by slug. Phase 4 swaps the inline select for the
  //    shared helper so the chapter page sees the same field set as
  //    the story detail page — including author + notes data needed
  //    for the final-chapter Author's Notes section.
  const series = await getPublishedSeriesBySlug(slug);
  if (!series) notFound();

  // 2. Fetch the specific post
  const { data: postData } = await supabase
    .from("story_posts")
    .select("*")
    .eq("series_id", series.id)
    .eq("part_number", partNumber)
    .eq("status", "published")
    .single();

  const post = postData as StoryPostRow | null;
  if (!post) notFound();

  // 3. Fetch user once — used for access check, analytics, and
  //    downstream components. Hoisted above the `partNumber > 1`
  //    guard so `reading.chapter_view` can record userId on Part 1
  //    too when the reader is signed in.
  const authSupabase = await createClient();
  const {
    data: { user },
  } = await authSupabase.auth.getUser();

  const hideImages = process.env.HIDE_CHAPTER_IMAGES
    ? process.env.HIDE_CHAPTER_IMAGES === "true"
    : false;

  // 4. Check access for Part 2+ (Part 1 is always free)
  let hasAccess = true;
  if (partNumber > 1) {
    const access = await checkSeriesAccess(
      user?.id ?? null,
      series.id,
      partNumber,
    );
    hasAccess = access.hasAccess;
  }

  // Analytics: chapter view (always emitted). If the reader is paywalled,
  // additionally emit paywall.hit — these are two separate facts, not one.
  await logEvent({
    eventType: "reading.chapter_view",
    userId: user?.id ?? null,
    metadata: {
      series_slug: slug,
      part_number: partNumber,
      has_access: hasAccess,
    },
  });
  if (!hasAccess) {
    await logEvent({
      eventType: "paywall.hit",
      userId: user?.id ?? null,
      metadata: {
        series_slug: slug,
        part_number: partNumber,
      },
    });
  }

  // 5. Split prose at the ~300-word mark on every chapter where the
  //    gate could fire (partNumber > 1). The split is paragraph-
  //    aligned, so headWords is usually < 300. We render the head
  //    chunk, then a stable `#gate-position` anchor, then either the
  //    gate (if !hasAccess) or the tail chunk (if hasAccess). This
  //    keeps the anchor at the same word position in both renderings
  //    so authenticated readers landing via magic-link scroll to
  //    where the gate previously sat.
  //
  //    Chapter 1 always shows full prose with no split — it's free
  //    for everyone and has no gate, so an anchor mid-chapter would
  //    be meaningless.
  const split =
    partNumber > 1
      ? splitAtWords(post.website_content, 300)
      : { head: post.website_content, tail: "", headWords: Infinity };

  // 6a. Fetch the chapter hero image — runs regardless of access.
  //     The hero is SFW by definition (image_type='facebook_sfw' +
  //     is_chapter_hero=true) and the EmailGate uses it as the card
  //     header for non-paying readers, so it must NOT live inside the
  //     hasAccess branch (Phase E.1).
  let heroImages: { url: string; alt: string }[] = [];
  {
    const { data: heroPrompts } = await supabase
      .from("story_image_prompts")
      .select("character_name, image_id, position")
      .eq("post_id", post.id)
      .eq("status", "approved")
      .eq("excluded_from_publish", false)
      .eq("image_type", "facebook_sfw")
      .eq("is_chapter_hero", true)
      .order("position", { ascending: true })
      .limit(1);

    const heroIds = (heroPrompts ?? [])
      .map((ip) => ip.image_id)
      .filter((id): id is string => id !== null);

    if (heroIds.length > 0) {
      const { data: images } = await supabase
        .from("images")
        .select("id, stored_url")
        .in("id", heroIds);

      const urlMap = Object.fromEntries(
        (images ?? [])
          .filter((img) => img.stored_url)
          .map((img) => [img.id, img.stored_url!]),
      );

      heroImages = (heroPrompts ?? [])
        .filter((ip) => ip.image_id && urlMap[ip.image_id])
        .map((ip) => ({
          url: urlMap[ip.image_id!],
          alt: ip.character_name || "Story illustration",
        }));
    }
  }

  // 6b. Fetch inline NSFW + website-only images — gated, only loaded
  //     when the reader has access. Hero is already handled above.
  let inlineImages: { url: string; afterWord: number; alt: string }[] = [];

  if (hasAccess) {
    const { data: imagePrompts } = await supabase
      .from("story_image_prompts")
      .select(
        "id, image_type, pairs_with, position, position_after_word, character_name, image_id",
      )
      .eq("post_id", post.id)
      .eq("status", "approved")
      .eq("excluded_from_publish", false)
      .in("image_type", ["website_nsfw_paired", "website_only"]);

    const imageIds = (imagePrompts || [])
      .map((ip) => ip.image_id)
      .filter((id): id is string => id !== null);

    let imageUrlMap: Record<string, string> = {};
    if (imageIds.length > 0) {
      const { data: images } = await supabase
        .from("images")
        .select("id, stored_url")
        .in("id", imageIds);

      if (images) {
        imageUrlMap = Object.fromEntries(
          images
            .filter((img) => img.stored_url)
            .map((img) => [img.id, img.stored_url!]),
        );
      }
    }

    // For paired images without position_after_word, look up the paired prompt
    const pairedIds = (imagePrompts || [])
      .filter(
        (ip) =>
          ip.image_type === "website_nsfw_paired" &&
          ip.pairs_with &&
          ip.position_after_word == null,
      )
      .map((ip) => ip.pairs_with!);

    let pairedPositions: Record<string, number | null> = {};
    if (pairedIds.length > 0) {
      // Mirror the main filter: an excluded SFW partner must not
      // contribute a position_after_word, otherwise we'd render the
      // unexcluded NSFW companion at a phantom location.
      const { data: pairedPrompts } = await supabase
        .from("story_image_prompts")
        .select("id, position_after_word")
        .in("id", pairedIds)
        .eq("excluded_from_publish", false);

      if (pairedPrompts) {
        pairedPositions = Object.fromEntries(
          pairedPrompts.map((p) => [p.id, p.position_after_word]),
        );
      }
    }

    const usableImagePrompts = (imagePrompts || []).filter(
      (ip) => ip.image_id && imageUrlMap[ip.image_id],
    );

    // Inline: website_nsfw_paired + website_only. A paired NSFW with no
    // resolvable position is silently skipped (and warned server-side)
    // rather than appended at the end of the chapter — orphan intimate
    // images dumped after the last paragraph were the original bug.
    inlineImages = usableImagePrompts
      .map((ip) => {
        let afterWord: number | null = ip.position_after_word;

        if (afterWord == null && ip.pairs_with) {
          afterWord = pairedPositions[ip.pairs_with] ?? null;
        }

        if (afterWord == null) {
          if (ip.image_type === "website_nsfw_paired") {
            console.warn(
              `[chapter-page] skipping orphan website_nsfw_paired image: no resolvable position_after_word`,
              { image_prompt_id: ip.id, post_id: post.id },
            );
          }
          return null;
        }

        return {
          url: imageUrlMap[ip.image_id!],
          afterWord,
          alt: ip.character_name || "Story illustration",
        };
      })
      .filter(
        (img): img is { url: string; afterWord: number; alt: string } =>
          img !== null,
      )
      .sort((a, b) => a.afterWord - b.afterWord);
  }

  // 7. Check for adjacent chapters
  const { data: adjacentPosts } = await supabase
    .from("story_posts")
    .select("part_number, title")
    .eq("series_id", series.id)
    .eq("status", "published")
    .in("part_number", [partNumber - 1, partNumber + 1]);

  const prevPost = adjacentPosts?.find((p) => p.part_number === partNumber - 1);
  const nextPost = adjacentPosts?.find((p) => p.part_number === partNumber + 1);

  return (
    <>
      <ReadingProgress />
      <article>
        {/* Back to series */}
        <Link
          href={`/stories/${series.slug}`}
          className="mb-10 inline-flex items-center text-sm text-warm-400 transition-colors hover:text-amber-400"
        >
          &larr; {series.title}
        </Link>

        {/* Chapter header */}
        <header className="mb-14 text-center">
          <p className="mb-2 text-xs uppercase tracking-[0.2em] text-amber-800">
            Part {post.part_number} of {series.total_parts}
          </p>
          <h1
            className="text-3xl font-bold text-amber-50 sm:text-4xl lg:text-5xl"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {formatChapterTitle(post.part_number, post.title)}
          </h1>
          <p className="mt-4 text-sm italic text-warm-400">
            By {series.author?.name ?? "Nontsikelelo"}
          </p>
        </header>

        {/* Story content. Head chunk → stable anchor → either the
            gate (unauthenticated) or the tail chunk (authenticated).
            Image partitioning: any image whose afterWord falls within
            the head chunk renders inline with the head; the rest move
            to the tail with afterWord re-zeroed against headWords.
            Infinity stays Infinity (trailing). */}
        <div className="mx-auto max-w-reader">
          {heroImages.length > 0 && (
            <div className="mb-10">
              {heroImages.map((img, idx) => (
                <figure key={`hero-${idx}`} className="my-10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.alt}
                    className={`story-image ${hideImages ? "blur-heavy" : ""}`}
                    loading={idx === 0 ? "eager" : "lazy"}
                  />
                </figure>
              ))}
            </div>
          )}

          <StoryRenderer
            text={split.head}
            images={inlineImages.filter((i) => i.afterWord <= split.headWords)}
            isBlurred={hideImages}
          />

          {partNumber > 1 && <span id="gate-position" aria-hidden="true" />}

          {hasAccess && partNumber > 1 && split.tail.length > 0 && (
            <StoryRenderer
              text={split.tail}
              images={inlineImages
                .filter((i) => i.afterWord > split.headWords)
                .map((i) => ({
                  ...i,
                  afterWord:
                    i.afterWord === Infinity
                      ? Infinity
                      : i.afterWord - split.headWords,
                }))}
              isBlurred={hideImages}
            />
          )}
        </div>

        {/* Phase 4 — Author's Notes. Final chapter only, behind the
            paywall, with notes + approval timestamp both present. The
            three-condition gate is enforced inline; AuthorsNotes itself
            does no re-checking. */}
        {hasAccess &&
          partNumber === series.total_parts &&
          series.author_notes &&
          series.author_note_approved_at && (
            <AuthorsNotes
              notes={series.author_notes}
              imageUrl={series.author_note_image_url}
              approvedAt={series.author_note_approved_at}
              author={series.author}
              shareUrl={`https://nosafeword.co.za/stories/${series.slug}/${partNumber}`}
              seriesTitle={series.title}
            />
          )}

        {/* Email gate for non-authenticated readers on chapter 2+.
            Sits outside the prose container so the gate card has its
            own spacing. The anchor lives in the prose container
            above; this gate renders right after the anchor in
            document order. */}
        {!hasAccess && (
          <div className="mx-auto mt-12 max-w-reader">
            {user && series.access_tier === "paid" ? (
              <PaywallGate
                seriesId={series.id}
                seriesSlug={series.slug}
                seriesTitle={series.title}
                partNumber={partNumber}
                isAuthenticated={true}
              />
            ) : (
              <EmailGate
                seriesSlug={series.slug}
                partNumber={partNumber}
                heroImageUrl={heroImages[0]?.url ?? null}
                isPaid={series.access_tier === "paid"}
              />
            )}
          </div>
        )}

        {/* Pulse the paragraph above the anchor on first navigation
            with #gate-position in the URL. Mounted regardless of
            access so post-magic-link redirects can find it; the
            component short-circuits when the hash or anchor is
            missing. */}
        <GatePulse />

        {/* Chapter navigation (only show if has access) */}
        {hasAccess && (
          <>
            <ChapterNav
              seriesSlug={series.slug}
              prev={
                prevPost
                  ? { partNumber: prevPost.part_number, title: prevPost.title }
                  : null
              }
              next={
                nextPost
                  ? { partNumber: nextPost.part_number, title: nextPost.title }
                  : null
              }
            />

            {/* End of story — back to series */}
            <div className="mt-12 text-center">
              <Link
                href={`/stories/${series.slug}`}
                className="text-sm text-amber-800 transition-colors hover:text-amber-500"
              >
                Back to all chapters
              </Link>
            </div>
          </>
        )}
      </article>
    </>
  );
}
