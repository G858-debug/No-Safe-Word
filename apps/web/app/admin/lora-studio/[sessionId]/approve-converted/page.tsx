"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowRight,
  Bot,
  ZoomIn,
  X,
  Plus,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface AnimeImage {
  id: string;
  anime_image_url: string | null;
  animeSignedUrl?: string;
}

interface ConvertedImage {
  id: string;
  sourceAnimeId: string; // stored in anime_prompt field
  status: string;
  converted_image_url: string | null;
  pose_category: string | null;
  clothing_state: string | null;
  angle_category: string | null;
  human_approved: boolean | null;
  ai_approved: boolean | null;
  ai_rejection_reason: string | null;
  convertedSignedUrl?: string;
}

type FilterTab = "all" | "pending" | "approved" | "rejected";

type TopupPhase = "idle" | "generating" | "converting" | "done";

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function fmtTag(val: string | null) {
  return val ? val.replace(/_/g, " ") : "";
}

function humanStatus(img: ConvertedImage): "approved" | "rejected" | "pending" {
  if (img.human_approved === true) return "approved";
  if (img.human_approved === false) return "rejected";
  return "pending";
}

function finalApprovedCount(images: ConvertedImage[]): number {
  const hasAiReview = images.some((i) => i.ai_approved !== null);
  if (!hasAiReview) return images.filter((i) => i.human_approved === true).length;
  return images.filter((i) => i.human_approved === true && i.ai_approved === true).length;
}

// ─────────────────────────────────────────────────────────────────
// Image modal
// ─────────────────────────────────────────────────────────────────

