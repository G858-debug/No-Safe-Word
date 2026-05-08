import type { AuthorNotes as AuthorNotesData } from "@no-safe-word/shared";
import type { PublishedAuthor } from "@/lib/server/get-published-series";
import { ShareButton } from "./ShareButton";

interface Props {
  notes: AuthorNotesData;
  imageUrl: string | null;
  approvedAt: string;
  author: PublishedAuthor | null;
  /** Absolute or path-relative URL of the chapter page hosting this section. Used by the share button. */
  shareUrl: string;
  /** The series title — used as the Web Share API title when supported. */
  seriesTitle: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 4 — public-facing Author's Notes section.
//
// Renders at the end of the final chapter, behind the paywall. The caller
// is responsible for the three-condition gate before mounting this:
//   (a) story_series.author_notes IS NOT NULL
//   (b) story_series.author_note_approved_at IS NOT NULL
//   (c) the chapter being rendered is the final chapter
// AND the reader has paywall access. This component does NOT re-check
// any of those — it trusts the caller.
//
// Visual direction: clear break from the chapter prose (top divider +
// background tint + heading typography swap to serif-medium). The reader
// should feel "the story has ended; the writer is talking to me now."
// Image is constrained to max-w-reader so it sits inside the prose
// column rather than breaking out into hero territory.
// ─────────────────────────────────────────────────────────────────────────

export function AuthorsNotes({
  notes,
  imageUrl,
  approvedAt,
  author,
  shareUrl,
  seriesTitle,
}: Props) {
  const authorName = author?.name ?? "Nontsikelelo Mabaso";
  const headingName = author?.name ? `${author.name}'s` : "Nontsikelelo's";
  const portraitUrl = author?.portrait_url ?? null;

  // Format the approval timestamp as a quiet "Published Mon Day, Year"
  // string. SAST is the relevant timezone for the audience.
  const publishedLabel = formatPublishedDate(approvedAt);

  return (
    <section
      className="mt-16 border-t border-amber-900/30 pt-16"
      aria-labelledby="authors-notes-heading"
    >
      <div className="mx-auto max-w-reader rounded-lg border border-amber-900/20 bg-surface-raised/40 px-6 py-10 sm:px-10">
        <p className="mb-3 text-xs uppercase tracking-[0.25em] text-amber-700">
          Author&apos;s Reflection
        </p>
        <h2
          id="authors-notes-heading"
          className="mb-8 text-2xl font-medium text-amber-50 sm:text-3xl"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {headingName} Notes
        </h2>

        {imageUrl && (
          <figure className="mb-10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={`Accompanying image for ${authorName}'s notes on ${seriesTitle}`}
              className="aspect-video w-full rounded-md object-cover"
              loading="lazy"
            />
          </figure>
        )}

        <div
          className="whitespace-pre-wrap text-base leading-[1.85] text-warm-100 sm:text-lg sm:leading-[1.85]"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {notes.website_long}
        </div>

        {/* Author byline strip — small, quiet, a beat between the body
            text and the share affordance. Falls back to name-only when
            portrait is missing (Phase 1 seeded Nontsikelelo without a
            portrait URL). */}
        <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-amber-900/20 pt-6 text-sm text-warm-300">
          {portraitUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={portraitUrl}
              alt={authorName}
              className="h-10 w-10 rounded-full border border-amber-900/40 object-cover"
              loading="lazy"
            />
          )}
          <div className="flex flex-col leading-tight">
            <span className="font-medium text-warm-100">{authorName}</span>
            {publishedLabel && (
              <span className="text-xs text-warm-400">
                Published {publishedLabel}
              </span>
            )}
          </div>
        </div>

        {notes.social_caption && (
          <div className="mt-6">
            <ShareButton
              title={`${headingName} Notes — ${seriesTitle}`}
              text={notes.social_caption}
              url={shareUrl}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function formatPublishedDate(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
