import Link from "next/link";

interface StoryCardProps {
  slug: string;
  title: string;
  description: string | null;
  totalParts: number;
  hashtag: string | null;
  coverImageUrl: string | null;
}

export default function StoryCard({
  slug,
  title,
  description,
  totalParts,
  hashtag,
  coverImageUrl,
}: StoryCardProps) {
  return (
    <Link href={`/stories/${slug}`} className="group block">
      <article className="overflow-hidden rounded-xl border border-amber-900/20 bg-surface-raised transition-all hover:border-amber-900/40 hover:bg-surface-overlay">
        {/* Cover image */}
        <div className="relative aspect-[3/4] overflow-hidden bg-surface-overlay">
          {coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverImageUrl}
              alt={title}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <span
                className="text-4xl text-amber-900/40"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                NSW
              </span>
            </div>
          )}
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
          {/* Part count badge */}
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
          {description && (
            <p className="mt-2 line-clamp-2 text-sm text-warm-300">
              {description}
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
