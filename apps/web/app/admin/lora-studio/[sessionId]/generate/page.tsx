"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Circle,
  RotateCcw,
  ArrowRight,
  Play,
} from "lucide-react";
import { ANIME_PROMPTS } from "./prompts";
import type { AnimePrompt } from "./prompts";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface ImageRecord {
  id: string;
  status: "pending" | "generating" | "ready" | "approved" | "rejected";
  anime_image_url: string | null;
  replicate_prediction_id: string | null;
  anime_prompt: string;
}

interface PromptState {
  prompt: AnimePrompt;
  record: ImageRecord | null;
  signedUrl: string | null;
}

interface StatusCounts {
  total: number;
  generating: number;
  ready: number;
  failed: number;
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 1500;
const POLL_INTERVAL_MS = 3000;

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────────
// Status indicator
// ─────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string | null }) {
  if (!status || status === "pending") {
    return <Circle className="h-3 w-3 text-zinc-600" />;
  }
  if (status === "generating") {
    return <Loader2 className="h-3 w-3 animate-spin text-amber-400" />;
  }
  if (status === "ready" || status === "approved") {
    return <CheckCircle2 className="h-3 w-3 text-emerald-400" />;
  }
  return <XCircle className="h-3 w-3 text-red-400" />;
}

// ─────────────────────────────────────────────────────────────────
// Prompt card
// ─────────────────────────────────────────────────────────────────

