// Shared helpers for tokenising story text into renderable blocks and
// counting paragraph words. Used by both the public StoryRenderer and
// the Publisher's Website Preview so an image with
// position_after_word=N lands at the same paragraph boundary in both.
//
// Paragraph word counts EXCLUDE scene breaks (---/___) and headings
// (## ...). Including them would shift inline image positions whenever
// an editor inserts a heading.

export type StoryBlock =
  | { kind: "paragraph"; text: string; words: number }
  | { kind: "heading"; text: string }
  | { kind: "scene-break" };

const SCENE_BREAK_RE = /^[-_]{3,}$/;
const HEADING_PREFIX = "## ";

export function splitBlocks(text: string): StoryBlock[] {
  const raw = text.split(/\n\n+/);
  const blocks: StoryBlock[] = [];

  for (const piece of raw) {
    const trimmed = piece.trim();
    if (!trimmed) continue;

    if (SCENE_BREAK_RE.test(trimmed)) {
      blocks.push({ kind: "scene-break" });
      continue;
    }

    if (trimmed.startsWith(HEADING_PREFIX)) {
      blocks.push({ kind: "heading", text: trimmed.slice(HEADING_PREFIX.length) });
      continue;
    }

    // Preserve original (untrimmed) paragraph so single-newline soft
    // breaks within a paragraph survive into rendering.
    blocks.push({
      kind: "paragraph",
      text: piece,
      words: countParagraphWords(trimmed),
    });
  }

  return blocks;
}

export function countParagraphWords(paragraph: string): number {
  return paragraph.trim().split(/\s+/).filter(Boolean).length;
}

// Cumulative paragraph-word count after each block, in order.
// blocks[i] runs from cumulativeWords[i-1]+1..cumulativeWords[i].
// Heading and scene-break blocks contribute 0; their cumulative entry
// equals the previous block's.
export function cumulativeParagraphWords(blocks: StoryBlock[]): number[] {
  const cum: number[] = [];
  let acc = 0;
  for (const b of blocks) {
    if (b.kind === "paragraph") acc += b.words;
    cum.push(acc);
  }
  return cum;
}

// Total paragraph-word count for the chapter — what the drag-to-
// reposition logic uses as the upper bound for a "place at the very
// end" target.
export function totalParagraphWords(text: string): number {
  return cumulativeParagraphWords(splitBlocks(text)).at(-1) ?? 0;
}
