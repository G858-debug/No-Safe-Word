import Link from "next/link";

interface Chapter {
  partNumber: number;
  title: string;
}

interface ChapterNavProps {
  seriesSlug: string;
  prev: Chapter | null;
  next: Chapter | null;
}

export default function ChapterNav({
  seriesSlug,
  prev,
  next,
}: ChapterNavProps) {
  return (
    <nav className="mx-auto mt-16 flex max-w-reader items-center justify-between border-t border-amber-900/30 pt-8">
      {prev ? (
        <Link
          href={`/stories/${seriesSlug}/${prev.partNumber}`}
          className="group flex items-center gap-2 text-sm text-warm-300 transition-colors hover:text-amber-400"
        >
          <span className="transition-transform group-hover:-translate-x-0.5">
            &larr;
          </span>
          <span>
            <span className="block text-xs text-warm-500">Previous</span>
            <span>{prev.title}</span>
          </span>
        </Link>
      ) : (
        <div />
      )}
      {next ? (
        <Link
          href={`/stories/${seriesSlug}/${next.partNumber}`}
          className="group flex items-center gap-2 text-right text-sm text-warm-300 transition-colors hover:text-amber-400"
        >
          <span>
            <span className="block text-xs text-warm-500">Next</span>
            <span>{next.title}</span>
          </span>
          <span className="transition-transform group-hover:translate-x-0.5">
            &rarr;
          </span>
        </Link>
      ) : (
        <div />
      )}
    </nav>
  );
}
