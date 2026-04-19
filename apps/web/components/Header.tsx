"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";

const navLinks = [
  { href: "/stories", label: "Stories" },
  { href: "/about", label: "About" },
];

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const { user, nswUser, loading, signOut } = useAuth();
  const router = useRouter();
  const dropdownRef = useRef<HTMLDivElement>(null);

  const displayName =
    nswUser?.display_name || user?.email?.split("@")[0] || "there";
  const avatarLetter = displayName[0].toUpperCase();

  // Close dropdown on click outside
  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  async function handleSignOut() {
    setDropdownOpen(false);
    setMenuOpen(false);
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } catch {
      // Server-side clear failed — still clear client state
    }
    await signOut();
    router.push("/");
  }

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

          {/* Auth slot */}
          {loading ? (
            <div className="h-8 w-8 animate-pulse rounded-full bg-amber-900/20" />
          ) : user ? (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-2"
              >
                <span className="text-sm text-warm-300 hidden lg:inline">
                  Hi, {displayName}
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-900/40 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-900/60">
                  {avatarLetter}
                </span>
              </button>

              {dropdownOpen && (
                <div className="absolute right-0 mt-2 w-48 rounded-lg border border-amber-900/30 bg-[#141414] py-1 shadow-xl">
                  <div className="border-b border-amber-900/20 px-4 py-2 lg:hidden">
                    <p className="text-sm text-warm-300">Hi, {displayName}</p>
                  </div>
                  <Link
                    href="/account"
                    onClick={() => setDropdownOpen(false)}
                    className="block px-4 py-2 text-sm text-warm-300 transition-colors hover:bg-amber-900/20 hover:text-amber-400"
                  >
                    My Account
                  </Link>
                  <button
                    onClick={handleSignOut}
                    className="block w-full px-4 py-2 text-left text-sm text-warm-300 transition-colors hover:bg-amber-900/20 hover:text-amber-400"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-amber-700 px-4 py-1.5 text-sm font-semibold text-amber-50 transition-colors hover:bg-amber-600"
            >
              Log in
            </Link>
          )}
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
          {!loading &&
            (user ? (
              <>
                <div className="border-t border-amber-900/20 mt-1 pt-1">
                  <p className="px-0 py-2 text-xs text-warm-400">
                    Hi, {displayName}
                  </p>
                  <Link
                    href="/account"
                    onClick={() => setMenuOpen(false)}
                    className="block py-3 text-amber-400 transition-colors hover:text-amber-300"
                  >
                    My Account
                  </Link>
                  <button
                    onClick={handleSignOut}
                    className="block w-full py-3 text-left text-warm-300 transition-colors hover:text-amber-400"
                  >
                    Sign out
                  </button>
                </div>
              </>
            ) : (
              <Link
                href="/login"
                onClick={() => setMenuOpen(false)}
                className="block py-3 font-semibold text-amber-400 transition-colors hover:text-amber-300"
              >
                Log in
              </Link>
            ))}
        </nav>
      )}
    </header>
  );
}
