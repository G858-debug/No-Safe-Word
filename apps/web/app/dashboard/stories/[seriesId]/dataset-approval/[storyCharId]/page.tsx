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
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Save,
  Check,
  Trash2,
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
  prompt_template: string | null;
  source: string | null;
  resolvedPrompt: string | null;
}

interface Stats {
  total: number;
  passed: number;
  humanApproved: number;
  humanRejected: number;
  humanPending: number;
  minRequired: number;
}

type FilterTab = "all" | "approved" | "rejected" | "needs_review";

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

function evalScoreColor(score: number): string {
  if (score >= 7) return "text-emerald-400";
  if (score >= 5) return "text-amber-400";
  return "text-red-400";
}

function sourceBadgeColor(source: string): string {
  if (source === "nano-banana") return "bg-blue-900/50 text-blue-300";
  if (source === "comfyui") return "bg-purple-900/50 text-purple-300";
  return "bg-amber-900/50 text-amber-300";
}

// ─────────────────────────────────────────────────────────────────
// Image Lightbox
// ─────────────────────────────────────────────────────────────────

function ImageLightbox({
  image,
  images,
  currentIndex,
  storyCharId,
  onClose,
  onNavigate,
  onApprove,
  onReject,
  onImageUpdate,
  onImageRegenerated,
  onImageDeleted,
  readOnly,
}: {
  image: DatasetImage;
  images: DatasetImage[];
  currentIndex: number;
  storyCharId: string;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onImageUpdate: (id: string, updates: Partial<DatasetImage>) => void;
  onImageRegenerated: (oldId: string, newImage: DatasetImage) => void;
  onImageDeleted: (id: string) => void;
  readOnly?: boolean;
}) {
  const [editedCaption, setEditedCaption] = useState(image.caption || "");
  const [editedPrompt, setEditedPrompt] = useState(image.resolvedPrompt || "");
  const [savingCaption, setSavingCaption] = useState(false);
  const [captionSaved, setCaptionSaved] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [approvingImage, setApprovingImage] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Reset local state when image changes (navigation)
  useEffect(() => {
    setEditedCaption(image.caption || "");
    setEditedPrompt(image.resolvedPrompt || "");
    setCaptionSaved(false);
    setRegenError(null);
    setDeleteConfirm(false);
  }, [image.id, image.caption, image.resolvedPrompt]);

  // Keyboard: Escape to close, arrows to navigate (when not in textarea)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inTextarea = target.tagName === "TEXTAREA";

      if (e.key === "Escape") {
        onClose();
      } else if (!inTextarea && e.key === "ArrowLeft") {
        e.preventDefault();
        if (currentIndex > 0) onNavigate(currentIndex - 1);
      } else if (!inTextarea && e.key === "ArrowRight") {
        e.preventDefault();
        if (currentIndex < images.length - 1) onNavigate(currentIndex + 1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, onNavigate, currentIndex, images.length]);

  const handleSaveCaption = async () => {
    setSavingCaption(true);
    setCaptionSaved(false);
    try {
      const res = await fetch(
        `/api/stories/characters/${storyCharId}/dataset-images/${image.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caption: editedCaption }),
        }
      );
      if (res.ok) {
        onImageUpdate(image.id, { caption: editedCaption });
        setCaptionSaved(true);
        setTimeout(() => setCaptionSaved(false), 2000);
      }
    } catch {
      // ignore
    }
    setSavingCaption(false);
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    setRegenError(null);
    try {
      const body: Record<string, string> = {};
      // Only send custom prompt if it was edited and source supports it
      if (image.source !== "sdxl-img2img" && editedPrompt && editedPrompt !== image.resolvedPrompt) {
        body.customPrompt = editedPrompt;
      }

      const res = await fetch(
        `/api/stories/characters/${storyCharId}/dataset-images/${image.id}/regenerate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRegenError(data.error || "Regeneration failed");
        setRegenerating(false);
        return;
      }

      const data = await res.json();
      onImageRegenerated(image.id, data.image);
    } catch {
      setRegenError("Network error");
    }
    setRegenerating(false);
  };

  const handleApproveImage = async () => {
    setApprovingImage(true);
    try {
      const res = await fetch(
        `/api/stories/characters/${storyCharId}/dataset-images/${image.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ human_approved: true, eval_status: "passed" }),
        }
      );
      if (res.ok) {
        onImageUpdate(image.id, { human_approved: true, eval_status: "passed" });
      }
    } catch {
      // ignore
    }
    setApprovingImage(false);
  };

  const handleDeleteImage = async () => {
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/stories/characters/${storyCharId}/dataset-images/${image.id}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        onImageDeleted(image.id);
        onClose();
      }
    } catch {
      // ignore
    }
    setDeleting(false);
    setDeleteConfirm(false);
  };

  const status = approvalStatus(image);
  const isApproved = image.human_approved === true;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < images.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        className="absolute right-4 top-4 z-10 rounded-full bg-zinc-800 p-2 text-zinc-300 hover:bg-zinc-700"
        onClick={onClose}
      >
        <X className="h-5 w-5" />
      </button>

      {/* Nav counter */}
      <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full bg-zinc-800/80 px-3 py-1 text-xs text-zinc-400">
        {currentIndex + 1} / {images.length}
      </div>

      {/* Left panel: Image + navigation */}
      <div
        className="relative flex flex-1 items-center justify-center p-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Prev button */}
        {hasPrev && (
          <button
            onClick={() => onNavigate(currentIndex - 1)}
            className="absolute left-3 rounded-full bg-zinc-800/80 p-2 text-zinc-300 hover:bg-zinc-700"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}

        <img
          src={image.image_url}
          alt={`Dataset ${image.category}`}
          className="max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl"
        />

        {/* Next button */}
        {hasNext && (
          <button
            onClick={() => onNavigate(currentIndex + 1)}
            className="absolute right-[420px] rounded-full bg-zinc-800/80 p-2 text-zinc-300 hover:bg-zinc-700"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Right panel: Details sidebar */}
      <div
        className="flex w-[400px] flex-col gap-4 overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Metadata badges */}
        <div className="flex flex-wrap gap-1.5">
          {image.source && (
            <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${sourceBadgeColor(image.source)}`}>
              {fmtTag(image.source)}
            </span>
          )}
          <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
            {fmtTag(image.category)}
          </span>
          <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500">
            {fmtTag(image.variation_type)}
          </span>
          {/* Human approval status */}
          <span
            className={`rounded px-2 py-0.5 text-[10px] font-medium ${
              image.human_approved === true
                ? "bg-emerald-900/50 text-emerald-300"
                : image.human_approved === false
                ? "bg-red-900/50 text-red-300"
                : "bg-zinc-800 text-zinc-500"
            }`}
          >
            {image.human_approved === true
              ? "Human Approved"
              : image.human_approved === false
              ? "Human Rejected"
              : "Pending Review"}
          </span>
        </div>

        {/* AI Score (prominent) */}
        {image.eval_score != null && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">
              AI Score:{" "}
            </span>
            <span className={`text-lg font-bold ${evalScoreColor(image.eval_score)}`}>
              {image.eval_score}/10
            </span>
          </div>
        )}

        {/* Template ID */}
        {image.prompt_template && (
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-600">
              Template ID
            </label>
            <code className="block rounded bg-zinc-900 px-2 py-1 text-[11px] text-zinc-500 break-all">
              {image.prompt_template}
            </code>
          </div>
        )}

        {/* Generation Prompt */}
        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-600">
            Generation Prompt
          </label>
          {image.source === "sdxl-img2img" && !image.resolvedPrompt ? (
            <p className="rounded bg-zinc-900 px-2 py-2 text-xs italic text-zinc-600">
              Dynamically generated with random pose — prompt not stored
            </p>
          ) : (
            <textarea
              value={editedPrompt}
              onChange={(e) => setEditedPrompt(e.target.value)}
              rows={4}
              className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-300 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
              placeholder="No prompt available"
            />
          )}
        </div>

        {/* Caption */}
        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-600">
            Training Caption
          </label>
          <textarea
            value={editedCaption}
            onChange={(e) => setEditedCaption(e.target.value)}
            rows={3}
            className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-300 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
            placeholder="No caption yet"
          />
          <button
            onClick={handleSaveCaption}
            disabled={savingCaption || editedCaption === (image.caption || "")}
            className="mt-1.5 inline-flex items-center gap-1.5 rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
          >
            {captionSaved ? (
              <>
                <Check className="h-3 w-3 text-emerald-400" />
                <span className="text-emerald-400">Saved</span>
              </>
            ) : savingCaption ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-3 w-3" />
                Save Caption
              </>
            )}
          </button>
        </div>

        {/* Eval details */}
        {image.eval_details && (
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-600">
              Eval Breakdown
            </label>
            <div className="flex gap-3 text-xs">
              <span className={scoreColor(image.eval_details.face_score)}>
                Face {image.eval_details.face_score}
              </span>
              <span className={scoreColor(image.eval_details.body_score)}>
                Body {image.eval_details.body_score}
              </span>
              <span className={scoreColor(image.eval_details.quality_score)}>
                Quality {image.eval_details.quality_score}
              </span>
            </div>
            {image.eval_details.verdict && (
              <p className="mt-1 text-[10px] leading-snug text-zinc-400">
                Verdict: {image.eval_details.verdict}
              </p>
            )}
            {image.eval_details.issues.length > 0 && (
              <p className="mt-1 text-[10px] leading-snug text-red-400/70">
                {image.eval_details.issues.join(", ")}
              </p>
            )}
          </div>
        )}

        {/* Action buttons: Approve → Regenerate → Delete */}
        <div className="space-y-2">
          {/* Approve */}
          <button
            onClick={handleApproveImage}
            disabled={isApproved || approvingImage}
            className={`inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              isApproved
                ? "border border-emerald-600/50 bg-emerald-950/40 text-emerald-300"
                : "border border-emerald-500/30 bg-emerald-950/20 text-emerald-300 hover:bg-emerald-900/30 disabled:opacity-50"
            }`}
          >
            {approvingImage ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Approving...
              </>
            ) : isApproved ? (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Approved
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Approve Image
              </>
            )}
          </button>

          {/* Regenerate */}
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-blue-500/30 bg-blue-950/30 px-4 py-2 text-sm font-medium text-blue-300 hover:bg-blue-900/30 disabled:opacity-50"
          >
            {regenerating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Regenerating...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                Regenerate Image
              </>
            )}
          </button>
          {regenError && (
            <p className="mt-1 text-xs text-red-400">{regenError}</p>
          )}

          {/* Delete */}
          {deleteConfirm ? (
            <div className="rounded-lg border border-red-800/50 bg-red-950/30 p-3">
              <p className="mb-2 text-xs text-red-300">Delete this training image?</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setDeleteConfirm(false)}
                  className="flex-1 rounded px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteImage}
                  disabled={deleting}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded bg-red-800 px-3 py-1.5 text-xs font-medium text-red-100 hover:bg-red-700 disabled:opacity-50"
                >
                  {deleting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setDeleteConfirm(true)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-800/30 bg-red-950/20 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-900/20"
            >
              <Trash2 className="h-4 w-4" />
              Delete Image
            </button>
          )}
        </div>
      </div>
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
  readOnly,
}: {
  img: DatasetImage;
  focused: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onZoom: (img: DatasetImage) => void;
  readOnly?: boolean;
}) {
  const isFailed = img.eval_status === "failed";
  const isPassed = img.eval_status === "passed";
  const isHumanApproved = img.human_approved === true;
  const isHumanRejected = img.human_approved === false;

  const borderClass = isHumanApproved
    ? "border-emerald-600"
    : isHumanRejected || isFailed
    ? "border-red-700"
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
          className={`h-full w-full object-cover${(isFailed || isHumanRejected) && !isHumanApproved ? " opacity-60" : ""}`}
        />
        <div
          className="absolute inset-0 cursor-zoom-in"
          onClick={() => onZoom(img)}
        />
        <button
          onClick={() => onZoom(img)}
          className="absolute right-1.5 top-1.5 rounded bg-black/60 p-1 text-zinc-300 hover:bg-black/80"
          title="Enlarge"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>

        {/* Eval status badge — human approval takes priority */}
        {isHumanApproved ? (
          <span className="absolute left-1.5 top-1.5 flex items-center gap-0.5 rounded bg-emerald-700/80 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-100">
            <CheckCircle2 className="h-3 w-3" />
          </span>
        ) : isHumanRejected ? (
          <span className="absolute left-1.5 top-1.5 flex items-center rounded bg-red-800/80 px-1.5 py-0.5 text-[9px] font-semibold text-red-200">
            <XCircle className="h-3 w-3" />
          </span>
        ) : isPassed ? (
          <span className="absolute left-1.5 top-1.5 rounded bg-orange-700/80 px-1.5 py-0.5 text-[9px] font-semibold text-orange-100">
            AI ✓
          </span>
        ) : isFailed ? (
          <span className="absolute left-1.5 top-1.5 flex items-center rounded bg-red-800/80 px-1.5 py-0.5 text-[9px] font-semibold text-red-200">
            <XCircle className="h-3 w-3" />
          </span>
        ) : (
          <span className="absolute left-1.5 top-1.5 rounded bg-zinc-700/80 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-400">
            ?
          </span>
        )}

        {/* Eval score pill */}
        {img.eval_score != null && (
          <span
            className={`absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold ${evalScoreColor(img.eval_score)}`}
          >
            {img.eval_score}/10
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
      {!readOnly && (
        <div className="mt-auto flex gap-1 p-1.5">
          <button
            onClick={() => onApprove(img.id)}
            className={`flex flex-1 items-center justify-center gap-1 rounded py-1.5 text-xs font-medium transition-colors ${
              isHumanApproved
                ? "bg-emerald-700 text-emerald-100"
                : "bg-zinc-800 text-zinc-400 hover:bg-emerald-900/50 hover:text-emerald-300"
            }`}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onReject(img.id)}
            className={`flex flex-1 items-center justify-center gap-1 rounded py-1.5 text-xs font-medium transition-colors ${
              isHumanRejected
                ? "bg-red-800 text-red-200"
                : "bg-zinc-800 text-zinc-400 hover:bg-red-900/50 hover:text-red-300"
            }`}
          >
            <XCircle className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
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
  const [loraStatus, setLoraStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [zoomImage, setZoomImage] = useState<DatasetImage | null>(null);
  const [zoomIndex, setZoomIndex] = useState(0);
  const [approveAllConfirm, setApproveAllConfirm] = useState(false);
  const [deleteRejectedConfirm, setDeleteRejectedConfirm] = useState(false);
  const [deletingRejected, setDeletingRejected] = useState(false);
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
    setLoraStatus(data.loraStatus ?? null);
    setLoading(false);
  }, [storyCharId]);

  useEffect(() => {
    loadImages();
  }, [loadImages]);

  // ── Derived ─────────────────────────────────────────────────

  const isApprovalMode = loraStatus === "awaiting_dataset_approval";
  const readOnly = loraStatus === "deployed" || loraStatus === "archived";
  const humanApproved = images.filter((i) => i.human_approved === true).length;
  const humanRejected = images.filter((i) => i.human_approved === false).length;
  const humanPending = images.filter((i) => i.human_approved === null).length;
  const aiPassed = images.filter((i) => i.eval_status === "passed").length;
  const minRequired = stats?.minRequired ?? 20;
  const canResume = isApprovalMode && humanApproved >= minRequired;
  const canRetry = loraStatus === "failed" && humanApproved >= minRequired;

  // ── Filtered images ─────────────────────────────────────────

  const rejected = images.filter(
    (i) => i.eval_status === "failed" && i.human_approved !== true
  );
  const needsReview = images.filter(
    (i) => i.eval_status === "passed" && i.human_approved !== true
  );

  const filteredImages = images.filter((img) => {
    if (filter === "approved") return img.human_approved === true;
    if (filter === "rejected")
      return img.eval_status === "failed" && img.human_approved !== true;
    if (filter === "needs_review")
      return img.eval_status === "passed" && img.human_approved !== true;
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
      setZoomImage((prev) =>
        prev && imageIds.includes(prev.id)
          ? { ...prev, human_approved: approved }
          : prev
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

  // ── Image update callbacks ────────────────────────────────

  const handleImageUpdate = useCallback((id: string, updates: Partial<DatasetImage>) => {
    setImages((prev) => prev.map((img) => (img.id === id ? { ...img, ...updates } : img)));
    setZoomImage((prev) => (prev && prev.id === id ? { ...prev, ...updates } : prev));
  }, []);

  const handleImageRegenerated = useCallback((oldId: string, newImage: DatasetImage) => {
    setImages((prev) => {
      // Remove the old image (it was marked as 'replaced' server-side) and add the new one
      const without = prev.filter((img) => img.id !== oldId);
      return [...without, newImage];
    });
    // Update zoom to show the new image
    setZoomImage(newImage);
  }, []);

  const handleImageDeleted = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  // ── Zoom handlers ─────────────────────────────────────────

  const handleZoom = useCallback(
    (img: DatasetImage) => {
      const idx = filteredImages.findIndex((i) => i.id === img.id);
      setZoomImage(img);
      setZoomIndex(idx >= 0 ? idx : 0);
    },
    [filteredImages]
  );

  const handleLightboxNavigate = useCallback(
    (index: number) => {
      const img = filteredImages[index];
      if (img) {
        setZoomImage(img);
        setZoomIndex(index);
      }
    },
    [filteredImages]
  );

  // ── Approve all pending ─────────────────────────────────────

  const handleApproveAllAIPassed = useCallback(async () => {
    setApproveAllConfirm(false);
    const aiPassedIds = images
      .filter((i) => i.eval_status === "passed" && i.human_approved !== true)
      .map((i) => i.id);
    if (aiPassedIds.length > 0) {
      await updateApproval(aiPassedIds, true);
    }
  }, [images, updateApproval]);

  // ── Delete all rejected ───────────────────────────────────────

  const handleDeleteAllRejected = useCallback(async () => {
    setDeleteRejectedConfirm(false);
    setDeletingRejected(true);
    const rejectedIds = images
      .filter((i) => i.eval_status === "failed" && i.human_approved !== true)
      .map((i) => i.id);

    if (rejectedIds.length === 0) {
      setDeletingRejected(false);
      return;
    }

    try {
      const res = await fetch(
        `/api/stories/characters/${storyCharId}/dataset-images`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageIds: rejectedIds }),
        }
      );

      if (res.ok) {
        setImages((prev) => prev.filter((img) => !rejectedIds.includes(img.id)));
      }
    } catch {
      // ignore — images remain in grid
    }
    setDeletingRejected(false);
  }, [images, storyCharId]);

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

  // ── Retry training (for failed LoRAs) ───────────────────────

  const handleRetryTraining = useCallback(async () => {
    setResuming(true);
    setResumeError(null);

    try {
      const res = await fetch(
        `/api/stories/characters/${storyCharId}/train-lora`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const data = await res.json();

      if (!res.ok) {
        setResumeError(data.error || "Failed to start training");
        setResuming(false);
        return;
      }

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
    if (zoomImage || approveAllConfirm || deleteRejectedConfirm) return;

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
  }, [filteredImages, zoomImage, approveAllConfirm, deleteRejectedConfirm, handleApprove, handleReject]);

  useEffect(() => {
    setFocusedIndex(0);
  }, [filter]);

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────

  const TABS: { key: FilterTab; label: string; count: number }[] = [
    { key: "all", label: "All", count: images.length },
    { key: "approved", label: "Approved", count: humanApproved },
    { key: "rejected", label: "Rejected", count: rejected.length },
    { key: "needs_review", label: "Needs Review", count: needsReview.length },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* Lightbox */}
      {zoomImage && (
        <ImageLightbox
          image={zoomImage}
          images={filteredImages}
          currentIndex={zoomIndex}
          storyCharId={storyCharId}
          onClose={() => setZoomImage(null)}
          onNavigate={handleLightboxNavigate}
          onApprove={handleApprove}
          onReject={handleReject}
          onImageUpdate={handleImageUpdate}
          onImageRegenerated={handleImageRegenerated}
          onImageDeleted={handleImageDeleted}
          readOnly={readOnly}
        />
      )}

      {approveAllConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
            <h3 className="mb-2 text-base font-semibold text-zinc-100">
              Approve all AI-passed images?
            </h3>
            <p className="mb-5 text-sm text-zinc-400">
              This will approve all {needsReview.length} images that passed AI evaluation.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setApproveAllConfirm(false)}
                className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                onClick={handleApproveAllAIPassed}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-600"
              >
                Approve All {needsReview.length}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteRejectedConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
            <h3 className="mb-2 text-base font-semibold text-zinc-100">
              Delete all rejected images?
            </h3>
            <p className="mb-5 text-sm text-zinc-400">
              This will permanently delete {rejected.length} images that failed AI evaluation.
              This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteRejectedConfirm(false)}
                className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAllRejected}
                disabled={deletingRejected}
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-red-100 hover:bg-red-600 disabled:opacity-50"
              >
                {deletingRejected ? "Deleting..." : `Delete ${rejected.length} Images`}
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
            {isApprovalMode ? "Review Dataset Images" : "Dataset Images"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isApprovalMode
              ? `Review AI-generated training images before LoRA training begins. Need ${minRequired} approved to proceed.`
              : `Viewing ${images.length} dataset images generated for this character's LoRA training.`}
          </p>
          {!isApprovalMode && loraStatus && (
            <p className="mt-1 text-xs text-zinc-500">
              LoRA status: <span className={String(loraStatus) === "failed" ? "text-red-400" : "text-zinc-400"}>{loraStatus}</span>
            </p>
          )}
        </div>
        {isApprovalMode && (
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
        )}
        {canRetry && (
          <button
            onClick={handleRetryTraining}
            disabled={resuming}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-5 py-2.5 text-sm font-medium text-amber-100 transition-colors hover:bg-amber-600 disabled:opacity-50"
          >
            {resuming ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                Retry Training ({humanApproved} images)
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        )}
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
          { label: "AI Passed", value: aiPassed, color: "text-blue-400" },
          { label: "Approved", value: humanApproved, color: "text-emerald-400" },
          { label: "Rejected", value: rejected.length, color: "text-red-400" },
          { label: "Needs Review", value: needsReview.length, color: "text-orange-400" },
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
          {!readOnly && (
            <>
              <button
                onClick={() => setApproveAllConfirm(true)}
                disabled={needsReview.length === 0}
                className="rounded-lg border border-emerald-800/50 bg-emerald-950/30 px-3 py-1.5 text-xs text-emerald-400 hover:bg-emerald-900/30 hover:text-emerald-300 disabled:opacity-40"
              >
                Approve All AI-Passed ({needsReview.length})
              </button>
              <button
                onClick={() => setDeleteRejectedConfirm(true)}
                disabled={rejected.length === 0}
                className="rounded-lg border border-red-800/50 bg-red-950/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/30 hover:text-red-300 disabled:opacity-40"
              >
                Delete Rejected ({rejected.length})
              </button>
            </>
          )}
          <button
            onClick={loadImages}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Keyboard shortcut hint */}
      {!readOnly && (
        <p className="mb-4 text-[11px] text-zinc-600">
          Keyboard: <span className="font-mono">→</span> Approve &nbsp;·&nbsp;{" "}
          <span className="font-mono">←</span> Reject &nbsp;·&nbsp;{" "}
          <span className="font-mono">↑↓</span> Navigate
        </p>
      )}

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
              onZoom={handleZoom}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}

      {/* Resume footer */}
      {isApprovalMode && canResume && (
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
