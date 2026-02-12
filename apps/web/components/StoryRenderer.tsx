import React from "react";

interface InlineImage {
  url: string;
  afterWord: number;
  alt: string;
}

/**
 * Renders story text with inline images positioned by word count.
 * Handles scene breaks (---), headings (## Title), and paragraphs.
 */
export default function StoryRenderer({
  text,
  images,
}: {
  text: string;
  images: InlineImage[];
}) {
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
          className="my-12 flex items-center justify-center gap-3"
          aria-hidden="true"
        >
          <span className="h-px w-16 bg-amber-900/40" />
          <span className="text-xs text-amber-900/50">&#10022;</span>
          <span className="h-px w-16 bg-amber-900/40" />
        </div>
      );
      continue;
    }

    // Heading: ## Title
    if (block.startsWith("## ")) {
      elements.push(
        <h2
          key={`h-${i}`}
          className="mb-6 mt-14 text-2xl font-bold text-amber-50 sm:text-3xl"
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
      <p
        key={`p-${i}`}
        className="mb-6 text-base leading-[1.9] text-warm-100 sm:text-lg sm:leading-[1.9]"
      >
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
        <figure key={`img-${imageIdx}`} className="my-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={positioned[imageIdx].url}
            alt={positioned[imageIdx].alt}
            className="story-image"
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
      <figure key={`img-tail-${imageIdx}`} className="my-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={positioned[imageIdx].url}
          alt={positioned[imageIdx].alt}
          className="story-image"
          loading="lazy"
        />
      </figure>
    );
    imageIdx++;
  }

  // Trailing images (no position data — appended at end)
  for (let i = 0; i < trailing.length; i++) {
    elements.push(
      <figure key={`img-end-${i}`} className="my-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={trailing[i].url}
          alt={trailing[i].alt}
          className="story-image"
          loading="lazy"
        />
      </figure>
    );
  }

  return <>{elements}</>;
}
