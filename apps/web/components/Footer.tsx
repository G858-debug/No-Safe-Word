import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-amber-900/30 bg-[#0a0a0a]">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="flex flex-col items-center gap-6 text-center">
          {/* Brand */}
          <p
            className="text-lg font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            No Safe Word
          </p>
          <p className="max-w-md text-sm italic text-warm-400">
            Stories for adults. By Nontsikelelo.
          </p>

          {/* Links */}
          <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
            <Link
              href="/stories"
              className="text-warm-300 transition-colors hover:text-amber-400"
            >
              Stories
            </Link>
            <Link
              href="/about"
              className="text-warm-300 transition-colors hover:text-amber-400"
            >
              About
            </Link>
            <a
              href="https://www.facebook.com/nosafeword"
              target="_blank"
              rel="noopener noreferrer"
              className="text-warm-300 transition-colors hover:text-amber-400"
            >
              Facebook
            </a>
          </nav>

          {/* Legal */}
          <div className="text-xs text-warm-500">
            <p>This site contains explicit adult content. You must be 18+ to access.</p>
            <p className="mt-1">
              &copy; {new Date().getFullYear()} No Safe Word. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
