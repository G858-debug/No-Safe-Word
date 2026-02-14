"use client";

import { useState } from "react";
import Link from "next/link";

interface PaywallGateProps {
  seriesId: string;
  seriesSlug: string;
  seriesTitle: string;
  partNumber: number;
  isAuthenticated: boolean;
}

export default function PaywallGate({
  seriesId,
  seriesSlug,
  seriesTitle,
  partNumber,
  isAuthenticated,
}: PaywallGateProps) {
  const [loading, setLoading] = useState<"buy" | "subscribe" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentPath = `/stories/${seriesSlug}/${partNumber}`;

  async function handlePayfast(type: "buy" | "subscribe") {
    setLoading(type);
    setError(null);

    try {
      const endpoint =
        type === "buy" ? "/api/payfast/purchase" : "/api/payfast/subscribe";
      const body =
        type === "buy" ? JSON.stringify({ seriesId, seriesTitle }) : undefined;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || "Payment failed");
      }

      // Create hidden form and submit to Payfast
      const form = document.createElement("form");
      form.method = "POST";
      form.action = json.actionUrl;

      for (const [key, value] of Object.entries(json.data)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = key;
        input.value = value as string;
        form.appendChild(input);
      }

      document.body.appendChild(form);
      form.submit();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(null);
    }
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
                onClick={() => handlePayfast("buy")}
                disabled={loading !== null}
                className="flex items-center justify-center gap-2 rounded-lg bg-amber-700 px-6 py-3 text-sm font-semibold text-amber-50 transition-colors hover:bg-amber-600 disabled:opacity-60"
              >
                {loading === "buy" && <Spinner />}
                Buy this story — R29
              </button>
              <button
                onClick={() => handlePayfast("subscribe")}
                disabled={loading !== null}
                className="flex items-center justify-center gap-2 rounded-lg border border-amber-900/40 bg-transparent px-6 py-3 text-sm font-semibold text-amber-300 transition-colors hover:border-amber-700 hover:bg-amber-950/30 disabled:opacity-60"
              >
                {loading === "subscribe" && <Spinner />}
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

        {/* Error message */}
        {error && (
          <p className="mt-4 text-sm text-red-400">{error}</p>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
