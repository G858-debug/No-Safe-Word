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

interface ImageRecord {
  id: string;
  status: string;
  anime_image_url: string | null;
  anime_prompt: string;
  pose_category: string | null;
  lighting_category: string | null;
  clothing_state: string | null;
  angle_category: string | null;
  human_approved: boolean | null;
  ai_approved: boolean | null;
  ai_rejection_reason: string | null;
  signedUrl?: string;
}

type FilterTab = "all" | "pending" | "approved" | "rejected";

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function fmtTag(val: string | null) {
  return val ? val.replace(/_/g, " ") : "";
}

function humanStatus(img: ImageRecord): "approved" | "rejected" | "pending" {
  if (img.human_approved === true) return "approved";
  if (img.human_approved === false) return "rejected";
  return "pending";
}

function finalApprovedCount(images: ImageRecord[]): number {
  // Images with human_approved=true and either ai_approved=true or ai not yet run
  const hasAiReview = images.some((i) => i.ai_approved !== null);
  if (!hasAiReview) {
    return images.filter((i) => i.human_approved === true).length;
  }
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
// Topup modal
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
  onClose,
  onGenerate,
}: {
  needed: number;
  onClose: () => void;
  onGenerate: (count: number, pose: string | null, clothing: string | null) => Promise<void>;
}) {
  const [count, setCount] = useState(Math.min(needed + 10, 50));
  const [pose, setPose] = useState("any");
  const [clothing, setClothing] = useState("any");
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    await onGenerate(count, pose === "any" ? null : pose, clothing === "any" ? null : clothing);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div
        className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-base font-semibold text-zinc-100">Generate More Images</h3>

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
            <label className="mb-1 block text-xs text-zinc-400">Pose category</label>
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
            <label className="mb-1 block text-xs text-zinc-400">Clothing state</label>
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
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-amber-100 hover:bg-amber-600 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Generate {count}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Image card
// ─────────────────────────────────────────────────────────────────

function ImageCard({
  img,
  focused,
  onApprove,
  onReject,
  onZoom,
  onAiOverride,
}: {
  img: ImageRecord;
  focused: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onZoom: (url: string) => void;
  onAiOverride: (id: string) => void;
}) {
  const hs = humanStatus(img);

  const borderClass =
    hs === "approved"
      ? "border-emerald-600"
      : hs === "rejected"
      ? "border-red-700 opacity-70"
      : focused
      ? "border-blue-500"
      : "border-zinc-700";

  return (
    <div
      className={`flex flex-col rounded-lg border-2 bg-zinc-900 transition-all ${borderClass}`}
    >
      {/* Image */}
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-t-md bg-zinc-800">
        {img.signedUrl ? (
          <>
            <img
              src={img.signedUrl}
              alt={`Image ${img.id}`}
              className="h-full w-full object-cover"
            />
            <button
              onClick={() => onZoom(img.signedUrl!)}
              className="absolute right-1.5 top-1.5 rounded bg-black/60 p-1 text-zinc-300 opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100"
              style={{ opacity: undefined }}
              title="Enlarge"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            {/* Zoom on click */}
            <div
              className="absolute inset-0 cursor-zoom-in"
              onClick={() => onZoom(img.signedUrl!)}
            />
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-600 text-xs">
            {img.status === "generating" ? (
              <Loader2 className="h-5 w-5 animate-spin text-amber-500" />
            ) : (
              "No image"
            )}
          </div>
        )}

        {/* Status badge */}
        {hs === "approved" && (
          <span className="absolute left-1.5 top-1.5 rounded bg-emerald-700/80 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-100">
            ✓ Approved
          </span>
        )}
        {hs === "rejected" && (
          <span className="absolute left-1.5 top-1.5 rounded bg-red-800/80 px-1.5 py-0.5 text-[9px] font-semibold text-red-200">
            ✗ Rejected
          </span>
        )}
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-0.5 px-1.5 pt-1.5">
        {[img.pose_category, img.clothing_state, img.lighting_category, img.angle_category]
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
      {img.ai_approved !== null && (
        <div className="mx-1.5 mt-1 rounded border border-zinc-700 bg-zinc-800/60 px-1.5 py-1">
          <div className="flex items-center gap-1">
            <Bot className="h-3 w-3 shrink-0 text-zinc-500" />
            <span
              className={`text-[9px] font-medium ${img.ai_approved ? "text-emerald-400" : "text-red-400"}`}
            >
              {img.ai_approved ? "AI ✓" : "AI ✗"}
            </span>
          </div>
          {img.ai_rejection_reason && (
            <p className="mt-0.5 text-[8px] leading-snug text-zinc-500 line-clamp-2">
              {img.ai_rejection_reason}
            </p>
          )}
          {!img.ai_approved && img.human_approved === true && (
            <button
              onClick={() => onAiOverride(img.id)}
              className="mt-1 w-full rounded bg-zinc-700 py-0.5 text-[8px] text-zinc-300 hover:bg-zinc-600"
            >
              Override — keep approved
            </button>
          )}
        </div>
      )}

      {/* Approve / Reject buttons */}
      <div className="mt-auto flex gap-1 p-1.5">
        <button
          onClick={() => onApprove(img.id)}
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
          onClick={() => onReject(img.id)}
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

export default function ApproveAnimePage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;

  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [approveAllConfirm, setApproveAllConfirm] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [aiProgress, setAiProgress] = useState<{ done: number; total: number } | null>(null);
  const [topupError, setTopupError] = useState<string | null>(null);

  // ── Load images ──────────────────────────────────────────────

  const loadImages = useCallback(async () => {
    const res = await fetch(`/api/lora-studio/${sessionId}/anime-status`);
    if (!res.ok) return;
    const data = await res.json();
    const imgs: ImageRecord[] = (data.images ?? []).map((img: any) => ({
      ...img,
      signedUrl: data.signedUrls?.[img.id] ?? undefined,
    }));
    setImages(imgs);
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    loadImages();
  }, [loadImages]);

  // ── Derived stats ─────────────────────────────────────────────

  const humanApproved = images.filter((i) => i.human_approved === true).length;
  const humanRejected = images.filter((i) => i.human_approved === false).length;
  const humanPending = images.filter((i) => i.human_approved === null).length;
  const aiApproved = images.filter((i) => i.ai_approved === true).length;
  const aiRejected = images.filter((i) => i.ai_approved === false).length;
  const finalApproved = finalApprovedCount(images);
  const hasAiRun = images.some((i) => i.ai_approved !== null);

  // ── Filtered images ───────────────────────────────────────────

  const filteredImages = images.filter((img) => {
    if (img.status !== "ready" && img.status !== "approved" && img.status !== "rejected") {
      // Only show images that have been generated
      if (img.status !== "generating") return false;
    }
    if (filter === "pending") return img.human_approved === null;
    if (filter === "approved") return img.human_approved === true;
    if (filter === "rejected") return img.human_approved === false;
    return true;
  });

  // ── Approve / Reject ─────────────────────────────────────────

  const updateApproval = useCallback(
    async (imageId: string, approved: boolean) => {
      // Optimistic update
      setImages((prev) =>
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

  const handleApprove = useCallback(
    (id: string) => updateApproval(id, true),
    [updateApproval],
  );
  const handleReject = useCallback(
    (id: string) => updateApproval(id, false),
    [updateApproval],
  );

  // Override AI rejection — optimistic update only; persisted via ai-review-anime
  // The image stays human_approved=true; we flip ai_approved to true in local state
  // so it counts toward the final approved total. On next reload the DB value shows,
  // but the user can always re-run AI review to re-assess.
  const handleAiOverride = useCallback((imageId: string) => {
    setImages((prev) =>
      prev.map((img) =>
        img.id === imageId
          ? { ...img, ai_approved: true, ai_rejection_reason: null }
          : img,
      ),
    );
  }, []);

  // ── Approve all pending ───────────────────────────────────────

  const handleApproveAllRemaining = useCallback(async () => {
    setApproveAllConfirm(false);
    const pending = images.filter((i) => i.human_approved === null && i.signedUrl);
    for (const img of pending) {
      await updateApproval(img.id, true);
    }
  }, [images, updateApproval]);

  // ── Keyboard navigation ───────────────────────────────────────

  const focusedRef = useRef(focusedIndex);
  focusedRef.current = focusedIndex;

  useEffect(() => {
    if (zoomUrl || topupOpen || approveAllConfirm) return;

    const handler = (e: KeyboardEvent) => {
      const visibleImages = filteredImages;
      const idx = focusedRef.current;
      const img = visibleImages[idx];

      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (img) handleApprove(img.id);
        setFocusedIndex((i) => Math.min(i + 1, visibleImages.length - 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (img) handleReject(img.id);
        setFocusedIndex((i) => Math.min(i + 1, visibleImages.length - 1));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, visibleImages.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filteredImages, zoomUrl, topupOpen, approveAllConfirm, handleApprove, handleReject]);

  // Reset focused index when filter changes
  useEffect(() => {
    setFocusedIndex(0);
  }, [filter]);

  // ── AI Review ─────────────────────────────────────────────────

  const handleRunAiReview = useCallback(async () => {
    const humanApprovedImages = images.filter((i) => i.human_approved === true && i.signedUrl);
    if (humanApprovedImages.length === 0) return;

    setAiRunning(true);
    setAiProgress({ done: 0, total: humanApprovedImages.length });

    for (let i = 0; i < humanApprovedImages.length; i += AI_BATCH_SIZE) {
      const batch = humanApprovedImages.slice(i, i + AI_BATCH_SIZE);
      const ids = batch.map((img) => img.id);

      try {
        const res = await fetch(`/api/lora-studio/${sessionId}/ai-review-anime`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageIds: ids }),
        });

        if (res.ok) {
          const data = await res.json();
          const resultMap = new Map<string, { approved: boolean; reason: string }>(
            (data.results ?? []).map((r: any) => [r.id, { approved: r.approved, reason: r.reason }]),
          );

          setImages((prev) =>
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

      setAiProgress({ done: Math.min(i + AI_BATCH_SIZE, humanApprovedImages.length), total: humanApprovedImages.length });

      if (i + AI_BATCH_SIZE < humanApprovedImages.length) {
        await sleep(AI_BATCH_DELAY_MS);
      }
    }

    setAiRunning(false);
    setAiProgress(null);
  }, [images, sessionId]);

  // ── Topup generation ──────────────────────────────────────────

  const handleTopupGenerate = useCallback(
    async (count: number, poseCategory: string | null, clothingState: string | null) => {
      setTopupError(null);
      const res = await fetch(`/api/lora-studio/${sessionId}/generate-topup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count, poseCategory, clothingState }),
      });
      const data = await res.json();
      if (!res.ok || (data.errors && data.errors.length > 0)) {
        setTopupError(data.errors?.join(", ") ?? "Generation failed");
      }
      // Reload to pick up new generating images
      await loadImages();
    },
    [sessionId, loadImages],
  );

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────

  const needed = Math.max(0, TARGET - finalApproved);
  const canProceed = finalApproved >= TARGET;

  const TABS: { key: FilterTab; label: string; count: number }[] = [
    { key: "all", label: "All", count: images.filter((i) => i.signedUrl).length },
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
          onClose={() => setTopupOpen(false)}
          onGenerate={handleTopupGenerate}
        />
      )}

      {/* Approve All confirmation */}
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
          <h1 className="text-2xl font-bold tracking-tight">Approve Anime Images</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review and approve generated anime images · Need {TARGET} approved to proceed
          </p>
        </div>
        <Link
          href={`/admin/lora-studio/${sessionId}/convert`}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            canProceed
              ? "bg-amber-700 text-amber-100 hover:bg-amber-600"
              : "pointer-events-none bg-zinc-800 text-zinc-600"
          }`}
        >
          Proceed to Flux Conversion
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {/* ── Stats bar ─────────────────────────────────────────── */}
      <div className="mb-6 grid grid-cols-4 gap-2 sm:grid-cols-7">
        {[
          { label: "Total", value: images.filter((i) => i.signedUrl).length, color: "text-zinc-100" },
          { label: "Human ✓", value: humanApproved, color: "text-emerald-400" },
          { label: "Human ✗", value: humanRejected, color: "text-red-400" },
          { label: "Pending", value: humanPending, color: "text-zinc-400" },
          { label: "AI ✓", value: aiApproved, color: "text-emerald-400" },
          { label: "AI ✗", value: aiRejected, color: "text-red-400" },
          { label: "Final ✓", value: finalApproved, color: finalApproved >= TARGET ? "text-emerald-400" : "text-amber-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-center">
            <p className={`text-lg font-bold ${color}`}>{value}</p>
            <p className="text-[10px] text-zinc-500">{label}</p>
          </div>
        ))}
      </div>

      {/* ── Filter tabs + actions ─────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
          {TABS.map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === key
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
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
            onClick={loadImages}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* ── Keyboard shortcut hint ───────────────────────────── */}
      <p className="mb-4 text-[11px] text-zinc-600">
        Keyboard: <span className="font-mono">→</span> Approve &nbsp;·&nbsp;{" "}
        <span className="font-mono">←</span> Reject &nbsp;·&nbsp;{" "}
        <span className="font-mono">↑↓</span> Navigate
      </p>

      {/* ── Image grid ───────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-zinc-500">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : filteredImages.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-700 px-6 py-12 text-center text-sm text-zinc-500">
          No images in this category yet.
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
          {filteredImages.map((img, idx) => (
            <ImageCard
              key={img.id}
              img={img}
              focused={idx === focusedIndex}
              onApprove={handleApprove}
              onReject={handleReject}
              onZoom={setZoomUrl}
              onAiOverride={handleAiOverride}
            />
          ))}
        </div>
      )}

      {/* ── AI Review section ────────────────────────────────── */}
      <div className="mt-10 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200">AI Quality Review</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Claude Vision checks each human-approved image for curvaceous figure, dark skin, and correct anatomy.
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

        {/* AI progress bar */}
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

        {/* AI summary when done */}
        {hasAiRun && !aiRunning && (
          <div className="mt-4 flex gap-4 text-xs">
            <span className="text-emerald-400">{aiApproved} AI approved</span>
            <span className="text-red-400">{aiRejected} AI rejected</span>
            <span className="text-zinc-400">{finalApproved} final approved</span>
          </div>
        )}
      </div>

      {/* ── Top-up section ────────────────────────────────────── */}
      <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200">
              {needed > 0
                ? `You need ${needed} more image${needed === 1 ? "" : "s"} to reach ${TARGET} approved.`
                : `You have ${finalApproved} approved images — ready to proceed!`}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Generate additional images if you fall short of the {TARGET}-image target.
            </p>
          </div>

          <button
            onClick={() => setTopupOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
          >
            <Plus className="h-4 w-4" />
            Generate More Images
          </button>
        </div>

        {topupError && (
          <div className="mt-3 rounded-lg border border-red-900/30 bg-red-950/20 px-3 py-2 text-xs text-red-400">
            {topupError}
          </div>
        )}
      </div>

      {/* ── Proceed footer ────────────────────────────────────── */}
      {canProceed && (
        <div className="mt-6 flex justify-end">
          <Link
            href={`/admin/lora-studio/${sessionId}/convert`}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-5 py-2.5 text-sm font-medium text-amber-100 hover:bg-amber-600"
          >
            Proceed to Flux Conversion
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}
    </div>
  );
}
