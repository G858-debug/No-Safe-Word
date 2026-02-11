import { Playfair_Display } from "next/font/google";
import Link from "next/link";

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-serif",
});

export default function StoriesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${playfair.variable} flex min-h-screen flex-col bg-[#0a0a0a] text-[#e8e0d4]`}
    >
      {/* Header */}
      <header className="border-b border-amber-900/30">
        <div className="mx-auto flex max-w-4xl items-baseline justify-between px-6 py-6">
          <Link href="/stories" className="group">
            <h1
              className="text-2xl font-bold tracking-tight text-amber-50 transition-colors group-hover:text-amber-300"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              No Safe Word
            </h1>
          </Link>
          <span className="text-sm italic text-[#8a7e6b]">
            By Nontsikelelo
          </span>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-12">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-amber-900/30">
        <div className="mx-auto max-w-4xl px-6 py-8 text-center text-sm text-[#5a5245]">
          <p className="italic">Stories for adults. By Nontsikelelo.</p>
          <p className="mt-2">
            <a
              href="https://www.facebook.com/nosafeword"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-700 transition-colors hover:text-amber-500"
            >
              Follow on Facebook for new stories
            </a>
            <span className="mx-2">&middot;</span>
            <span>&copy; {new Date().getFullYear()} No Safe Word</span>
          </p>
        </div>
      </footer>
    </div>
  );
}
