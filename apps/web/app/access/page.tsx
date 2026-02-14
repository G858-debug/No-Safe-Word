export default function AccessPortalPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      {/* Ambient background glow */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(180,83,9,0.08)_0%,_transparent_70%)]" />
      </div>

      <div className="relative z-10 w-full max-w-md text-center">
        {/* Brand */}
        <h1
          className="text-4xl font-bold tracking-tight text-amber-50 sm:text-5xl"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          No Safe Word
        </h1>

        {/* Decorative divider */}
        <div className="mx-auto mt-6 flex items-center justify-center gap-3">
          <div className="h-px w-12 bg-gradient-to-r from-transparent to-amber-700/50" />
          <div className="h-1.5 w-1.5 rotate-45 bg-amber-700/60" />
          <div className="h-px w-12 bg-gradient-to-l from-transparent to-amber-700/50" />
        </div>

        {/* Portal title */}
        <h2
          className="mt-6 text-lg font-semibold tracking-wide text-amber-400/90 sm:text-xl"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Access Portal
        </h2>

        {/* Status badge */}
        <div className="mt-8 inline-flex items-center gap-2 rounded-full border border-amber-900/30 bg-amber-950/20 px-4 py-1.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-40" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-600" />
          </span>
          <span className="text-xs font-medium tracking-wider text-amber-300/80">
            COMING SOON
          </span>
        </div>

        {/* Description */}
        <p className="mx-auto mt-6 max-w-sm text-sm leading-relaxed text-warm-200">
          This space is reserved for secure authentication and member access.
        </p>

        {/* Back to main site */}
        <a
          href="https://nosafeword.co.za"
          className="mt-10 inline-flex items-center gap-1.5 text-sm text-warm-300 transition-colors duration-300 hover:text-amber-400"
        >
          <span>&larr;</span>
          <span>Back to No Safe Word</span>
        </a>
      </div>

      {/* Bottom border accent */}
      <div className="fixed bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-800/30 to-transparent" />
    </div>
  );
}
