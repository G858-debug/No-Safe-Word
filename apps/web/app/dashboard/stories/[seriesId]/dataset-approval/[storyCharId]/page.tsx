"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowRight,
  ZoomIn,
  X,
  ArrowLeft,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface DatasetImage {
  id: string;
  image_url: string;
  category: string;
  variation_type: string;
  eval_status: string;
  eval_score: number | null;
  eval_details: {
    face_score: number;
    body_score: number;
    quality_score: number;
    verdict: string;
    issues: string[];
  } | null;
  human_approved: boolean | null;
  caption: string | null;
}

interface Stats {
  total: number;
  passed: number;
  humanApproved: number;
  humanRejected: number;
  humanPending: number;
  minRequired: number;
}

type FilterTab = "all" | "pending" | "approved" | "rejected";

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function fmtTag(val: string) {
  return val.replace(/[-_]/g, " ");
}

function approvalStatus(img: DatasetImage): "approved" | "rejected" | "pending" {
  if (img.human_approved === true) return "approved";
  if (img.human_approved === false) return "rejected";
  return "pending";
}

function scoreColor(score: number): string {
  if (score >= 8) return "text-emerald-400";
  if (score >= 7) return "text-amber-400";
  return "text-red-400";
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
// Image card
// ─────────────────────────────────────────────────────────────────

function DatasetImageCard({
  img,
  focused,
  onApprove,
  onReject,
  onZoom,
}: {
  img: DatasetImage;
  focused: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onZoom: (url: string) => void;
}) {
  const status = approvalStatus(img);

  const borderClass =
    status === "approved"
      ? "border-emerald-600"
      : status === "rejected"
      ? "border-red-700 opacity-70"
      : focused
      ? "border-blue-500"
      : "border-zinc-700";

  return (
    <div
      className={`flex flex-col rounded-lg border-2 bg-zinc-900 transition-all ${borderClass}`}
    >
      {/* Image */}
      <div className="relative aspect-square w-full overflow-hidden rounded-t-md bg-zinc-800">
        <img
          src={img.image_url}
          alt={`Dataset ${img.category}`}
          className="h-full w-full object-cover"
        />
        <div
          className="absolute inset-0 cursor-zoom-in"
          onClick={() => onZoom(img.image_url)}
        />
        <button
          onClick={() => onZoom(img.image_url)}
          className="absolute right-1.5 top-1.5 rounded bg-black/60 p-1 text-zinc-300 hover:bg-black/80"
          title="Enlarge"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>

        {/* Status badge */}
        {status === "approved" && (
          <span className="absolute left-1.5 top-1.5 rounded bg-emerald-700/80 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-100">
            Approved
          </span>
        )}
        {status === "rejected" && (
          <span className="absolute left-1.5 top-1.5 rounded bg-red-800/80 px-1.5 py-0.5 text-[9px] font-semibold text-red-200">
            Rejected
          </span>
        )}
      </div>

      {/* Tags & scores */}
      <div className="space-y-1 px-1.5 pt-1.5">
        <div className="flex flex-wrap gap-0.5">
          <span className="rounded bg-zinc-800 px-1 py-0.5 text-[8px] leading-tight text-zinc-400">
            {fmtTag(img.category)}
          </span>
          <span className="rounded bg-zinc-800 px-1 py-0.5 text-[8px] leading-tight text-zinc-500">
            {fmtTag(img.variation_type)}
          </span>
        </div>

        {/* Eval scores */}
        {img.eval_details && (
          <div className="flex gap-2 text-[9px]">
            <span className={scoreColor(img.eval_details.face_score)}>
              Face {img.eval_details.face_score}
            </span>
            <span className={scoreColor(img.eval_details.body_score)}>
              Body {img.eval_details.body_score}
            </span>
            <span className={scoreColor(img.eval_details.quality_score)}>
              Quality {img.eval_details.quality_score}
            </span>
          </div>
        )}

        {/* Issues */}
        {img.eval_details?.issues && img.eval_details.issues.length > 0 && (
          <p className="text-[8px] leading-snug text-red-400/70 line-clamp-2">
            {img.eval_details.issues.join(", ")}
          </p>
        )}
      </div>

      {/* Approve / Reject buttons */}
      <div className="mt-auto flex gap-1 p-1.5">
        <button
          onClick={() => onApprove(img.id)}
          className={`flex flex-1 items-center justify-center gap-1 rounded py-1.5 text-xs font-medium transition-colors ${
            status === "approved"
              ? "bg-emerald-700 text-emerald-100"
              : "bg-zinc-800 text-zinc-400 hover:bg-emerald-900/50 hover:text-emerald-300"
          }`}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onReject(img.id)}
          className={`flex flex-1 items-center justify-center gap-1 rounded py-1.5 text-xs font-medium transition-colors ${
            status === "rejected"
              ? "bg-red-800 text-red-200"
              : "bg-zinc-800 text-zinc-400 hover:bg-red-900/50 hover:text-red-300"
          }`}
        >
          <XCircle className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────

export default function DatasetApprovalPage() {
  const params = useParams<{ seriesId: string; storyCharId: string }>();
  const router = useRouter();
  const { seriesId, storyCharId } = params;

  const [images, setImages] = useState<DatasetImage[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loraId, setLoraId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [approveAllConfirm, setApproveAllConfirm] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  // ── Load images ──────────────────────────────────────────────

  const loadImages = useCallback(async () => {
    const res = await fetch(`/api/stories/characters/${storyCharId}/dataset-images`);
    if (!res.ok) return;
    const data = await res.json();
    setImages(data.images ?? []);
    setStats(data.stats ?? null);
    setLoraId(data.loraId ?? null);
    setLoading(false);
  }, [storyCharId]);

  useEffect(() => {
    loadImages();
  }, [loadImages]);

  // ── Derived ─────────────────────────────────────────────────

  const humanApproved = images.filter((i) => i.human_approved === true).length;
  const humanRejected = images.filter((i) => i.human_approved === false).length;
  const humanPending = images.filter((i) => i.human_approved === null).length;
  const minRequired = stats?.minRequired ?? 20;
  const canResume = humanApproved >= minRequired;

  // ── Filtered images ─────────────────────────────────────────

  const filteredImages = images.filter((img) => {
    if (filter === "pending") return img.human_approved === null;
    if (filter === "approved") return img.human_approved === true;
    if (filter === "rejected") return img.human_approved === false;
    return true;
  });

  // ── Approve / Reject ───────────────────────────────────────

  const updateApproval = useCallback(
    async (imageIds: string[], approved: boolean) => {
      // Optimistic update
      setImages((prev) =>
        prev.map((img) =>
          imageIds.includes(img.id) ? { ...img, human_approved: approved } : img
        )
      );

      await fetch(`/api/stories/characters/${storyCharId}/approve-dataset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageIds, approved }),
      });
    },
    [storyCharId]
  );

  const handleApprove = useCallback(
    (id: string) => updateApproval([id], true),
    [updateApproval]
  );
  const handleReject = useCallback(
    (id: string) => updateApproval([id], false),
    [updateApproval]
  );

  // ── Approve all pending ─────────────────────────────────────

  const handleApproveAllRemaining = useCallback(async () => {
    setApproveAllConfirm(false);
    const pendingIds = images
      .filter((i) => i.human_approved === null)
      .map((i) => i.id);
    if (pendingIds.length > 0) {
      await updateApproval(pendingIds, true);
    }
  }, [images, updateApproval]);

  // ── Resume training ─────────────────────────────────────────

  const handleResume = useCallback(async () => {
    setResuming(true);
    setResumeError(null);

    try {
      const res = await fetch(
        `/api/stories/characters/${storyCharId}/resume-training`,
        { method: "POST" }
      );
      const data = await res.json();

      if (!res.ok) {
        setResumeError(data.error || "Failed to resume training");
        setResuming(false);
        return;
      }

      // Navigate back to the character approval page
      router.push(`/dashboard/stories/${seriesId}`);
    } catch {
      setResumeError("Network error");
      setResuming(false);
    }
  }, [storyCharId, seriesId, router]);

  // ── Keyboard navigation ─────────────────────────────────────

  const focusedRef = useRef(focusedIndex);
  focusedRef.current = focusedIndex;

  useEffect(() => {
    if (zoomUrl || approveAllConfirm) return;

    const handler = (e: KeyboardEvent) => {
      const visible = filteredImages;
      const idx = focusedRef.current;
      const img = visible[idx];

      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (img) handleApprove(img.id);
        setFocusedIndex((i) => Math.min(i + 1, visible.length - 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (img) handleReject(img.id);
        setFocusedIndex((i) => Math.min(i + 1, visible.length - 1));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, visible.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filteredImages, zoomUrl, approveAllConfirm, handleApprove, handleReject]);

  useEffect(() => {
    setFocusedIndex(0);
  }, [filter]);

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────

  const TABS: { key: FilterTab; label: string; count: number }[] = [
    { key: "all", label: "All", count: images.length },
    { key: "pending", label: "Pending", count: humanPending },
    { key: "approved", label: "Approved", count: humanApproved },
    { key: "rejected", label: "Rejected", count: humanRejected },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* Modals */}
      {zoomUrl && <ImageModal src={zoomUrl} onClose={() => setZoomUrl(null)} />}

      {approveAllConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
            <h3 className="mb-2 text-base font-semibold text-zinc-100">
              Approve all pending?
            </h3>
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
          <Link
            href={`/dashboard/stories/${seriesId}`}
            className="mb-2 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to Characters
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">
            Review Dataset Images
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review AI-generated training images before LoRA training begins. Need{" "}
            {minRequired} approved to proceed.
          </p>
        </div>
        <button
          onClick={handleResume}
          disabled={!canResume || resuming}
          className={`inline-flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors ${
            canResume && !resuming
              ? "bg-amber-700 text-amber-100 hover:bg-amber-600"
              : "pointer-events-none bg-zinc-800 text-zinc-600"
          }`}
        >
          {resuming ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Resuming...
            </>
          ) : (
            <>
              Resume Training
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>

      {resumeError && (
        <div className="mb-4 rounded-lg border border-red-900/30 bg-red-950/20 px-4 py-3 text-sm text-red-400">
          {resumeError}
        </div>
      )}

      {/* Stats bar */}
      <div className="mb-6 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {[
          { label: "Total", value: images.length, color: "text-zinc-100" },
          { label: "AI Passed", value: stats?.passed ?? 0, color: "text-blue-400" },
          { label: "Approved", value: humanApproved, color: "text-emerald-400" },
          { label: "Rejected", value: humanRejected, color: "text-red-400" },
          { label: "Pending", value: humanPending, color: "text-zinc-400" },
          {
            label: `Min Required`,
            value: `${humanApproved}/${minRequired}`,
            color: humanApproved >= minRequired ? "text-emerald-400" : "text-amber-400",
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

      {/* Keyboard shortcut hint */}
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
          No images in this category.
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {filteredImages.map((img, idx) => (
            <DatasetImageCard
              key={img.id}
              img={img}
              focused={idx === focusedIndex}
              onApprove={handleApprove}
              onReject={handleReject}
              onZoom={setZoomUrl}
            />
          ))}
        </div>
      )}

      {/* Resume footer */}
      {canResume && (
        <div className="mt-8 flex justify-end">
          <button
            onClick={handleResume}
            disabled={resuming}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-5 py-2.5 text-sm font-medium text-amber-100 hover:bg-amber-600 disabled:opacity-50"
          >
            {resuming ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Resuming...
              </>
            ) : (
              <>
                Resume Training ({humanApproved} images)
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
