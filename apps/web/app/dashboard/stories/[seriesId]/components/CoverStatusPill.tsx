"use client";

import { useEffect, useRef, useState } from "react";
import { ImageIcon, CheckCircle2, Clock } from "lucide-react";
import type { CoverStatus } from "@no-safe-word/shared";

interface CoverStatusPillProps {
  coverStatus: CoverStatus | null | undefined;
  onNavigateToCover: () => void;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * Persistent cover state indicator shown above the publisher tabs.
 * Hidden when cover_status is 'pending' (no generation has started).
 * Clicking navigates to the Cover tab from any publisher stage.
 */
export default function CoverStatusPill({
  coverStatus,
  onNavigateToCover,
}: CoverStatusPillProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startRef = useRef<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (coverStatus === "generating") {
      // Record start time on first transition into generating
      if (!startRef.current) {
        startRef.current = new Date();
        setElapsedSeconds(0);
      }
      timerRef.current = setInterval(() => {
        setElapsedSeconds(
          Math.floor((Date.now() - startRef.current!.getTime()) / 1000)
        );
      }, 1000);
    } else {
      // Clear timer and reset when not generating
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      startRef.current = null;
      setElapsedSeconds(0);
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [coverStatus]);

  if (!coverStatus || coverStatus === "pending" || coverStatus === "failed") {
    return null;
  }

  if (coverStatus === "generating") {
    return (
      <button
        onClick={onNavigateToCover}
        className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/40 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-400 transition-colors hover:bg-blue-500/20"
      >
        <Clock className="h-3 w-3 animate-pulse" />
        Cover: Generating ({formatElapsed(elapsedSeconds)})
      </button>
    );
  }

  if (coverStatus === "variants_ready") {
    return (
      <button
        onClick={onNavigateToCover}
        className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/20"
      >
        <ImageIcon className="h-3 w-3" />
        Cover: Ready to approve
      </button>
    );
  }

  if (
    coverStatus === "approved" ||
    coverStatus === "compositing" ||
    coverStatus === "complete"
  ) {
    return (
      <button
        onClick={onNavigateToCover}
        className="inline-flex items-center gap-1.5 rounded-full border border-zinc-600/40 bg-zinc-700/20 px-3 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700/30"
      >
        <CheckCircle2 className="h-3 w-3 text-green-500" />
        Cover: Approved
      </button>
    );
  }

  return null;
}
