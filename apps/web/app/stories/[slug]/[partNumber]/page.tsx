import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@no-safe-word/story-engine";
import type {
  StorySeriesRow,
  StoryPostRow,
  StoryImagePromptRow,
} from "@no-safe-word/shared";
import StoryRenderer from "@/components/StoryRenderer";
import ChapterNav from "@/components/ChapterNav";
import ReadingProgress from "@/components/ReadingProgress";
import PaywallGate from "@/components/PaywallGate";
import { createClient } from "@/lib/supabase/server";
import { checkSeriesAccess, truncateToWords } from "@/lib/access";

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

  const { data: seriesData } = await supabase
    .from("story_series")
    .select("id, title")
    .eq("slug", slug)
    .eq("status", "published")
    .single();

  const series = seriesData as Pick<StorySeriesRow, "id" | "title"> | null;
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

  return {
    title: `${post.title} — ${series.title}`,
    description: `Part ${partNumber} of ${series.title} by Nontsikelelo. Erotic fiction for adults.`,
    openGraph: {
      title: `${post.title} — ${series.title}`,
      description: `Part ${partNumber} of ${series.title} by Nontsikelelo.`,
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

  // 1. Fetch series by slug
  const { data: seriesData } = await supabase
    .from("story_series")
    .select("id, title, slug, total_parts")
    .eq("slug", slug)
    .eq("status", "published")
    .single();

  const series = seriesData as Pick<
    StorySeriesRow,
    "id" | "title" | "slug" | "total_parts"
  > | null;
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

  // 3. Check access for Part 2+
  let hasAccess = true;
  let isAuthenticated = false;

  if (partNumber > 1) {
    const authSupabase = await createClient();
    const {
      data: { user },
    } = await authSupabase.auth.getUser();
    isAuthenticated = !!user;

    const access = await checkSeriesAccess(
      user?.id ?? null,
      series.id,
      partNumber
    );
    hasAccess = access.hasAccess;
  }

  // 4. Determine content to display
  const displayContent = hasAccess
    ? post.website_content
    : truncateToWords(post.website_content, 300);

  // 5. Fetch approved website images for this post (only if has access)
  let inlineImages: { url: string; afterWord: number; alt: string }[] = [];

  if (hasAccess) {
    const { data: imagePrompts } = await supabase
      .from("story_image_prompts")
      .select(
        "id, image_type, pairs_with, position, position_after_word, character_name, image_id"
      )
      .eq("post_id", post.id)
      .eq("status", "approved")
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
            .map((img) => [img.id, img.stored_url!])
        );
      }
    }

    // For paired images without position_after_word, look up the paired prompt
    const pairedIds = (imagePrompts || [])
      .filter((ip) => ip.pairs_with && ip.position_after_word == null)
      .map((ip) => ip.pairs_with!);

    let pairedPositions: Record<string, number | null> = {};
    if (pairedIds.length > 0) {
      const { data: pairedPrompts } = await supabase
        .from("story_image_prompts")
        .select("id, position_after_word")
        .in("id", pairedIds);

      if (pairedPrompts) {
        pairedPositions = Object.fromEntries(
          pairedPrompts.map((p) => [p.id, p.position_after_word])
        );
      }
    }

    inlineImages = (imagePrompts || [])
      .filter((ip) => ip.image_id && imageUrlMap[ip.image_id])
      .map((ip) => {
        let afterWord: number | null = ip.position_after_word;

        if (afterWord == null && ip.pairs_with) {
          afterWord = pairedPositions[ip.pairs_with] ?? null;
        }

        return {
          url: imageUrlMap[ip.image_id!],
          afterWord: afterWord ?? Infinity,
          alt: ip.character_name || "Story illustration",
        };
      })
      .sort((a, b) => a.afterWord - b.afterWord);
  }

  // 6. Check for adjacent chapters
  const { data: adjacentPosts } = await supabase
    .from("story_posts")
    .select("part_number, title")
    .eq("series_id", series.id)
    .eq("status", "published")
    .in("part_number", [partNumber - 1, partNumber + 1]);

  const prevPost = adjacentPosts?.find(
    (p) => p.part_number === partNumber - 1
  );
  const nextPost = adjacentPosts?.find(
    (p) => p.part_number === partNumber + 1
  );

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
            {post.title}
          </h1>
          <p className="mt-4 text-sm italic text-warm-400">By Nontsikelelo</p>
        </header>

        {/* Story content */}
        <div className="mx-auto max-w-reader">
          <StoryRenderer text={displayContent} images={inlineImages} />
        </div>

        {/* Paywall gate for paywalled content */}
        {!hasAccess && (
          <div className="mx-auto max-w-reader">
            <PaywallGate
              seriesSlug={series.slug}
              seriesTitle={series.title}
              partNumber={partNumber}
              isAuthenticated={isAuthenticated}
            />
          </div>
        )}

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