function ImageModal({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        className="absolute right-4 top-4 rounded-full bg-zinc-800 p-2 text-zinc-300 hover:bg-zinc-700"
        onClick={onClose}
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={src}
        alt="Full size preview"
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Top-up modal (chains generate + convert)
// ─────────────────────────────────────────────────────────────────

const POSE_OPTIONS = [
  "any",
  "standing_neutral",
  "standing_attitude",
  "walking",
  "seated",
  "lying_down",
  "bent_arched",
  "over_shoulder",
  "crouching",
];
const CLOTHING_OPTIONS = ["any", "fully_clothed", "partially_clothed", "lingerie", "minimal"];

function TopupModal({
  needed,
  sessionId,
  onClose,
  onComplete,
}: {
  needed: number;
  sessionId: string;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [count, setCount] = useState(Math.min(needed + 10, 50));
  const [pose, setPose] = useState("any");
  const [clothing, setClothing] = useState("any");
  const [phase, setPhase] = useState<TopupPhase>("idle");
  const [animeProgress, setAnimeProgress] = useState({ done: 0, total: 0 });
  const [convertProgress, setConvertProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    setPhase("generating");
    setError(null);

    // Step 1: Dispatch anime generation
    const topupRes = await fetch(`/api/lora-studio/${sessionId}/generate-topup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        count,
        poseCategory: pose === "any" ? null : pose,
        clothingState: clothing === "any" ? null : clothing,
      }),
    });
    const topupData = await topupRes.json();
    if (!topupRes.ok || topupData.count === 0) {
      setError(topupData.errors?.join(", ") ?? "Generation failed");
      setPhase("idle");
      return;
    }

    const dispatchedIds = new Set<string>(
      (topupData.dispatched ?? []).map((d: { imageId: string }) => d.imageId),
    );
    const total = dispatchedIds.size;
    setAnimeProgress({ done: 0, total });

    // Step 2: Poll anime-status until all new images are ready, then convert each
    setPhase("converting");
    setConvertProgress({ done: 0, total });

    const convertedSoFar = new Set<string>();
    const MAX_WAIT_MS = 10 * 60 * 1000; // 10 minutes
    const start = Date.now();

    while (convertedSoFar.size < total && Date.now() - start < MAX_WAIT_MS) {
      await sleep(4000);

      const statusRes = await fetch(`/api/lora-studio/${sessionId}/anime-status`);
      if (!statusRes.ok) continue;
      const statusData = await statusRes.json();
      const readyNow = (statusData.images ?? []).filter(
        (img: any) =>
          dispatchedIds.has(img.id) &&
          (img.status === "ready" || img.status === "approved") &&
          img.anime_image_url &&
          !convertedSoFar.has(img.id),
      );

      setAnimeProgress({ done: (statusData.images ?? []).filter((img: any) => dispatchedIds.has(img.id) && (img.status === "ready" || img.status === "approved")).length, total });

      // Dispatch conversions for newly-ready anime images
      for (const img of readyNow) {
        convertedSoFar.add(img.id);
        fetch(`/api/lora-studio/${sessionId}/convert-image`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageId: img.id }),
        }).catch(console.error);
      }
      setConvertProgress({ done: convertedSoFar.size, total });
    }

    setPhase("done");
    await sleep(1000);
    onComplete();
    onClose();
  }, [count, pose, clothing, sessionId, onComplete, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div
        className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-base font-semibold text-zinc-100">Generate & Convert More</h3>
        <p className="mb-4 text-xs text-zinc-500">
          Generates new anime images, then automatically converts them to photorealistic via Flux.
        </p>

        {phase === "idle" && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Count (max 50)</label>
              <input
                type="number"
                min={1}
                max={50}
                value={count}
                onChange={(e) => setCount(Math.min(50, Math.max(1, Number(e.target.value))))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Pose</label>
              <select
                value={pose}
                onChange={(e) => setPose(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
              >
                {POSE_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Clothing</label>
              <select
                value={clothing}
                onChange={(e) => setClothing(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
              >
                {CLOTHING_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            {error && (
              <p className="text-xs text-red-400">{error}</p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-amber-100 hover:bg-amber-600"
              >
                <Plus className="h-4 w-4" />
                Generate {count}
              </button>
            </div>
          </div>
        )}

        {(phase === "generating" || phase === "converting") && (
          <div className="space-y-5 py-2">
            {/* Anime generation progress */}
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className={phase === "generating" ? "text-amber-400" : "text-zinc-400"}>
                  {phase === "generating" && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
                  Step 1 — Generate anime
                </span>
                <span className="text-zinc-500">
                  {animeProgress.done}/{animeProgress.total}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-amber-600 transition-all duration-500"
                  style={{ width: animeProgress.total > 0 ? `${(animeProgress.done / animeProgress.total) * 100}%` : "0%" }}
                />
              </div>
            </div>

            {/* Conversion progress */}
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className={phase === "converting" ? "text-amber-400" : "text-zinc-500"}>
                  {phase === "converting" && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
                  Step 2 — Convert to photorealistic
                </span>
                <span className="text-zinc-500">
                  {convertProgress.done}/{convertProgress.total}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-emerald-600 transition-all duration-500"
                  style={{ width: convertProgress.total > 0 ? `${(convertProgress.done / convertProgress.total) * 100}%` : "0%" }}
                />
              </div>
            </div>

            <p className="text-center text-xs text-zinc-500">
              New images will appear in the approval grid automatically.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Image card
// ─────────────────────────────────────────────────────────────────

function ApprovalCard({
  converted,
  animeUrl,
  focused,
  onApprove,
  onReject,
  onZoom,
  onAiOverride,
}: {
  converted: ConvertedImage;
  animeUrl: string | undefined;
  focused: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onZoom: (url: string) => void;
  onAiOverride: (id: string) => void;
}) {
  const hs = humanStatus(converted);

  const borderClass =
    hs === "approved"
      ? "border-emerald-600"
      : hs === "rejected"
      ? "border-red-700 opacity-70"
      : focused
      ? "border-blue-500"
      : "border-zinc-700";

  return (
    <div className={`flex flex-col rounded-lg border-2 bg-zinc-900 transition-all ${borderClass}`}>
      {/* Side-by-side images */}
      <div className="flex gap-1 p-1.5">
        {/* Anime source — smaller */}
        <div className="relative w-[35%] shrink-0">
          <div className="aspect-[2/3] overflow-hidden rounded bg-zinc-800">
            {animeUrl ? (
              <img src={animeUrl} alt="Anime source" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-zinc-700 text-[8px]">
                src
              </div>
            )}
          </div>
          <span className="absolute left-0.5 top-0.5 rounded bg-black/70 px-1 py-px text-[7px] text-zinc-400">
            Anime
          </span>
        </div>

        {/* Converted — main focus */}
        <div className="relative flex-1">
          <div className="aspect-[2/3] overflow-hidden rounded bg-zinc-800">
            {converted.convertedSignedUrl ? (
              <>
                <img
                  src={converted.convertedSignedUrl}
                  alt="Converted photorealistic"
                  className="h-full w-full object-cover"
                />
                {/* Click to enlarge */}
                <div
                  className="absolute inset-0 cursor-zoom-in"
                  onClick={() => onZoom(converted.convertedSignedUrl!)}
                />
              </>
            ) : (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
              </div>
            )}
          </div>
          <span className="absolute left-0.5 top-0.5 rounded bg-black/70 px-1 py-px text-[7px] text-zinc-400">
            Flux
          </span>
          {converted.convertedSignedUrl && (
            <button
              className="absolute right-0.5 top-0.5 rounded bg-black/60 p-0.5 text-zinc-400 hover:text-zinc-200"
              onClick={() => onZoom(converted.convertedSignedUrl!)}
              title="Enlarge"
            >
              <ZoomIn className="h-3 w-3" />
            </button>
          )}
          {/* Approval badge */}
          {hs === "approved" && (
            <span className="absolute bottom-0.5 left-0.5 rounded bg-emerald-700/80 px-1 py-px text-[8px] font-medium text-emerald-100">
              ✓
            </span>
          )}
          {hs === "rejected" && (
            <span className="absolute bottom-0.5 left-0.5 rounded bg-red-800/80 px-1 py-px text-[8px] font-medium text-red-200">
              ✗
            </span>
          )}
        </div>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-0.5 px-1.5">
        {[converted.pose_category, converted.clothing_state, converted.angle_category]
          .filter(Boolean)
          .map((tag) => (
            <span
              key={tag}
              className="rounded bg-zinc-800 px-1 py-0.5 text-[8px] leading-tight text-zinc-500"
            >
              {fmtTag(tag)}
            </span>
          ))}
      </div>

      {/* AI review result */}
      {converted.ai_approved !== null && (
        <div className="mx-1.5 mt-1 rounded border border-zinc-700 bg-zinc-800/60 px-1.5 py-1">
          <div className="flex items-center gap-1">
            <Bot className="h-3 w-3 shrink-0 text-zinc-500" />
            <span
              className={`text-[9px] font-medium ${
                converted.ai_approved ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {converted.ai_approved ? "AI ✓" : "AI ✗"}
            </span>
          </div>
          {converted.ai_rejection_reason && (
            <p className="mt-0.5 text-[8px] leading-snug text-zinc-500 line-clamp-2">
              {converted.ai_rejection_reason}
            </p>
          )}
          {!converted.ai_approved && converted.human_approved === true && (
            <button
              onClick={() => onAiOverride(converted.id)}
              className="mt-1 w-full rounded bg-zinc-700 py-0.5 text-[8px] text-zinc-300 hover:bg-zinc-600"
            >
              Override — keep approved
            </button>
          )}
        </div>
      )}

      {/* Approve / Reject */}
      <div className="mt-auto flex gap-1 p-1.5">
        <button
          onClick={() => onApprove(converted.id)}
          className={`flex flex-1 items-center justify-center gap-1 rounded py-1.5 text-xs font-medium transition-colors ${
            hs === "approved"
              ? "bg-emerald-700 text-emerald-100"
              : "bg-zinc-800 text-zinc-400 hover:bg-emerald-900/50 hover:text-emerald-300"
          }`}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          ✓
        </button>
        <button
          onClick={() => onReject(converted.id)}
          className={`flex flex-1 items-center justify-center gap-1 rounded py-1.5 text-xs font-medium transition-colors ${
            hs === "rejected"
              ? "bg-red-800 text-red-200"
              : "bg-zinc-800 text-zinc-400 hover:bg-red-900/50 hover:text-red-300"
          }`}
        >
          <XCircle className="h-3.5 w-3.5" />
          ✗
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────

const TARGET = 100;
const AI_BATCH_SIZE = 5;
const AI_BATCH_DELAY_MS = 1000;
const POLL_INTERVAL_MS = 4000;

export default function ApproveConvertedPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;

  const [convertedImages, setConvertedImages] = useState<ConvertedImage[]>([]);
  const [animeMap, setAnimeMap] = useState<Map<string, string>>(new Map()); // animeId → signedUrl
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [approveAllConfirm, setApproveAllConfirm] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [aiProgress, setAiProgress] = useState<{ done: number; total: number } | null>(null);
  const [proceedLoading, setProceedLoading] = useState(false);
  const [proceedDone, setProceedDone] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPolling = useRef(false);

  // ── Data loading ─────────────────────────────────────────────

  const loadConverted = useCallback(async () => {
    const res = await fetch(`/api/lora-studio/${sessionId}/conversion-status`);
    if (!res.ok) return;
    const data = await res.json();
    const imgs: ConvertedImage[] = (data.images ?? []).map((img: any) => ({
      id: img.id,
      sourceAnimeId: img.anime_prompt,
      status: img.status,
      converted_image_url: img.converted_image_url,
      pose_category: img.pose_category,
      clothing_state: img.clothing_state,
      angle_category: img.angle_category,
      human_approved: img.human_approved,
      ai_approved: img.ai_approved,
      ai_rejection_reason: img.ai_rejection_reason,
      convertedSignedUrl: data.signedUrls?.[img.id] ?? undefined,
    }));
    setConvertedImages(imgs);
  }, [sessionId]);

  const loadAnime = useCallback(async () => {
    const res = await fetch(`/api/lora-studio/${sessionId}/anime-status`);
    if (!res.ok) return;
    const data = await res.json();
    const map = new Map<string, string>();
    for (const img of data.images ?? []) {
      const url = data.signedUrls?.[img.id];
      if (url) map.set(img.id, url);
    }
    setAnimeMap(map);
  }, [sessionId]);

  const loadAll = useCallback(async () => {
    await Promise.all([loadConverted(), loadAnime()]);
    setLoading(false);
  }, [loadConverted, loadAnime]);

  useEffect(() => {
    loadAll();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ── Polling (while any conversions still generating) ─────────

  const hasGenerating = convertedImages.some((i) => i.status === "generating");

  useEffect(() => {
    if (hasGenerating) {
      if (!pollRef.current) {
        pollRef.current = setInterval(async () => {
          if (isPolling.current) return;
          isPolling.current = true;
          await loadConverted();
          isPolling.current = false;
        }, POLL_INTERVAL_MS);
      }
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
  }, [hasGenerating, loadConverted]);

  // ── Derived stats ─────────────────────────────────────────────

  const ready = convertedImages.filter((i) => i.status === "ready" || i.status === "approved" || i.status === "generating");
  const humanApproved = convertedImages.filter((i) => i.human_approved === true).length;
  const humanRejected = convertedImages.filter((i) => i.human_approved === false).length;
  const humanPending = convertedImages.filter((i) => i.human_approved === null && i.status === "ready").length;
  const aiApproved = convertedImages.filter((i) => i.ai_approved === true).length;
  const aiRejected = convertedImages.filter((i) => i.ai_approved === false).length;
  const finalApproved = finalApprovedCount(convertedImages);
  const hasAiRun = convertedImages.some((i) => i.ai_approved !== null);
  const needed = Math.max(0, TARGET - finalApproved);
  const canProceed = finalApproved >= TARGET && !proceedDone;

  // ── Filter ────────────────────────────────────────────────────

  const readyImages = convertedImages.filter((i) => i.status === "ready");
  const filteredImages = readyImages.filter((img) => {
    if (filter === "pending") return img.human_approved === null;
    if (filter === "approved") return img.human_approved === true;
    if (filter === "rejected") return img.human_approved === false;
    return true;
  });

  // ── Approve / Reject ─────────────────────────────────────────

  const updateApproval = useCallback(
    async (imageId: string, approved: boolean) => {
      setConvertedImages((prev) =>
        prev.map((img) => (img.id === imageId ? { ...img, human_approved: approved } : img)),
      );
      await fetch(`/api/lora-studio/${sessionId}/approve-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId, approved }),
      });
    },
    [sessionId],
  );

  const handleApprove = useCallback((id: string) => updateApproval(id, true), [updateApproval]);
  const handleReject = useCallback((id: string) => updateApproval(id, false), [updateApproval]);

  const handleAiOverride = useCallback((imageId: string) => {
    setConvertedImages((prev) =>
      prev.map((img) =>
        img.id === imageId ? { ...img, ai_approved: true, ai_rejection_reason: null } : img,
      ),
    );
  }, []);

  // ── Approve all pending ───────────────────────────────────────

  const handleApproveAllRemaining = useCallback(async () => {
    setApproveAllConfirm(false);
    const pending = readyImages.filter((i) => i.human_approved === null);
    for (const img of pending) {
      await updateApproval(img.id, true);
    }
  }, [readyImages, updateApproval]);

  // ── Keyboard navigation ───────────────────────────────────────

  const focusedRef = useRef(focusedIndex);
  focusedRef.current = focusedIndex;

  useEffect(() => {
    if (zoomUrl || topupOpen || approveAllConfirm) return;
    const handler = (e: KeyboardEvent) => {
      const imgs = filteredImages;
      const idx = focusedRef.current;
      const img = imgs[idx];
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (img) handleApprove(img.id);
        setFocusedIndex((i) => Math.min(i + 1, imgs.length - 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (img) handleReject(img.id);
        setFocusedIndex((i) => Math.min(i + 1, imgs.length - 1));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, imgs.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filteredImages, zoomUrl, topupOpen, approveAllConfirm, handleApprove, handleReject]);

  useEffect(() => setFocusedIndex(0), [filter]);

  // ── AI Review ─────────────────────────────────────────────────

  const handleRunAiReview = useCallback(async () => {
    const humanApprovedImgs = convertedImages.filter(
      (i) => i.human_approved === true && i.convertedSignedUrl,
    );
    if (humanApprovedImgs.length === 0) return;

    setAiRunning(true);
    setAiProgress({ done: 0, total: humanApprovedImgs.length });

    for (let i = 0; i < humanApprovedImgs.length; i += AI_BATCH_SIZE) {
      const batch = humanApprovedImgs.slice(i, i + AI_BATCH_SIZE);
      try {
        const res = await fetch(`/api/lora-studio/${sessionId}/ai-review-converted`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageIds: batch.map((img) => img.id) }),
        });
        if (res.ok) {
          const data = await res.json();
          const resultMap = new Map<string, { approved: boolean; reason: string }>(
            (data.results ?? []).map((r: any) => [r.id, r]),
          );
          setConvertedImages((prev) =>
            prev.map((img) => {
              const result = resultMap.get(img.id);
              if (!result) return img;
              return {
                ...img,
                ai_approved: result.approved,
                ai_rejection_reason: result.approved ? null : result.reason,
              };
            }),
          );
        }
      } catch (err) {
        console.error("[ai-review] batch error:", err);
      }
      setAiProgress({ done: Math.min(i + AI_BATCH_SIZE, humanApprovedImgs.length), total: humanApprovedImgs.length });
      if (i + AI_BATCH_SIZE < humanApprovedImgs.length) await sleep(AI_BATCH_DELAY_MS);
    }

    setAiRunning(false);
    setAiProgress(null);
  }, [convertedImages, sessionId]);

  // ── Proceed to Training ───────────────────────────────────────

  const handleProceed = useCallback(async () => {
    setProceedLoading(true);
    await fetch(`/api/lora-studio/${sessionId}/advance-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "captioning" }),
    });
    setProceedDone(true);
    setProceedLoading(false);
  }, [sessionId]);

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────

  const TABS: { key: FilterTab; label: string; count: number }[] = [
    { key: "all", label: "All", count: readyImages.length },
    { key: "pending", label: "Pending", count: humanPending },
    { key: "approved", label: "Approved", count: humanApproved },
    { key: "rejected", label: "Rejected", count: humanRejected },
  ];

  return (
    <div>
      {/* Modals */}
      {zoomUrl && <ImageModal src={zoomUrl} onClose={() => setZoomUrl(null)} />}
      {topupOpen && (
        <TopupModal
          needed={needed}
          sessionId={sessionId}
          onClose={() => setTopupOpen(false)}
          onComplete={loadAll}
        />
      )}
      {approveAllConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
            <h3 className="mb-2 text-base font-semibold text-zinc-100">Approve all pending?</h3>
            <p className="mb-5 text-sm text-zinc-400">
              This will approve all {humanPending} remaining pending images.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setApproveAllConfirm(false)}
                className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                onClick={handleApproveAllRemaining}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-600"
              >
                Approve All {humanPending}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Approve Converted Images</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Final review of Flux-converted images — anime source shown for comparison
          </p>
        </div>
        <button
          onClick={handleProceed}
          disabled={!canProceed || proceedLoading}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            canProceed && !proceedDone
              ? "bg-amber-700 text-amber-100 hover:bg-amber-600"
              : "pointer-events-none bg-zinc-800 text-zinc-600"
          }`}
        >
          {proceedLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : proceedDone ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              Proceeding…
            </>
          ) : (
            <>
              Proceed to Training
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>

      {proceedDone && (
        <div className="mb-4 rounded-lg border border-emerald-900/30 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-400">
          Session advanced to captioning stage.{" "}
          <Link
            href={`/admin/lora-studio/${sessionId}/train`}
            className="underline hover:text-emerald-300"
          >
            Go to Train →
          </Link>
        </div>
      )}

      {/* Stats bar */}
      <div className="mb-6 grid grid-cols-4 gap-2 sm:grid-cols-7">
        {[
          { label: "Total", value: readyImages.length, color: "text-zinc-100" },
          { label: "Human ✓", value: humanApproved, color: "text-emerald-400" },
          { label: "Human ✗", value: humanRejected, color: "text-red-400" },
          { label: "Pending", value: humanPending, color: "text-zinc-400" },
          { label: "AI ✓", value: aiApproved, color: "text-emerald-400" },
          { label: "AI ✗", value: aiRejected, color: "text-red-400" },
          {
            label: "Final ✓",
            value: finalApproved,
            color: finalApproved >= TARGET ? "text-emerald-400" : "text-amber-400",
          },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-center"
          >
            <p className={`text-lg font-bold ${color}`}>{value}</p>
            <p className="text-[10px] text-zinc-500">{label}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs + actions */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
          {TABS.map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === key ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {label}
              <span className="ml-1.5 text-[10px] opacity-70">{count}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setApproveAllConfirm(true)}
            disabled={humanPending === 0}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
          >
            Approve All Remaining ({humanPending})
          </button>
          <button
            onClick={loadAll}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Keyboard hint */}
      <p className="mb-4 text-[11px] text-zinc-600">
        Keyboard: <span className="font-mono">→</span> Approve &nbsp;·&nbsp;{" "}
        <span className="font-mono">←</span> Reject &nbsp;·&nbsp;{" "}
        <span className="font-mono">↑↓</span> Navigate
      </p>

      {/* Image grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-zinc-500">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : filteredImages.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-700 px-6 py-12 text-center text-sm text-zinc-500">
          {readyImages.length === 0
            ? "No converted images ready yet — run Flux Conversion first."
            : "No images in this filter."}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {filteredImages.map((img, idx) => (
            <ApprovalCard
              key={img.id}
              converted={img}
              animeUrl={animeMap.get(img.sourceAnimeId)}
              focused={idx === focusedIndex}
              onApprove={handleApprove}
              onReject={handleReject}
              onZoom={setZoomUrl}
              onAiOverride={handleAiOverride}
            />
          ))}
        </div>
      )}

      {/* AI Review section */}
      <div className="mt-10 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200">AI Quality Review</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Claude Vision checks each approved image for photorealism, dark skin, and curvaceous proportions.
            </p>
          </div>
          <button
            onClick={handleRunAiReview}
            disabled={aiRunning || humanApproved === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
          >
            {aiRunning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {aiProgress
                  ? `Reviewing ${aiProgress.done} / ${aiProgress.total}`
                  : "Running…"}
              </>
            ) : (
              <>
                <Bot className="h-4 w-4" />
                {hasAiRun ? "Re-run AI Review" : "Run AI Review"}
              </>
            )}
          </button>
        </div>
        {aiRunning && aiProgress && (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-zinc-500">
              <span>Reviewing image {aiProgress.done} of {aiProgress.total}</span>
              <span>{Math.round((aiProgress.done / aiProgress.total) * 100)}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-amber-600 transition-all duration-300"
                style={{ width: `${(aiProgress.done / aiProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}
        {hasAiRun && !aiRunning && (
          <div className="mt-4 flex gap-4 text-xs">
            <span className="text-emerald-400">{aiApproved} AI approved</span>
            <span className="text-red-400">{aiRejected} AI rejected</span>
            <span className="text-zinc-400">{finalApproved} final approved</span>
          </div>
        )}
      </div>

      {/* Top-up section */}
      <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200">
              {needed > 0
                ? `You need ${needed} more approved image${needed === 1 ? "" : "s"} to reach ${TARGET}.`
                : `You have ${finalApproved} approved images — ready to proceed!`}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Generates new anime images and automatically converts them before adding to this queue.
            </p>
          </div>
          <button
            onClick={() => setTopupOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
          >
            <Plus className="h-4 w-4" />
            Generate & Convert More
          </button>
        </div>
      </div>

      {/* Proceed footer */}
      {canProceed && (
        <div className="mt-6 flex justify-end">
          <button
            onClick={handleProceed}
            disabled={proceedLoading || proceedDone}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-5 py-2.5 text-sm font-medium text-amber-100 hover:bg-amber-600 disabled:opacity-60"
          >
            {proceedLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
            Proceed to Training
          </button>
        </div>
      )}
    </div>
  );
}
