import React from "react";
import { splitBlocks } from "@/lib/story-text";

interface InlineImage {
  url: string;
  afterWord: number;
  alt: string;
}

/**
 * Renders story text with inline images positioned by word count.
 * Word counting (paragraphs only, no headings or scene breaks) is
 * shared with the Publisher preview via lib/story-text.ts so an image
 * at position_after_word=N lands in the same paragraph in both views.
 */
export default function StoryRenderer({
  text,
  images,
  isBlurred,
}: {
  text: string;
  images: InlineImage[];
  isBlurred?: boolean;
}) {
  const blocks = splitBlocks(text);
  const positioned = images
    .filter((i) => i.afterWord !== Infinity)
    .sort((a, b) => a.afterWord - b.afterWord);
  const trailing = images.filter((i) => i.afterWord === Infinity);

  const elements: React.ReactNode[] = [];
  let cumulativeWords = 0;
  let imageIdx = 0;

  blocks.forEach((block, i) => {
    if (block.kind === "scene-break") {
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
      return;
    }

    if (block.kind === "heading") {
      elements.push(
        <h2
          key={`h-${i}`}
          className="mb-6 mt-14 text-2xl font-bold text-amber-50 sm:text-3xl"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {block.text}
        </h2>
      );
      return;
    }

    cumulativeWords += block.words;

    elements.push(
      <p
        key={`p-${i}`}
        className="mb-6 text-base leading-[1.9] text-warm-100 sm:text-lg sm:leading-[1.9]"
      >
        {block.text.split("\n").map((line, j) => (
          <span key={j}>
            {j > 0 && <br />}
            {line}
          </span>
        ))}
      </p>
    );

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
            className={`story-image ${isBlurred ? "blur-heavy" : ""}`}
            loading="lazy"
          />
        </figure>
      );
      imageIdx++;
    }
  });

  while (imageIdx < positioned.length) {
    elements.push(
      <figure key={`img-tail-${imageIdx}`} className="my-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={positioned[imageIdx].url}
          alt={positioned[imageIdx].alt}
          className={`story-image ${isBlurred ? "blur-heavy" : ""}`}
          loading="lazy"
        />
      </figure>
    );
    imageIdx++;
  }

  for (let i = 0; i < trailing.length; i++) {
    elements.push(
      <figure key={`img-end-${i}`} className="my-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={trailing[i].url}
          alt={trailing[i].alt}
          className={`story-image ${isBlurred ? "blur-heavy" : ""}`}
          loading="lazy"
        />
      </figure>
    );
  }

  return <>{elements}</>;
}
