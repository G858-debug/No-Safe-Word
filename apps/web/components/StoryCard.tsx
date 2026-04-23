import Link from "next/link";

interface StoryCardProps {
  slug: string;
  title: string;
  /** Preferred blurb text. Falls back to description via resolveShortBlurb at the caller. */
  shortBlurb: string | null;
  totalParts: number;
  hashtag: string | null;
  /** cover_sizes.card (600×900 JPEG) if compositing has completed, else null → placeholder. */
  coverCardUrl: string | null;
}

export default function StoryCard({
  slug,
  title,
  shortBlurb,
  totalParts,
  hashtag,
  coverCardUrl,
}: StoryCardProps) {
  return (
    <Link href={`/stories/${slug}`} className="group block">
      <article className="overflow-hidden rounded-xl border border-amber-900/20 bg-surface-raised transition-all duration-300 hover:border-amber-800/50 hover:bg-surface-overlay hover:shadow-[0_0_30px_-5px_rgba(217,119,6,0.15)]">
        {/* Cover image — 2:3 portrait to match the composited `card` size (600×900). */}
        <div className="relative aspect-[2/3] overflow-hidden bg-surface-overlay">
          {coverCardUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverCardUrl}
              alt={title}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            // Fallback: title in serif over a warm gradient. Reads as
            // intentional rather than missing.
            <div
              className="flex h-full w-full items-center justify-center bg-gradient-to-br from-amber-900/30 via-surface-overlay to-[#3A0F14]/40 px-4 text-center"
              aria-label={title}
            >
              <span
                className="text-2xl text-amber-50/90 leading-tight"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                {title}
              </span>
            </div>
          )}
          {/* Part count badge. No gradient overlay when we have a composited cover —
              the composite already has its own bottom gradient + typography, so
              layering another overlay would muddy it. */}
          <div className="absolute bottom-3 left-3">
            <span className="rounded-full bg-amber-900/60 px-2.5 py-1 text-xs text-amber-100 backdrop-blur-sm">
              {totalParts} {totalParts === 1 ? "part" : "parts"}
            </span>
          </div>
        </div>

        {/* Text content */}
        <div className="p-4">
          <h3
            className="text-lg font-bold text-amber-50 transition-colors group-hover:text-amber-300"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {title}
          </h3>
          {shortBlurb && (
            <p className="mt-2 line-clamp-2 text-sm text-warm-300">
              {shortBlurb}
            </p>
          )}
          {hashtag && (
            <p className="mt-2 text-xs text-amber-700">#{hashtag}</p>
          )}
        </div>
      </article>
    </Link>
  );
}
