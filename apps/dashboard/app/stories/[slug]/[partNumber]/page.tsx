import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@no-safe-word/story-engine";
import type {
  StorySeriesRow,
  StoryPostRow,
  StoryImagePromptRow,
} from "@no-safe-word/shared";

export const revalidate = 3600;

interface PageProps {
  params: { slug: string; partNumber: string };
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const partNumber = parseInt(params.partNumber, 10);
  if (isNaN(partNumber)) return { title: "Not Found | No Safe Word" };

  const { data: seriesData } = await supabase
    .from("story_series")
    .select("id, title")
    .eq("slug", params.slug)
    .eq("status", "published")
    .single();

  const series = seriesData as Pick<
    StorySeriesRow,
    "id" | "title"
  > | null;
  if (!series) return { title: "Not Found | No Safe Word" };

  const { data: postData } = await supabase
    .from("story_posts")
    .select("title")
    .eq("series_id", series.id)
    .eq("part_number", partNumber)
    .eq("status", "published")
    .single();

  const post = postData as Pick<StoryPostRow, "title"> | null;
  if (!post) return { title: "Not Found | No Safe Word" };

  return {
    title: `${post.title} — ${series.title} | No Safe Word`,
    description: `Part ${partNumber} of ${series.title} by Nontsikelelo. Explicit erotic fiction for adults.`,
  };
}

// ---------------------------------------------------------------------------
// Content renderer — converts text + images into structured elements
// ---------------------------------------------------------------------------

interface InlineImage {
  url: string;
  afterWord: number;
  alt: string;
}

