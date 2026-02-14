import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: {
    default: "No Safe Word — Contemporary Romance Fiction",
    template: "%s | No Safe Word",
  },
  description:
    "No Safe Word is a contemporary romance fiction platform by South African author Nontsikelelo Mabaso.",
  robots: {
    index: true,
    follow: true,
  },
};

function AccessHeader() {
  const links = [
    { href: "/about", label: "About" },
    { href: "/stories", label: "Stories" },
    { href: "/contact", label: "Contact" },
    { href: "/privacy", label: "Privacy" },
    { href: "/terms", label: "Terms" },
  ];

  return (
    <header className="border-b border-amber-900/20">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-4 py-6 sm:flex-row sm:justify-between sm:px-6">
        <Link
          href="/"
          className="text-xl font-bold tracking-tight text-amber-50 transition-colors hover:text-amber-200"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          No Safe Word
        </Link>
        <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-warm-300 transition-colors hover:text-amber-400"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

function AccessFooter() {
  return (
    <footer className="border-t border-amber-900/20">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <p
            className="text-lg font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            No Safe Word
          </p>
          <p className="max-w-md text-sm text-warm-400">
            Contemporary romance fiction by Nontsikelelo Mabaso.
          </p>
          <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
            <Link
              href="/privacy"
              className="text-warm-300 transition-colors hover:text-amber-400"
            >
              Privacy Policy
            </Link>
            <Link
              href="/terms"
              className="text-warm-300 transition-colors hover:text-amber-400"
            >
              Terms of Service
            </Link>
            <Link
              href="/contact"
              className="text-warm-300 transition-colors hover:text-amber-400"
            >
              Contact
            </Link>
          </nav>
          <p className="text-xs text-warm-500">
            &copy; {new Date().getFullYear()} No Safe Word. All rights
            reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

export default function AccessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <AccessHeader />
      <main className="flex-1">{children}</main>
      <AccessFooter />
    </div>
  );
}
