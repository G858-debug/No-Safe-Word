"use client";

import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PORTRAIT_COMPOSITION } from "@no-safe-word/image-gen";

// ─────────────────────────────────────────────────────────────────────────
// Two parallel state machines — one per panel.
// Exported so CharacterCard can build instances of them without
// duplicating the union shape.
// ─────────────────────────────────────────────────────────────────────────

export type FaceState =
  | { kind: "empty"; prompt: string }
  | {
      kind: "generating";
      prompt: string;
      jobId: string;
      imageId: string;
    }
  | {
      kind: "generated";
      prompt: string;
      imageId: string;
      url: string;
    }
  | {
      kind: "approved";
      prompt: string;
      imageId: string;
      url: string;
    };

export type BodyState =
  | { kind: "locked" }
  | { kind: "empty"; prompt: string }
  | {
      kind: "generating";
      prompt: string;
      jobId: string;
      imageId: string;
    }
  | {
      kind: "generated";
      prompt: string;
      imageId: string;
      url: string;
      createdAt: string;
    }
  | {
      kind: "generated_stale";
      prompt: string;
      imageId: string;
      url: string;
      createdAt: string;
    }
  | {
      kind: "approved";
      prompt: string;
      imageId: string;
      url: string;
      createdAt: string;
    };

export type PanelState = FaceState | BodyState;

interface PortraitPanelProps {
  kind: "face" | "body";
  state: PanelState;
  /**
   * True while ANY client→server call is in flight OR a generation job
   * is being polled in either panel. Disables every action button to
   * prevent races during the two-call regenerate-face cascade.
   */
  isBusy: boolean;
  /** Sub-label (e.g. "Step 1 of 2 — Face portrait" / model name). */
  stepLabel: string;
  /** Optional badge content — used to show which model produces this image. */
  modelBadge?: string;
  /** Optional helper text under the prompt area. */
  helperText?: string;
  onPromptChange: (next: string) => void;
  onGenerate: () => void;
  onApprove: () => void;
  onRevoke: () => void;
  onImageClick?: (url: string) => void;
}

const FULL_THUMB =
  "w-32 h-44 object-cover rounded-md border cursor-zoom-in";
const STALE_THUMB =
  "w-32 h-44 object-cover rounded-md border cursor-zoom-in opacity-70 ring-2 ring-amber-500/60";
const SLOT_PLACEHOLDER =
  "w-32 h-44 rounded-md border border-dashed flex items-center justify-center text-xs text-muted-foreground";

export function PortraitPanel({
  kind,
  state,
  isBusy,
  stepLabel,
  modelBadge,
  helperText,
  onPromptChange,
  onGenerate,
  onApprove,
  onRevoke,
  onImageClick,
}: PortraitPanelProps) {
  const promptValue = "prompt" in state ? state.prompt : "";
  const promptEditable =
    state.kind !== "locked" &&
    state.kind !== "generating" &&
    state.kind !== "approved";
  const bodyHasPortraitFraming =
    kind === "body" && promptValue.includes(PORTRAIT_COMPOSITION);

  // ── Locked (body only) ─────────────────────────────────────────────
  if (state.kind === "locked") {
    return (
      <div className="rounded-md border border-dashed p-4 space-y-3 bg-muted/40">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-muted-foreground" aria-hidden />
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            {stepLabel}
          </p>
          {modelBadge && (
            <Badge variant="secondary" className="text-[10px]">
              {modelBadge}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Approve the face portrait to unlock body generation.
        </p>
      </div>
    );
  }

  // ── Image area for non-locked states ──────────────────────────────
  let imageArea: React.ReactNode = null;
  if (state.kind === "generating") {
    imageArea = (
      <div className={SLOT_PLACEHOLDER}>
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  } else if (
    state.kind === "generated" ||
    state.kind === "generated_stale" ||
    state.kind === "approved"
  ) {
    const url = state.url;
    const stale = state.kind === "generated_stale";
    imageArea = (
      <img
        src={url}
        alt={kind === "face" ? "Face portrait" : "Body portrait"}
        className={stale ? STALE_THUMB : FULL_THUMB}
        onClick={() => onImageClick?.(url)}
      />
    );
  } else {
    imageArea = (
      <div className={SLOT_PLACEHOLDER}>
        <span>No image yet</span>
      </div>
    );
  }

  // ── Buttons per state ──────────────────────────────────────────────
  let buttons: React.ReactNode = null;
  switch (state.kind) {
    case "empty":
      buttons = (
        <Button
          size="sm"
          onClick={onGenerate}
          disabled={isBusy || promptValue.trim().length === 0}
        >
          {kind === "face" ? "Generate face" : "Generate body"}
        </Button>
      );
      break;
    case "generating":
      buttons = (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Generating…</span>
        </div>
      );
      break;
    case "generated":
      buttons = (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onApprove} disabled={isBusy}>
            {kind === "face" ? "Approve face" : "Approve body"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onGenerate}
            disabled={isBusy || promptValue.trim().length === 0}
          >
            Regenerate
          </Button>
        </div>
      );
      break;
    case "generated_stale":
      buttons = (
        <div className="flex flex-wrap gap-2">
          {/* Approve disabled until the user regenerates. */}
          <Button size="sm" disabled>
            Approve body
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onGenerate}
            disabled={isBusy || promptValue.trim().length === 0}
          >
            Regenerate body
          </Button>
        </div>
      );
      break;
    case "approved":
      buttons = (
        <Button
          size="sm"
          variant="outline"
          onClick={onRevoke}
          disabled={isBusy}
        >
          Revoke approval
        </Button>
      );
      break;
  }

  return (
    <div
      className={
        state.kind === "approved"
          ? "rounded-md border border-emerald-300/60 bg-emerald-50/30 p-4 space-y-3 dark:bg-emerald-950/10 dark:border-emerald-900/60"
          : "rounded-md border p-4 space-y-3"
      }
    >
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          {stepLabel}
        </p>
        {modelBadge && (
          <Badge variant="secondary" className="text-[10px]">
            {modelBadge}
          </Badge>
        )}
        {state.kind === "approved" && (
          <Badge variant="default" className="text-[10px]">
            ✓ Approved
          </Badge>
        )}
        {state.kind === "generated_stale" && (
          <Badge variant="destructive" className="text-[10px]">
            Stale
          </Badge>
        )}
      </div>

      <div className="flex gap-4">
        <div className="flex-shrink-0">{imageArea}</div>

        <div className="flex-1 space-y-2 min-w-0">
          <p className="text-xs font-medium text-muted-foreground">
            {kind === "face" ? "Face prompt" : "Body prompt"}
          </p>
          <Textarea
            value={promptValue}
            onChange={(e) => onPromptChange(e.target.value)}
            rows={5}
            className="text-xs font-mono"
            placeholder={
              kind === "face"
                ? "Face prompt — sent verbatim to /generate"
                : "Body prompt — sent to /generate-body"
            }
            disabled={!promptEditable || isBusy}
          />
          {bodyHasPortraitFraming && (
            <p className="text-[11px] text-amber-700 dark:text-amber-300">
              Contains portrait framing — will be auto-swapped to full-body framing on submit.
            </p>
          )}
          {helperText && (
            <p className="text-[11px] text-muted-foreground">{helperText}</p>
          )}
        </div>
      </div>

      {state.kind === "generated_stale" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-900/60">
          Face has changed — regenerate the body to match.
        </div>
      )}

      <div>{buttons}</div>
    </div>
  );
}
