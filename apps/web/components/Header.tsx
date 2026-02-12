"use client";

import Link from "next/link";
import { useState } from "react";

const navLinks = [
  { href: "/stories", label: "Stories" },
  { href: "/about", label: "About" },
];

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="border-b border-amber-900/30 bg-[#0a0a0a]/95 backdrop-blur-sm sticky top-0 z-50">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        {/* Logo */}
        <Link href="/" className="group">
          <h1
            className="text-xl font-bold tracking-tight text-amber-50 transition-colors group-hover:text-amber-300 sm:text-2xl"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            No Safe Word
          </h1>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-6 sm:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-warm-300 transition-colors hover:text-amber-400"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex flex-col gap-1.5 p-2 sm:hidden"
          aria-label="Toggle menu"
        >
          <span
            className={`block h-0.5 w-5 bg-amber-50 transition-transform ${menuOpen ? "translate-y-2 rotate-45" : ""}`}
          />
          <span
            className={`block h-0.5 w-5 bg-amber-50 transition-opacity ${menuOpen ? "opacity-0" : ""}`}
          />
          <span
            className={`block h-0.5 w-5 bg-amber-50 transition-transform ${menuOpen ? "-translate-y-2 -rotate-45" : ""}`}
          />
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <nav className="border-t border-amber-900/20 px-4 py-4 sm:hidden">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className="block py-3 text-warm-300 transition-colors hover:text-amber-400"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