function renderStoryContent(text: string, images: InlineImage[]) {
  const blocks = text.split(/\n\n+/);
  const positioned = images
    .filter((i) => i.afterWord !== Infinity)
    .sort((a, b) => a.afterWord - b.afterWord);
  const trailing = images.filter((i) => i.afterWord === Infinity);

  const elements: React.ReactNode[] = [];
  let cumulativeWords = 0;
  let imageIdx = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();
    if (!block) continue;

    // Scene break: ---- or --- or ___
    if (/^[-_]{3,}$/.test(block)) {
      elements.push(
        <div
          key={`break-${i}`}
          className="my-10 flex items-center justify-center gap-3"
          aria-hidden="true"
        >
          <span className="h-px w-12 bg-amber-900/50" />
          <span className="text-xs text-amber-900/60">&#10022;</span>
          <span className="h-px w-12 bg-amber-900/50" />
        </div>
      );
      continue;
    }

    // Heading: ## Title
    if (block.startsWith("## ")) {
      elements.push(
        <h2
          key={`h-${i}`}
          className="mb-6 mt-12 text-2xl font-bold text-amber-50"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {block.slice(3)}
        </h2>
      );
      continue;
    }

    // Regular paragraph
    const wordCount = block.split(/\s+/).length;
    cumulativeWords += wordCount;

    elements.push(
      <p key={`p-${i}`} className="mb-6 leading-[1.8] text-[#d4cdc0]">
        {block.split("\n").map((line, j) => (
          <span key={j}>
            {j > 0 && <br />}
            {line}
          </span>
        ))}
      </p>
    );

    // Insert images whose position falls within accumulated word count
    while (
      imageIdx < positioned.length &&
      positioned[imageIdx].afterWord <= cumulativeWords
    ) {
      elements.push(
        <figure key={`img-${imageIdx}`} className="my-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={positioned[imageIdx].url}
            alt={positioned[imageIdx].alt}
            className="w-full rounded-lg shadow-xl shadow-black/40"
            loading="lazy"
          />
        </figure>
      );
      imageIdx++;
    }
  }

  // Remaining positioned images
  while (imageIdx < positioned.length) {
    elements.push(
      <figure key={`img-tail-${imageIdx}`} className="my-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={positioned[imageIdx].url}
          alt={positioned[imageIdx].alt}
          className="w-full rounded-lg shadow-xl shadow-black/40"
          loading="lazy"
        />
      </figure>
    );
    imageIdx++;
  }

  // Trailing images (no position data — appended at end)
  for (let i = 0; i < trailing.length; i++) {
    elements.push(
      <figure key={`img-end-${i}`} className="my-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={trailing[i].url}
          alt={trailing[i].alt}
          className="w-full rounded-lg shadow-xl shadow-black/40"
          loading="lazy"
        />
      </figure>
    );
  }

  return elements;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ChapterPage({ params }: PageProps) {
  const partNumber = parseInt(params.partNumber, 10);
  if (isNaN(partNumber)) notFound();

  // 1. Fetch series by slug
  const { data: seriesData } = await supabase
    .from("story_series")
    .select("id, title, slug, total_parts")
    .eq("slug", params.slug)
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

  // 3. Fetch approved website images for this post
  const { data: imagePrompts } = await supabase
    .from("story_image_prompts")
    .select(
      "id, image_type, pairs_with, position, position_after_word, character_name, image_id"
    )
    .eq("post_id", post.id)
    .eq("status", "approved")
    .in("image_type", ["website_nsfw_paired", "website_only"]);

  // 4. Fetch stored image URLs
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

  // 5. For paired images without position_after_word, look up the paired prompt
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

  // 6. Build the sorted inline image list
  const inlineImages: InlineImage[] = (imagePrompts || [])
    .filter((ip) => ip.image_id && imageUrlMap[ip.image_id])
    .map((ip) => {
      let afterWord: number | null = ip.position_after_word;

      // For paired images, fall back to the paired SFW prompt's position
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

  // 7. Check for adjacent chapters (prev/next)
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
    <article>
      {/* Back to series */}
      <Link
        href={`/stories/${series.slug}`}
        className="mb-10 inline-flex items-center text-sm text-[#6a5f52] transition-colors hover:text-amber-400"
      >
        &larr; {series.title}
      </Link>

      {/* Chapter header */}
      <header className="mb-12 text-center">
        <p className="mb-2 text-xs uppercase tracking-widest text-amber-800">
          Part {post.part_number}
        </p>
        <h1
          className="text-3xl font-bold text-amber-50 sm:text-4xl"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {post.title}
        </h1>
        <p className="mt-3 text-sm italic text-[#6a5f52]">
          By Nontsikelelo
        </p>
      </header>

      {/* Story content */}
      <div className="mx-auto max-w-[680px]">
        {renderStoryContent(post.website_content, inlineImages)}
      </div>

      {/* Chapter navigation */}
      <nav className="mx-auto mt-16 flex max-w-[680px] items-center justify-between border-t border-amber-900/30 pt-8">
        {prevPost ? (
          <Link
            href={`/stories/${series.slug}/${prevPost.part_number}`}
            className="group flex items-center gap-2 text-sm text-[#8a7e6b] transition-colors hover:text-amber-400"
          >
            <span className="transition-transform group-hover:-translate-x-0.5">
              &larr;
            </span>
            <span>
              <span className="block text-xs text-[#5a5245]">
                Previous
              </span>
              <span>{prevPost.title}</span>
            </span>
          </Link>
        ) : (
          <div />
        )}
        {nextPost ? (
          <Link
            href={`/stories/${series.slug}/${nextPost.part_number}`}
            className="group flex items-center gap-2 text-right text-sm text-[#8a7e6b] transition-colors hover:text-amber-400"
          >
            <span>
              <span className="block text-xs text-[#5a5245]">Next</span>
              <span>{nextPost.title}</span>
            </span>
            <span className="transition-transform group-hover:translate-x-0.5">
              &rarr;
            </span>
          </Link>
        ) : (
          <div />
        )}
      </nav>

      {/* End of story — back to series */}
      <div className="mt-12 text-center">
        <Link
          href={`/stories/${series.slug}`}
          className="text-sm text-amber-800 transition-colors hover:text-amber-500"
        >
          Back to all chapters
        </Link>
      </div>
    </article>
  );
}