function PromptCard({
  state,
  onRetry,
}: {
  state: PromptState;
  onRetry: (prompt: AnimePrompt) => void;
}) {
  const { prompt, record, signedUrl } = state;
  const status = record?.status ?? "pending";

  const bgClass =
    status === "ready" || status === "approved"
      ? "border-emerald-900/40 bg-emerald-950/20"
      : status === "generating"
      ? "border-amber-900/40 bg-amber-950/10"
      : status === "rejected"
      ? "border-red-900/40 bg-red-950/10"
      : "border-zinc-800 bg-zinc-900/40";

  return (
    <div className={`flex flex-col rounded-lg border p-1.5 transition-colors ${bgClass}`}>
      {/* Thumbnail */}
      <div className="relative mb-1.5 aspect-[2/3] w-full overflow-hidden rounded bg-zinc-800">
        {signedUrl ? (
          <img
            src={signedUrl}
            alt={`Prompt ${prompt.id}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <StatusDot status={status} />
          </div>
        )}
        <span className="absolute left-1 top-1 rounded bg-black/70 px-1 py-0.5 font-mono text-[9px] text-zinc-300">
          #{prompt.id}
        </span>
        {signedUrl && (
          <span className="absolute right-1 top-1">
            <StatusDot status={status} />
          </span>
        )}
      </div>

      {/* Metadata tags */}
      <div className="flex flex-wrap gap-0.5">
        {[
          prompt.shotType.replace("_", " "),
          prompt.poseCategory.replace(/_/g, " "),
          prompt.clothingState.replace(/_/g, " "),
          prompt.lightingCategory.replace(/_/g, " "),
          prompt.angleCategory.replace(/_/g, " "),
        ].map((tag) => (
          <span
            key={tag}
            className="rounded bg-zinc-800/80 px-1 py-0.5 text-[8px] leading-tight text-zinc-500"
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Retry */}
      {status === "rejected" && (
        <button
          onClick={() => onRetry(prompt)}
          className="mt-1.5 flex items-center justify-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-[9px] text-zinc-300 transition-colors hover:bg-zinc-700"
        >
          <RotateCcw className="h-2.5 w-2.5" />
          Retry
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Distribution summary
// ─────────────────────────────────────────────────────────────────

function DistGroup({
  label,
  items,
}: {
  label: string;
  items: { label: string; count: number }[];
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold text-zinc-400">{label}</p>
      <ul className="space-y-0.5 text-[11px] text-zinc-500">
        {items.map((item) => (
          <li key={item.label} className="flex justify-between gap-2">
            <span>{item.label}</span>
            <span className="text-zinc-400">{item.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────

export default function GeneratePage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;

  const [states, setStates] = useState<PromptState[]>(() =>
    ANIME_PROMPTS.map((p) => ({ prompt: p, record: null, signedUrl: null })),
  );

  const [counts, setCounts] = useState<StatusCounts>({
    total: 0,
    generating: 0,
    ready: 0,
    failed: 0,
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [dispatchProgress, setDispatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPolling = useRef(false);

  // ── Merge server response into local state ────────────────────

  const applyResponse = useCallback(
    (images: ImageRecord[], signedUrls: Record<string, string>, serverCounts: StatusCounts) => {
      const byPrompt = new Map<string, ImageRecord>();
      for (const img of images) byPrompt.set(img.anime_prompt, img);

      setStates((prev) =>
        prev.map((s) => {
          const rec = byPrompt.get(s.prompt.prompt) ?? null;
          const freshUrl = rec ? (signedUrls[rec.id] ?? null) : null;
          return {
            ...s,
            record: rec,
            // Preserve cached signed URL when the new poll didn't return one
            signedUrl: freshUrl ?? s.signedUrl,
          };
        }),
      );

      setCounts(serverCounts);
    },
    [],
  );

  // ── Fetch status ──────────────────────────────────────────────

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/lora-studio/${sessionId}/anime-status`);
      if (!res.ok) return;
      const data = await res.json();
      applyResponse(data.images ?? [], data.signedUrls ?? {}, data.counts ?? counts);
    } catch (err) {
      console.error("[generate] fetchStatus error:", err);
    }
  }, [sessionId, applyResponse]);

  // ── Polling lifecycle ─────────────────────────────────────────

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      if (isPolling.current) return;
      isPolling.current = true;
      await fetchStatus();
      isPolling.current = false;
    }, POLL_INTERVAL_MS);
  }, [fetchStatus]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // ── Initial load ──────────────────────────────────────────────

  useEffect(() => {
    fetchStatus();
    return () => stopPolling();
  }, []);

  useEffect(() => {
    if (counts.generating > 0 || isGenerating) {
      startPolling();
    } else if (!isGenerating) {
      stopPolling();
    }
  }, [counts.generating, isGenerating]);

  // ── Dispatch single prompt ────────────────────────────────────

  const dispatchPrompt = useCallback(
    async (prompt: AnimePrompt) => {
      await fetch(`/api/lora-studio/${sessionId}/generate-anime`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.prompt,
          negativePrompt: prompt.negativePrompt,
          poseCategory: prompt.poseCategory,
          lightingCategory: prompt.lightingCategory,
          clothingState: prompt.clothingState,
          angleCategory: prompt.angleCategory,
        }),
      });
    },
    [sessionId],
  );

  // ── Generate All ──────────────────────────────────────────────

  const handleGenerateAll = useCallback(async () => {
    setIsGenerating(true);
    setError(null);

    const pending = ANIME_PROMPTS.filter((p) => {
      const s = states[p.id - 1];
      return !s.record || s.record.status === "rejected";
    });

    if (pending.length === 0) {
      setIsGenerating(false);
      return;
    }

    setDispatchProgress({ done: 0, total: pending.length });
    startPolling();

    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(batch.map((p) => dispatchPrompt(p)));
      setDispatchProgress({ done: Math.min(i + BATCH_SIZE, pending.length), total: pending.length });
      if (i + BATCH_SIZE < pending.length) await sleep(BATCH_DELAY_MS);
    }

    setIsGenerating(false);
    setDispatchProgress(null);
    await fetchStatus();
  }, [states, dispatchPrompt, startPolling, fetchStatus]);

  // ── Retry single failed card ──────────────────────────────────

  const handleRetry = useCallback(
    async (prompt: AnimePrompt) => {
      await dispatchPrompt(prompt);
      startPolling();
      await fetchStatus();
    },
    [dispatchPrompt, startPolling, fetchStatus],
  );

  // ── Derived values ────────────────────────────────────────────

  const progressPct = Math.round((counts.ready / 200) * 100);
  const allSettled = counts.total === 200 && counts.generating === 0 && !isGenerating;
  const pendingCount = 200 - counts.total;
  const canGenerate = pendingCount > 0 || counts.failed > 0;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Anime Generation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            200 images · SDXL + Venus Body LoRA · 768 × 1152
          </p>
        </div>

        <div className="flex items-center gap-3">
          {allSettled && counts.ready > 0 && (
            <Link
              href={`/admin/lora-studio/${sessionId}/approve-anime`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-900/40 px-4 py-2 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-900/60"
            >
              Proceed to Approval
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}

          <button
            onClick={handleGenerateAll}
            disabled={isGenerating || !canGenerate}
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700 disabled:opacity-40"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {dispatchProgress
                  ? `Dispatching ${dispatchProgress.done} / ${dispatchProgress.total}`
                  : "Dispatching…"}
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                {counts.failed > 0
                  ? `Retry ${counts.failed} Failed`
                  : counts.total === 0
                  ? "Generate All 200"
                  : `Generate ${pendingCount} Remaining`}
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-900/30 bg-red-950/20 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Progress bar */}
      <div className="mb-6">
        <div className="mb-1.5 flex items-center justify-between text-xs text-zinc-400">
          <span>
            {counts.ready} / 200 complete
            {counts.generating > 0 && (
              <span className="ml-2 text-amber-400">· {counts.generating} generating</span>
            )}
            {counts.failed > 0 && (
              <span className="ml-2 text-red-400">· {counts.failed} failed</span>
            )}
          </span>
          <span>{progressPct}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-amber-600 transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Legend */}
      <div className="mb-4 flex items-center gap-4 text-[11px] text-zinc-500">
        {[
          { icon: <Circle className="h-3 w-3 text-zinc-600" />, label: "pending" },
          { icon: <Loader2 className="h-3 w-3 text-amber-400" />, label: "generating" },
          { icon: <CheckCircle2 className="h-3 w-3 text-emerald-400" />, label: "ready" },
          { icon: <XCircle className="h-3 w-3 text-red-400" />, label: "failed" },
        ].map(({ icon, label }) => (
          <span key={label} className="flex items-center gap-1">
            {icon} {label}
          </span>
        ))}
      </div>

      {/* 200-card grid */}
      <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-8 lg:grid-cols-10">
        {states.map((s) => (
          <PromptCard key={s.prompt.id} state={s} onRetry={handleRetry} />
        ))}
      </div>

      {/* Distribution stats */}
      <div className="mt-8 rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-zinc-500">
          Prompt Distribution
        </h2>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <DistGroup
            label="Shot type"
            items={[
              { label: "Full body", count: 100 },
              { label: "3/4 body", count: 70 },
              { label: "Half body", count: 30 },
            ]}
          />
          <DistGroup
            label="Pose"
            items={[
              { label: "Standing neutral", count: 30 },
              { label: "Standing attitude", count: 30 },
              { label: "Walking", count: 20 },
              { label: "Seated", count: 30 },
              { label: "Lying down", count: 30 },
              { label: "Bent / arched", count: 25 },
              { label: "Over shoulder", count: 20 },
              { label: "Crouching", count: 15 },
            ]}
          />
          <DistGroup
            label="Clothing"
            items={[
              { label: "Fully clothed", count: 50 },
              { label: "Partially clothed", count: 50 },
              { label: "Lingerie", count: 50 },
              { label: "Minimal / nude", count: 50 },
            ]}
          />
          <DistGroup
            label="Angle"
            items={[
              { label: "Front", count: 70 },
              { label: "3/4 angle", count: 80 },
              { label: "Side profile", count: 30 },
              { label: "Low angle", count: 20 },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
