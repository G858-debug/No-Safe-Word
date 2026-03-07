"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Loader2,
  Play,
  RotateCcw,
  CheckCircle2,
  XCircle,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface AnimeImage {
  id: string;
  anime_image_url: string | null;
  pose_category: string | null;
  clothing_state: string | null;
  lighting_category: string | null;
  angle_category: string | null;
  human_approved: boolean | null;
  ai_approved: boolean | null;
  animeSignedUrl?: string;
}

interface ConvertedImage {
  id: string;
  sourceAnimeId: string; // stored in anime_prompt
  status: "pending" | "generating" | "ready" | "rejected";
  converted_image_url: string | null;
  replicate_prediction_id: string | null;
  convertedSignedUrl?: string;
}

interface Counts {
  total: number;
  generating: number;
  ready: number;
  failed: number;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function fmtTag(val: string | null) {
  return val ? val.replace(/_/g, " ") : "";
}

function isFinalApproved(img: AnimeImage): boolean {
  if (!img.animeSignedUrl) return false;
  if (img.human_approved !== true) return false;
  // If AI review was run, require ai_approved=true; if not run (null), include it
  if (img.ai_approved === false) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────
// Conversion card
// ─────────────────────────────────────────────────────────────────

function ConversionCard({
  anime,
  converted,
  onRetry,
}: {
  anime: AnimeImage;
  converted: ConvertedImage | undefined;
  onRetry: (animeId: string) => void;
}) {
  const status = converted?.status ?? "pending";
  const isGenerating = status === "generating";
  const isDone = status === "ready";
  const isFailed = status === "rejected";

  const borderClass = isDone
    ? "border-emerald-800/60"
    : isFailed
    ? "border-red-900/50"
    : isGenerating
    ? "border-amber-900/40"
    : "border-zinc-800";

  return (
    <div className={`flex flex-col rounded-lg border bg-zinc-900/60 p-2 transition-colors ${borderClass}`}>
      {/* Before / After images */}
      <div className="flex items-center gap-2">
        {/* Anime (before) */}
        <div className="relative aspect-[2/3] flex-1 overflow-hidden rounded bg-zinc-800">
          {anime.animeSignedUrl ? (
            <img
              src={anime.animeSignedUrl}
              alt="Anime source"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-zinc-700 text-[9px]">
              No image
            </div>
          )}
          <span className="absolute left-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[7px] text-zinc-400">
            Anime
          </span>
        </div>

        {/* Arrow */}
        <div className="flex shrink-0 flex-col items-center gap-1">
          <ArrowRight
            className={`h-4 w-4 ${
              isGenerating
                ? "animate-pulse text-amber-400"
                : isDone
                ? "text-emerald-400"
                : isFailed
                ? "text-red-500"
                : "text-zinc-600"
            }`}
          />
        </div>

        {/* Converted (after) */}
        <div className="relative aspect-[2/3] flex-1 overflow-hidden rounded bg-zinc-800">
          {isDone && converted?.convertedSignedUrl ? (
            <>
              <img
                src={converted.convertedSignedUrl}
                alt="Converted"
                className="h-full w-full object-cover"
              />
              <span className="absolute left-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[7px] text-zinc-400">
                Flux
              </span>
            </>
          ) : isGenerating ? (
            <div className="flex h-full flex-col items-center justify-center gap-1.5">
              <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
              <span className="text-[8px] text-amber-400/70">Converting…</span>
            </div>
          ) : isFailed ? (
            <div className="flex h-full items-center justify-center">
              <XCircle className="h-5 w-5 text-red-500" />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-zinc-700 text-[9px]">
              Pending
            </div>
          )}
        </div>
      </div>

      {/* Tags */}
      <div className="mt-1.5 flex flex-wrap gap-0.5">
        {[anime.pose_category, anime.clothing_state, anime.lighting_category]
          .filter(Boolean)
          .map((tag) => (
            <span
              key={tag}
              className="rounded bg-zinc-800 px-1 py-0.5 text-[8px] leading-tight text-zinc-600"
            >
              {fmtTag(tag)}
            </span>
          ))}
      </div>

      {/* Status / Retry */}
      <div className="mt-1.5 flex items-center justify-between">
        {isDone ? (
          <span className="flex items-center gap-1 text-[9px] text-emerald-400">
            <CheckCircle2 className="h-3 w-3" /> Done
          </span>
        ) : isFailed ? (
          <button
            onClick={() => onRetry(anime.id)}
            className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-[9px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
          >
            <RotateCcw className="h-2.5 w-2.5" />
            Retry
          </button>
        ) : isGenerating ? (
          <span className="text-[9px] text-amber-400/70">Running…</span>
        ) : (
          <span className="text-[9px] text-zinc-600">Queued</span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────

const CONVERT_BATCH_SIZE = 8;
const CONVERT_BATCH_DELAY_MS = 1000;
const POLL_INTERVAL_MS = 4000;

export default function ConvertPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;

  const [animeImages, setAnimeImages] = useState<AnimeImage[]>([]);
  const [convertedImages, setConvertedImages] = useState<ConvertedImage[]>([]);
  const [counts, setCounts] = useState<Counts>({ total: 0, generating: 0, ready: 0, failed: 0 });
  const [loading, setLoading] = useState(true);
  const [isConverting, setIsConverting] = useState(false);
  const [dispatchProgress, setDispatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPolling = useRef(false);

  // ── Data loaders ─────────────────────────────────────────────

  const loadAnimeImages = useCallback(async () => {
    const res = await fetch(`/api/lora-studio/${sessionId}/anime-status`);
    if (!res.ok) return;
    const data = await res.json();
    const imgs: AnimeImage[] = (data.images ?? []).map((img: any) => ({
      ...img,
      animeSignedUrl: data.signedUrls?.[img.id] ?? undefined,
    }));
    setAnimeImages(imgs);
  }, [sessionId]);

  const loadConvertedImages = useCallback(async () => {
    const res = await fetch(`/api/lora-studio/${sessionId}/conversion-status`);
    if (!res.ok) return;
    const data = await res.json();
    const imgs: ConvertedImage[] = (data.images ?? []).map((img: any) => ({
      id: img.id,
      sourceAnimeId: img.anime_prompt, // anime_prompt stores source anime image ID
      status: img.status,
      converted_image_url: img.converted_image_url,
      replicate_prediction_id: img.replicate_prediction_id,
      convertedSignedUrl: data.signedUrls?.[img.id] ?? undefined,
    }));
    setConvertedImages(imgs);
    setCounts(data.counts ?? { total: 0, generating: 0, ready: 0, failed: 0 });
  }, [sessionId]);

  const loadAll = useCallback(async () => {
    await Promise.all([loadAnimeImages(), loadConvertedImages()]);
    setLoading(false);
  }, [loadAnimeImages, loadConvertedImages]);

  // ── Polling ───────────────────────────────────────────────────

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      if (isPolling.current) return;
      isPolling.current = true;
      await loadConvertedImages();
      isPolling.current = false;
    }, POLL_INTERVAL_MS);
  }, [loadConvertedImages]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    loadAll();
    return () => stopPolling();
  }, []);

  useEffect(() => {
    if (counts.generating > 0 || isConverting) {
      startPolling();
    } else {
      stopPolling();
    }
  }, [counts.generating, isConverting]);

  // ── Derived values ────────────────────────────────────────────

  const finalApprovedImages = animeImages.filter(isFinalApproved);
  const convertedMap = new Map<string, ConvertedImage>(
    convertedImages.map((c) => [c.sourceAnimeId, c]),
  );
  const unconverted = finalApprovedImages.filter(
    (img) => {
      const c = convertedMap.get(img.id);
      return !c || c.status === "rejected";
    },
  );

  const allSettled =
    counts.total > 0 &&
    counts.generating === 0 &&
    !isConverting;

  const progressPct =
    counts.total > 0
      ? Math.round((counts.ready / Math.max(counts.total, finalApprovedImages.length)) * 100)
      : 0;

  // ── Convert single image ──────────────────────────────────────

  const convertImage = useCallback(
    async (animeId: string) => {
      const res = await fetch(`/api/lora-studio/${sessionId}/convert-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId: animeId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("[convert] Failed:", data.error);
      }
    },
    [sessionId],
  );

  // ── Convert All ───────────────────────────────────────────────

  const handleConvertAll = useCallback(async () => {
    if (unconverted.length === 0) return;
    setIsConverting(true);
    setError(null);
    setDispatchProgress({ done: 0, total: unconverted.length });
    startPolling();

    for (let i = 0; i < unconverted.length; i += CONVERT_BATCH_SIZE) {
      const batch = unconverted.slice(i, i + CONVERT_BATCH_SIZE);
      await Promise.allSettled(batch.map((img) => convertImage(img.id)));
      setDispatchProgress({
        done: Math.min(i + CONVERT_BATCH_SIZE, unconverted.length),
        total: unconverted.length,
      });
      if (i + CONVERT_BATCH_SIZE < unconverted.length) await sleep(CONVERT_BATCH_DELAY_MS);
    }

    setIsConverting(false);
    setDispatchProgress(null);
    await loadConvertedImages();
  }, [unconverted, convertImage, startPolling, loadConvertedImages]);

  // ── Retry ─────────────────────────────────────────────────────

  const handleRetry = useCallback(
    async (animeId: string) => {
      await convertImage(animeId);
      await loadConvertedImages();
      startPolling();
    },
    [convertImage, loadConvertedImages, startPolling],
  );

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Flux Conversion</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading
              ? "Loading…"
              : `${finalApprovedImages.length} approved anime images → photorealistic via Flux Kontext img2img`}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {allSettled && counts.ready > 0 && (
            <Link
              href={`/admin/lora-studio/${sessionId}/approve-converted`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-900/40 px-4 py-2 text-sm font-medium text-amber-200 hover:bg-amber-900/60"
            >
              Proceed to Approval
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}

          <button
            onClick={handleConvertAll}
            disabled={isConverting || unconverted.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700 disabled:opacity-40"
          >
            {isConverting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {dispatchProgress
                  ? `Dispatching ${dispatchProgress.done} / ${dispatchProgress.total}`
                  : "Dispatching…"}
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                {unconverted.length === 0
                  ? "All Converted"
                  : counts.failed > 0
                  ? `Retry ${counts.failed} Failed`
                  : `Convert All ${unconverted.length}`}
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
      {!loading && counts.total > 0 && (
        <div className="mb-6">
          <div className="mb-1.5 flex items-center justify-between text-xs text-zinc-400">
            <span>
              {counts.ready} / {counts.total} converted
              {counts.generating > 0 && (
                <span className="ml-2 text-amber-400">· {counts.generating} running</span>
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
      )}

      {/* Legend */}
      {!loading && (
        <div className="mb-4 flex items-center gap-4 text-[11px] text-zinc-500">
          {[
            { color: "bg-zinc-600", label: "pending" },
            { color: "bg-amber-500", label: "converting" },
            { color: "bg-emerald-500", label: "done" },
            { color: "bg-red-500", label: "failed" },
          ].map(({ color, label }) => (
            <span key={label} className="flex items-center gap-1">
              <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
              {label}
            </span>
          ))}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-zinc-500">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : finalApprovedImages.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-700 px-6 py-12 text-center text-sm text-zinc-500">
          No final-approved anime images found.{" "}
          <Link
            href={`/admin/lora-studio/${sessionId}/approve-anime`}
            className="text-amber-400 underline hover:text-amber-300"
          >
            Go back and approve images first.
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {finalApprovedImages.map((anime) => (
            <ConversionCard
              key={anime.id}
              anime={anime}
              converted={convertedMap.get(anime.id)}
              onRetry={handleRetry}
            />
          ))}
        </div>
      )}

      {/* Proceed footer */}
      {allSettled && counts.ready > 0 && (
        <div className="mt-8 flex justify-end">
          <Link
            href={`/admin/lora-studio/${sessionId}/approve-converted`}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-5 py-2.5 text-sm font-medium text-amber-100 hover:bg-amber-600"
          >
            Proceed to Approval
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}
    </div>
  );
}
