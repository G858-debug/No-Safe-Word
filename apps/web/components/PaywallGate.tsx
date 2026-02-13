"use client";

import { useState } from "react";
import Link from "next/link";

interface PaywallGateProps {
  seriesSlug: string;
  seriesTitle: string;
  partNumber: number;
  isAuthenticated: boolean;
}

export default function PaywallGate({
  seriesSlug,
  seriesTitle,
  partNumber,
  isAuthenticated,
}: PaywallGateProps) {
  const [toast, setToast] = useState<string | null>(null);

  const currentPath = `/stories/${seriesSlug}/${partNumber}`;

  function showComingSoon() {
    setToast("Coming soon — payments launching soon!");
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <div className="relative mt-0">
      {/* Gradient fade over truncated content */}
      <div className="pointer-events-none absolute -top-32 left-0 right-0 h-32 bg-gradient-to-t from-[#0a0a0a] to-transparent" />

      {/* CTA card */}
      <div className="relative rounded-xl border border-amber-900/30 bg-[#111111] px-6 py-10 text-center">
        <h3
          className="text-xl font-bold text-amber-50 sm:text-2xl"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Keep reading {seriesTitle}
        </h3>
        <p className="mx-auto mt-3 max-w-sm text-sm text-warm-300">
          Part 1 is free. Unlock the full story to continue reading.
        </p>

        <div className="mx-auto mt-8 flex max-w-xs flex-col gap-3">
          {isAuthenticated ? (
            <>
              <button
                onClick={showComingSoon}
                className="rounded-lg bg-amber-700 px-6 py-3 text-sm font-semibold text-amber-50 transition-colors hover:bg-amber-600"
              >
                Buy this story — R29
              </button>
              <button
                onClick={showComingSoon}
                className="rounded-lg border border-amber-900/40 bg-transparent px-6 py-3 text-sm font-semibold text-amber-300 transition-colors hover:border-amber-700 hover:bg-amber-950/30"
              >
                Subscribe — R55/month
              </button>
            </>
          ) : (
            <>
              <Link
                href={`/login?next=${encodeURIComponent(currentPath)}`}
                className="rounded-lg bg-amber-700 px-6 py-3 text-sm font-semibold text-amber-50 transition-colors hover:bg-amber-600"
              >
                Buy this story — R29
              </Link>
              <Link
                href={`/login?next=${encodeURIComponent(currentPath)}`}
                className="rounded-lg border border-amber-900/40 bg-transparent px-6 py-3 text-sm font-semibold text-amber-300 transition-colors hover:border-amber-700 hover:bg-amber-950/30"
              >
                Subscribe — R55/month
              </Link>
              <p className="mt-1 text-xs text-warm-400">
                Sign in or create a free account to purchase
              </p>
            </>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-amber-900 px-5 py-3 text-sm font-medium text-amber-50 shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
