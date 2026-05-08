"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  text: string;
  url: string;
  title?: string;
}

// Web Share API on supported clients (mobile primarily) with a
// copy-to-clipboard fallback for desktop. Inline "Copied!" confirmation
// fades after 2s. Errors during share (e.g. user cancelled) silently
// swallow — there's nothing useful to surface for a cancel.
export function ShareButton({ text, url, title }: Props) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleClick = useCallback(async () => {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (err) {
        // AbortError = user cancelled the share sheet — silent.
        // Anything else (NotAllowedError on insecure origins, etc.) →
        // fall through to clipboard fallback so the user still gets
        // *something* useful.
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function"
    ) {
      try {
        await navigator.clipboard.writeText(`${text}\n\n${url}`);
        setCopied(true);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => setCopied(false), 2000);
      } catch {
        // Clipboard API can fail on insecure origins or revoked
        // permissions. Surface as a passive no-op rather than a
        // disruptive alert; the share text is in the page already.
      }
    }
  }, [text, url, title]);

  return (
    <span className="inline-flex items-center gap-3">
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-2 rounded-lg border border-amber-700/40 bg-amber-900/20 px-4 py-2 text-sm font-medium text-amber-200 transition-colors hover:border-amber-600/60 hover:bg-amber-800/30"
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
        Share
      </button>
      {copied && (
        <span
          className="text-xs text-amber-400 opacity-0"
          style={{ animation: "fadeIn 200ms ease-out forwards" }}
        >
          Copied!
        </span>
      )}
    </span>
  );
}
