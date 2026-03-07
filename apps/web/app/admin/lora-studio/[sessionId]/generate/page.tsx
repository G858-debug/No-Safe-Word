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
  Trash2,
  ThumbsUp,
  ThumbsDown,
  X,
  ChevronLeft,
  ChevronRight,
  Pencil,
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
  prompt_index: number | null;
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
  onClick,
  editedPrompt,
  onEditPrompt,
  onResetPrompt,
}: {
  state: PromptState;
  onRetry: (prompt: AnimePrompt) => void;
  onClick: () => void;
  editedPrompt: string | undefined;
  onEditPrompt: (promptId: number, text: string) => void;
  onResetPrompt: (promptId: number) => void;
}) {
  const { prompt, record, signedUrl } = state;
  const status = record?.status ?? "pending";
  const [expanded, setExpanded] = useState(false);
  const isEdited = editedPrompt !== undefined;

  const bgClass =
    status === "ready" || status === "approved"
      ? "border-emerald-900/40 bg-emerald-950/20"
      : status === "generating"
      ? "border-amber-900/40 bg-amber-950/10"
      : status === "rejected"
      ? "border-red-900/40 bg-red-950/10"
      : "border-zinc-800 bg-zinc-900/40";

  return (
    <div
      className={`flex flex-col rounded-lg border p-1.5 transition-colors ${bgClass} ${signedUrl ? "cursor-pointer hover:ring-1 hover:ring-zinc-600" : ""}`}
      onClick={signedUrl && !expanded ? onClick : undefined}
    >
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
        <span className="absolute left-1 top-1 flex items-center gap-0.5 rounded bg-black/70 px-1 py-0.5 font-mono text-[9px] text-zinc-300">
          #{prompt.id}
          {isEdited && <span className="text-amber-400">*</span>}
        </span>
        {signedUrl && (
          <span className="absolute right-1 top-1">
            <StatusDot status={status} />
          </span>
        )}
      </div>

      {/* Metadata tags + edit toggle */}
      <div className="flex flex-wrap items-center gap-0.5">
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
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className={`ml-auto rounded p-0.5 transition-colors hover:bg-zinc-700 ${isEdited ? "text-amber-400" : "text-zinc-600"}`}
          title="Edit prompt"
        >
          <Pencil className="h-2.5 w-2.5" />
        </button>
      </div>

      {/* Expandable prompt editor */}
      {expanded && (
        <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
          <textarea
            value={editedPrompt ?? prompt.prompt}
            onChange={(e) => onEditPrompt(prompt.id, e.target.value)}
            rows={4}
            className="w-full rounded bg-zinc-800 px-1.5 py-1 text-[10px] leading-tight text-zinc-300 focus:outline-none focus:ring-1 focus:ring-amber-600"
          />
          {isEdited && (
            <button
              onClick={() => onResetPrompt(prompt.id)}
              className="mt-0.5 text-[9px] text-zinc-500 hover:text-zinc-300"
            >
              Reset to default
            </button>
          )}
        </div>
      )}

      {/* Retry */}
      {status === "rejected" && (
        <button
          onClick={(e) => { e.stopPropagation(); onRetry(prompt); }}
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
// Lightbox
// ─────────────────────────────────────────────────────────────────

function Lightbox({
  states,
  index,
  onClose,
  onNavigate,
  onApprove,
  onReject,
  getEffectivePrompt,
}: {
  states: PromptState[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onApprove: (imageId: string) => void;
  onReject: (imageId: string) => void;
  getEffectivePrompt: (id: number) => string;
}) {
  const state = states[index];
  const { prompt, record, signedUrl } = state;
  const status = record?.status ?? "pending";
  const [showPrompt, setShowPrompt] = useState(false);

  // Find prev/next indices that have images
  const findAdjacentWithImage = (dir: -1 | 1) => {
    for (let i = index + dir; i >= 0 && i < states.length; i += dir) {
      if (states[i].signedUrl) return i;
    }
    return -1;
  };
  const prevIdx = findAdjacentWithImage(-1);
  const nextIdx = findAdjacentWithImage(1);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && prevIdx >= 0) onNavigate(prevIdx);
      else if (e.key === "ArrowRight" && nextIdx >= 0) onNavigate(nextIdx);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, onNavigate, prevIdx, nextIdx]);

  const canApprove = record && (status === "ready" || status === "rejected");
  const canReject = record && (status === "ready" || status === "approved");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[95vh] max-w-[95vw] flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute -right-2 -top-2 z-10 rounded-full bg-zinc-800 p-1.5 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Navigation arrows */}
        {prevIdx >= 0 && (
          <button
            onClick={() => onNavigate(prevIdx)}
            className="absolute left-[-60px] top-1/2 -translate-y-1/2 rounded-full bg-zinc-800/80 p-3 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        {nextIdx >= 0 && (
          <button
            onClick={() => onNavigate(nextIdx)}
            className="absolute right-[-60px] top-1/2 -translate-y-1/2 rounded-full bg-zinc-800/80 p-3 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}

        {/* Image */}
        {signedUrl ? (
          <img
            src={signedUrl}
            alt={`Prompt ${prompt.id}`}
            className="max-h-[75vh] rounded-lg object-contain"
          />
        ) : (
          <div className="flex h-64 w-48 items-center justify-center rounded-lg bg-zinc-800">
            <StatusDot status={status} />
          </div>
        )}

        {/* Info bar */}
        <div className="mt-3 flex w-full items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-300">
              #{prompt.id}
            </span>
            <StatusDot status={status} />
            <span className="text-xs capitalize text-zinc-500">{status}</span>
            {[
              prompt.shotType.replace("_", " "),
              prompt.poseCategory.replace(/_/g, " "),
              prompt.clothingState.replace(/_/g, " "),
              prompt.angleCategory.replace(/_/g, " "),
            ].map((tag) => (
              <span
                key={tag}
                className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-500"
              >
                {tag}
              </span>
            ))}
          </div>

          {/* Approve / Reject buttons */}
          <div className="flex items-center gap-2">
            {canApprove && (
              <button
                onClick={() => record && onApprove(record.id)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-900/40 px-4 py-2 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-900/60"
              >
                <ThumbsUp className="h-4 w-4" />
                Approve
              </button>
            )}
            {canReject && (
              <button
                onClick={() => record && onReject(record.id)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-900/40 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-900/60"
              >
                <ThumbsDown className="h-4 w-4" />
                Reject
              </button>
            )}
            {status === "approved" && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-950/40 px-4 py-2 text-sm font-medium text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                Approved
              </span>
            )}
          </div>
        </div>

        {/* Prompt text (collapsible) */}
        <div className="mt-2 w-full">
          <button
            onClick={() => setShowPrompt(!showPrompt)}
            className="text-[10px] text-zinc-500 hover:text-zinc-300"
          >
            {showPrompt ? "Hide prompt" : "Show prompt"}
          </button>
          {showPrompt && (
            <p className="mt-1 max-h-24 overflow-y-auto rounded bg-zinc-900 px-3 py-2 text-[11px] leading-relaxed text-zinc-400">
              {getEffectivePrompt(prompt.id)}
            </p>
          )}
        </div>

        {/* Keyboard hint */}
        <p className="mt-2 text-[10px] text-zinc-600">
          ← → navigate · Esc close
        </p>
      </div>
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
  const [testCount, setTestCount] = useState(10);
  const [debugLog, setDebugLog] = useState<string[]>([]);

  // Per-prompt text overrides (ephemeral — lost on page refresh)
  const [promptOverrides, setPromptOverrides] = useState<Record<number, string>>({});
  const getEffectivePrompt = useCallback(
    (id: number) => promptOverrides[id] ?? ANIME_PROMPTS[id - 1].prompt,
    [promptOverrides],
  );

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPolling = useRef(false);

  // ── Merge server response into local state ────────────────────

  const applyResponse = useCallback(
    (images: ImageRecord[], signedUrls: Record<string, string>, serverCounts: StatusCounts) => {
      // Index-based matching (preferred) with prompt-text fallback for old records
      const byIndex = new Map<number, ImageRecord>();
      const byPrompt = new Map<string, ImageRecord>();
      for (const img of images) {
        if (img.prompt_index != null) {
          byIndex.set(img.prompt_index, img);
        } else {
          byPrompt.set(img.anime_prompt, img);
        }
      }

      setStates((prev) =>
        prev.map((s) => {
          const rec = byIndex.get(s.prompt.id) ?? byPrompt.get(s.prompt.prompt) ?? null;
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
      if (!res.ok) {
        console.warn(`[fetchStatus] ${res.status} ${res.statusText}`);
        return;
      }
      const data = await res.json();
      console.log(`[fetchStatus] total=${data.counts?.total} generating=${data.counts?.generating} ready=${data.counts?.ready} failed=${data.counts?.failed}`);
      applyResponse(data.images ?? [], data.signedUrls ?? {}, data.counts ?? counts);
    } catch (err) {
      console.error("[fetchStatus] error:", err);
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
      const effectivePrompt = getEffectivePrompt(prompt.id);
      console.log(`[dispatch] POST prompt #${prompt.id} to /api/lora-studio/${sessionId}/generate-anime`);
      const res = await fetch(`/api/lora-studio/${sessionId}/generate-anime`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: effectivePrompt,
          negativePrompt: prompt.negativePrompt,
          poseCategory: prompt.poseCategory,
          lightingCategory: prompt.lightingCategory,
          clothingState: prompt.clothingState,
          angleCategory: prompt.angleCategory,
          promptIndex: prompt.id,
        }),
      });
      console.log(`[dispatch] prompt #${prompt.id} response: ${res.status}`);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`generate-anime ${res.status}: ${body.slice(0, 200)}`);
      }
    },
    [sessionId, getEffectivePrompt],
  );

  // ── Dispatch a slice of pending prompts ───────────────────────

  const addDebug = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setDebugLog((prev) => [...prev.slice(-19), `${ts} ${msg}`]);
  }, []);

  const dispatchBatch = useCallback(
    async (limit?: number) => {
      try {
        addDebug(`dispatchBatch(${limit ?? 'all'}) called`);
        console.log(`[dispatchBatch] called with limit=${limit}`);
        setIsGenerating(true);
        setError(null);

        const pending = ANIME_PROMPTS.filter((p) => {
          const s = states[p.id - 1];
          return !s.record || s.record.status === "rejected";
        }).slice(0, limit);

        addDebug(`${pending.length} pending prompts to dispatch`);
        console.log(`[dispatchBatch] ${pending.length} pending prompts (ids: ${pending.slice(0, 5).map(p => p.id).join(',')}${pending.length > 5 ? '...' : ''})`);

        if (pending.length === 0) {
          addDebug('nothing to do');
          setIsGenerating(false);
          return;
        }

        setDispatchProgress({ done: 0, total: pending.length });
        startPolling();

        for (let i = 0; i < pending.length; i += BATCH_SIZE) {
          const batch = pending.slice(i, i + BATCH_SIZE);
          addDebug(`dispatching batch ${i / BATCH_SIZE + 1} (${batch.length} prompts)...`);
          console.log(`[dispatchBatch] dispatching batch ${i / BATCH_SIZE + 1} (${batch.length} prompts)`);
          const results = await Promise.allSettled(batch.map((p) => dispatchPrompt(p)));
          console.log(`[dispatchBatch] batch settled:`, results.map(r => r.status));
          const firstError = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
          if (firstError) {
            const errMsg = String(firstError.reason);
            addDebug(`ERROR: ${errMsg.slice(0, 100)}`);
            console.error('[dispatchBatch] error:', firstError.reason);
            setError(errMsg);
            break;
          }
          addDebug(`batch ${i / BATCH_SIZE + 1} done ✓`);
          setDispatchProgress({ done: Math.min(i + BATCH_SIZE, pending.length), total: pending.length });
          if (i + BATCH_SIZE < pending.length) await sleep(BATCH_DELAY_MS);
        }

        addDebug('all batches done, fetching status...');
        console.log('[dispatchBatch] done, fetching final status');
        setIsGenerating(false);
        setDispatchProgress(null);
        await fetchStatus();
        addDebug('status fetched ✓');
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        addDebug(`UNCAUGHT ERROR: ${errMsg}`);
        console.error('[dispatchBatch] uncaught error:', err);
        setError(errMsg);
        setIsGenerating(false);
        setDispatchProgress(null);
      }
    },
    [states, dispatchPrompt, startPolling, fetchStatus, addDebug],
  );

  const handleGenerateAll = useCallback(() => dispatchBatch(), [dispatchBatch]);

  // ── Retry single failed card ──────────────────────────────────

  const handleDeleteFailed = useCallback(async () => {
    await fetch(`/api/lora-studio/${sessionId}/anime-status`, { method: "DELETE" });
    await fetchStatus();
  }, [sessionId, fetchStatus]);

  const handleRetry = useCallback(
    async (prompt: AnimePrompt) => {
      await dispatchPrompt(prompt);
      startPolling();
      await fetchStatus();
    },
    [dispatchPrompt, startPolling, fetchStatus],
  );

  // ── Lightbox state ──────────────────────────────────────────

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const handleApprove = useCallback(async (imageId: string) => {
    await fetch(`/api/lora-studio/${sessionId}/anime-status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageId, action: "approve" }),
    });
    await fetchStatus();
  }, [sessionId, fetchStatus]);

  const handleReject = useCallback(async (imageId: string) => {
    await fetch(`/api/lora-studio/${sessionId}/anime-status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageId, action: "reject" }),
    });
    await fetchStatus();
  }, [sessionId, fetchStatus]);

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

          {/* Test batch — always visible when fewer than 200 images */}
          {counts.total < 200 && (
            <div className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5">
              <label className="text-xs text-zinc-500">Test</label>
              <input
                type="number"
                min={1}
                max={50}
                value={testCount}
                onChange={(e) => setTestCount(Math.min(50, Math.max(1, Number(e.target.value))))}
                disabled={isGenerating}
                className="w-12 rounded bg-zinc-800 px-1.5 py-0.5 text-center text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-amber-600 disabled:opacity-40"
              />
              <button
                onClick={() => dispatchBatch(testCount)}
                disabled={isGenerating}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-40"
              >
                <Play className="h-3 w-3" />
                Go
              </button>
            </div>
          )}

          {counts.failed > 0 && (
            <button
              onClick={handleDeleteFailed}
              disabled={isGenerating}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-950/40 disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" />
              Delete {counts.failed} Failed
            </button>
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

      {/* Debug: direct API ping — bypasses all React state logic */}
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={async () => {
            addDebug('Ping: sending POST...');
            try {
              const r = await fetch(`/api/lora-studio/${sessionId}/generate-anime`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  prompt: ANIME_PROMPTS[0].prompt,
                  negativePrompt: ANIME_PROMPTS[0].negativePrompt,
                  poseCategory: ANIME_PROMPTS[0].poseCategory,
                  lightingCategory: ANIME_PROMPTS[0].lightingCategory,
                  clothingState: ANIME_PROMPTS[0].clothingState,
                  angleCategory: ANIME_PROMPTS[0].angleCategory,
                }),
              });
              const body = await r.text();
              addDebug(`Ping: ${r.status} — ${body.slice(0, 120)}`);
            } catch (err) {
              addDebug(`Ping ERROR: ${err instanceof Error ? err.message : String(err)}`);
            }
          }}
          className="rounded border border-blue-800 bg-blue-950/30 px-3 py-1.5 text-xs text-blue-400 hover:bg-blue-950/50"
        >
          Ping API (1 image)
        </button>
        <span className="text-[10px] text-zinc-600">Direct fetch — bypasses batch logic</span>
      </div>

      {debugLog.length > 0 && (
        <div className="mb-4 rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3">
          <p className="mb-1 text-[10px] font-semibold text-zinc-500">Debug Log</p>
          <div className="max-h-32 overflow-y-auto font-mono text-[11px] text-zinc-400">
            {debugLog.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
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
        {states.map((s, i) => (
          <PromptCard
            key={s.prompt.id}
            state={s}
            onRetry={handleRetry}
            onClick={() => setLightboxIndex(i)}
            editedPrompt={promptOverrides[s.prompt.id]}
            onEditPrompt={(id, text) =>
              setPromptOverrides((prev) => ({ ...prev, [id]: text }))
            }
            onResetPrompt={(id) =>
              setPromptOverrides((prev) => {
                const next = { ...prev };
                delete next[id];
                return next;
              })
            }
          />
        ))}
      </div>

      {/* Lightbox modal */}
      {lightboxIndex !== null && (
        <Lightbox
          states={states}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
          onApprove={handleApprove}
          onReject={handleReject}
          getEffectivePrompt={getEffectivePrompt}
        />
      )}

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
