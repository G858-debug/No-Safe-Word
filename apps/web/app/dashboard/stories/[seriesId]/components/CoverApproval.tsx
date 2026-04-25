"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { CoverStatus } from "@no-safe-word/shared";

// Shape of the cover-relevant fields returned by GET /api/stories/[seriesId].
// The endpoint uses select("*") on story_series, so these flow through.
interface CoverState {
  cover_prompt: string | null;
  cover_status: CoverStatus;
  cover_variants: (string | null)[] | null;
  cover_selected_variant: number | null;
  cover_base_url: string | null;
  cover_sizes: {
    hero?: string;
    card?: string;
    og?: string;
    email?: string;
  } | null;
  cover_error: string | null;
}

// Matches Phase 2's generate-cover endpoint response (202 Accepted).
interface GenerateCoverResponse {
  jobIds?: string[];
  coverStatus?: CoverStatus;
  variantIndices?: number[];
  error?: string;
}

const VARIANT_COUNT = 4;

// Same template stored in the generate-cover route — re-declared here as the
// textarea placeholder. If you change one, change the other.
const COVER_PROMPT_PLACEHOLDER =
  "Two-character intimate composition. [Protagonist: reference image conditions appearance; describe her clothing, pose, and emotional register]. [Love interest: full physical description from his prose_description, plus his clothing, pose, and expression]. [Intimate physical contact: how their bodies relate in space]. [Lighting source — named specifically]. [Setting: specific South African location detail]. [Brand colour motif woven naturally — crimson, burgundy, amber, or gold]. Subjects composed in the upper two-thirds of the frame with compositional breathing room in the lower third. Cinematic shallow depth of field. Rich shadows with luminous highlights. Soft skin glow. Intimate framing. Editorial photography quality. Photorealistic.";

interface Props {
  seriesId: string;
}

export default function CoverApproval({ seriesId }: Props) {
  const [state, setState] = useState<CoverState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [promptDraft, setPromptDraft] = useState<string>("");
  const [promptDirty, setPromptDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<number | null>(null);
  const [regeneratingPrompt, setRegeneratingPrompt] = useState(false);
  const [promptRegenJustSucceeded, setPromptRegenJustSucceeded] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCover = useCallback(async () => {
    try {
      const res = await fetch(`/api/stories/${seriesId}`);
      if (!res.ok) {
        setError("Failed to load cover state");
        return;
      }
      const data = await res.json();
      const s = data.series as CoverState;
      setState(s);
      if (!promptDirty) {
        setPromptDraft(s.cover_prompt ?? "");
      }
    } catch {
      setError("Failed to load cover state");
    } finally {
      setLoading(false);
    }
  }, [seriesId, promptDirty]);

  useEffect(() => {
    fetchCover();
  }, [fetchCover]);

  // Poll every 3s while generating OR compositing. Matches CharacterCard's
  // polling cadence. The compositing state is driven by the fire-and-forget
  // trigger in approve-cover, so the UI observes the transition without
  // the user initiating another request.
  useEffect(() => {
    if (!state) return;
    const shouldPoll =
      state.cover_status === "generating" || state.cover_status === "compositing";
    if (!shouldPoll) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    pollRef.current = setInterval(fetchCover, 3000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [state, fetchCover]);

  // Also poll each outstanding job directly so the status endpoint drives
  // webhook-style writes. /api/status/[jobId] is pull-driven — nothing
  // advances generation_jobs.status until someone GETs it.
  // Per-slot timestamps used to bust the browser image cache when a variant
  // is regenerated (the storage path never changes, so without this the
  // browser serves the old image after an overwrite).
  const [variantTs, setVariantTs] = useState<number[]>(() => Array(VARIANT_COUNT).fill(Date.now()));

  const [outstandingJobs, setOutstandingJobs] = useState<string[]>([]);
  useEffect(() => {
    if (outstandingJobs.length === 0) return;
    const interval = setInterval(async () => {
      const remaining: string[] = [];
      for (const jobId of outstandingJobs) {
        try {
          const res = await fetch(`/api/status/${jobId}`);
          const data = await res.json();
          if (!data.completed && !data.error) {
            remaining.push(jobId);
          }
        } catch {
          remaining.push(jobId);
        }
      }
      setOutstandingJobs(remaining);
      // fetchCover reads the updated story_series row after the status
      // endpoint has written to it.
      fetchCover();
    }, 3000);
    return () => clearInterval(interval);
  }, [outstandingJobs, fetchCover]);

  const variants: (string | null)[] = useMemo(() => {
    const base = state?.cover_variants ?? [];
    return Array.from({ length: VARIANT_COUNT }, (_, i) => base[i] ?? null);
  }, [state]);

  const completedCount = variants.filter((v) => v !== null).length;
  const failedIndices = useMemo(() => {
    if (!state || state.cover_status !== "variants_ready") return [];
    return variants
      .map((v, i) => (v === null ? i : -1))
      .filter((i) => i >= 0);
  }, [state, variants]);

  async function generate(body: { prompt?: string; retryVariants?: number[] }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/stories/${seriesId}/generate-cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as GenerateCoverResponse;
      if (!res.ok) {
        setError(data.error || "Generation failed");
        return;
      }
      setOutstandingJobs(data.jobIds ?? []);
      setPromptDirty(false);
      // Bust cache for the regenerated slots so the browser loads the new image
      const regeneratedIndices: number[] = body.retryVariants ?? Array.from({ length: VARIANT_COUNT }, (_, i) => i);
      const now = Date.now();
      setVariantTs((prev) => prev.map((ts, i) => regeneratedIndices.includes(i) ? now : ts));
      await fetchCover();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerate() {
    if (state?.cover_status === "approved" || state?.cover_status === "complete") {
      const ok = window.confirm(
        "Regenerating will reset the approved cover and discard all composited website/OG/email versions. You'll need to re-approve a new variant and wait for compositing to re-run. Continue?"
      );
      if (!ok) return;
    }
    await generate(promptDirty ? { prompt: promptDraft } : {});
  }

  async function handleRetryCompositing() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/stories/${seriesId}/composite-cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      // composite-cover runs synchronously; on success it returns 200,
      // on failure it reverts to 'approved' with cover_error populated.
      // Either way, fetchCover() pulls the resolved state.
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Compositing failed");
      }
      await fetchCover();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Compositing failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleRetryMissing() {
    if (failedIndices.length === 0) return;
    await generate({ retryVariants: failedIndices });
  }

  async function handleRetrySingle(index: number) {
    await generate({ retryVariants: [index] });
  }

  async function handleRegeneratePrompt() {
    setRegeneratingPrompt(true);
    setError(null);
    setPromptRegenJustSucceeded(false);
    try {
      const res = await fetch(`/api/stories/${seriesId}/regenerate-cover-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Cover prompt regeneration failed");
        return;
      }
      // Replace textarea content with the new prompt. The endpoint has
      // already persisted it, so clear the dirty flag.
      setPromptDraft(data.coverPrompt ?? "");
      setPromptDirty(false);
      setPromptRegenJustSucceeded(true);
      await fetchCover();
      // Fade the success indicator after a few seconds.
      setTimeout(() => setPromptRegenJustSucceeded(false), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cover prompt regeneration failed");
    } finally {
      setRegeneratingPrompt(false);
    }
  }

  async function handleApprove() {
    if (pendingSelection === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/stories/${seriesId}/approve-cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedVariant: pendingSelection }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Approval failed");
        return;
      }
      setPendingSelection(null);
      await fetchCover();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !state) {
    return (
      <Card>
        <CardHeader><Skeleton className="h-6 w-48" /></CardHeader>
        <CardContent><Skeleton className="h-64 w-full" /></CardContent>
      </Card>
    );
  }

  const isGenerating = state.cover_status === "generating";
  const isCompositing = state.cover_status === "compositing";
  const canEditPrompt = !isGenerating && !isCompositing;
  const statusBadge = renderStatusBadge(state.cover_status, completedCount);
  const selectedIdx = pendingSelection ?? state.cover_selected_variant;
  const heroUrl = state.cover_sizes?.hero ?? null;
  // Compositing failure surfaces as status='approved' with a non-null
  // cover_error — we show a retry button in that case.
  const compositingFailed =
    state.cover_status === "approved" && !!state.cover_error;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">Cover Image</CardTitle>
            {statusBadge}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}
          {state.cover_error && !error && (
            <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3 flex items-start justify-between gap-3">
              <p className="text-sm text-red-400">
                {compositingFailed
                  ? `Compositing failed: ${state.cover_error}`
                  : state.cover_error}
              </p>
              {compositingFailed && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRetryCompositing}
                  disabled={busy}
                >
                  Retry compositing
                </Button>
              )}
            </div>
          )}

          {state.cover_status === "complete" && heroUrl && (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Composited hero preview
              </p>
              <img
                src={heroUrl}
                alt="Composited hero cover"
                className="mx-auto max-h-[480px] rounded-md border border-border"
              />
            </div>
          )}

          <div>
            <div className="mb-1 flex items-center justify-between gap-3">
              <label className="text-sm font-medium text-muted-foreground">
                Cover prompt
              </label>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRegeneratePrompt}
                disabled={
                  regeneratingPrompt ||
                  busy ||
                  isGenerating ||
                  isCompositing
                }
              >
                {regeneratingPrompt
                  ? "Regenerating with Claude..."
                  : "Regenerate prompt with Claude"}
              </Button>
            </div>
            <Textarea
              value={promptDraft}
              placeholder={COVER_PROMPT_PLACEHOLDER}
              disabled={!canEditPrompt || busy || regeneratingPrompt}
              onChange={(e) => {
                setPromptDraft(e.target.value);
                setPromptDirty(e.target.value !== (state.cover_prompt ?? ""));
              }}
              className="min-h-[160px] text-sm"
            />
            {promptDirty && (
              <p className="mt-1 text-xs text-muted-foreground">
                Prompt edited — will be saved on next generation.
              </p>
            )}
            {promptRegenJustSucceeded && !promptDirty && (
              <p className="mt-1 text-xs text-green-400">
                New prompt generated. Review it, then click &ldquo;Generate 4
                Variants&rdquo; to spend RunPod time.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {variants.map((url, i) => (
              <VariantSlot
                key={i}
                index={i}
                url={url}
                ts={variantTs[i]}
                isGenerating={isGenerating}
                isSelected={selectedIdx === i}
                canSelect={
                  state.cover_status === "variants_ready" ||
                  state.cover_status === "approved" ||
                  state.cover_status === "complete"
                }
                onSelect={() => setPendingSelection(i)}
                onRegenerate={() => handleRetrySingle(i)}
                canRegenerate={
                  !busy &&
                  !isGenerating &&
                  (state.cover_status === "variants_ready" ||
                    state.cover_status === "approved" ||
                    state.cover_status === "complete")
                }
                onRetry={() => handleRetrySingle(i)}
                retryDisabled={busy || isGenerating}
                showFailed={
                  state.cover_status === "variants_ready" && url === null
                }
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={handleGenerate}
              disabled={busy || isGenerating || (!promptDraft && !state.cover_prompt)}
            >
              {primaryButtonLabel(state.cover_status, completedCount, promptDirty)}
            </Button>

            {failedIndices.length > 0 && state.cover_status === "variants_ready" && (
              <Button
                variant="outline"
                onClick={handleRetryMissing}
                disabled={busy || isGenerating}
              >
                Retry missing variants ({failedIndices.length})
              </Button>
            )}

            {state.cover_status === "variants_ready" && pendingSelection !== null && (
              <Button onClick={handleApprove} disabled={busy}>
                Approve variant {pendingSelection + 1}
              </Button>
            )}

            {state.cover_status === "approved" &&
              pendingSelection !== null &&
              pendingSelection !== state.cover_selected_variant && (
                <Button onClick={handleApprove} disabled={busy}>
                  Switch to variant {pendingSelection + 1}
                </Button>
              )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function renderStatusBadge(status: CoverStatus, completedCount: number) {
  switch (status) {
    case "pending":
      return <Badge variant="outline">Pending</Badge>;
    case "generating":
      return (
        <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30">
          Generating {completedCount}/{VARIANT_COUNT}
        </Badge>
      );
    case "variants_ready":
      return (
        <Badge variant="outline" className="bg-yellow-500/10 text-yellow-400 border-yellow-500/30">
          Select a variant
        </Badge>
      );
    case "approved":
      return (
        <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30">
          Approved
        </Badge>
      );
    case "compositing":
      return (
        <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30">
          Compositing… (website, OG, email sizes)
        </Badge>
      );
    case "complete":
      return (
        <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30">
          Complete
        </Badge>
      );
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
  }
}

function primaryButtonLabel(
  status: CoverStatus,
  completedCount: number,
  promptDirty: boolean
): string {
  if (status === "generating") return `Generating... (${completedCount}/${VARIANT_COUNT} complete)`;
  if (status === "pending" || status === "failed") return "Generate 4 Variants";
  if (status === "variants_ready" || status === "approved" || status === "complete") {
    return promptDirty ? "Regenerate 4 Variants (new prompt)" : "Regenerate 4 Variants";
  }
  return "Generate 4 Variants";
}

interface VariantSlotProps {
  index: number;
  url: string | null;
  ts: number;
  isGenerating: boolean;
  isSelected: boolean;
  canSelect: boolean;
  onSelect: () => void;
  onRegenerate: () => void;
  canRegenerate: boolean;
  onRetry: () => void;
  retryDisabled: boolean;
  showFailed: boolean;
}

function VariantSlot({
  index,
  url,
  ts,
  isGenerating,
  isSelected,
  canSelect,
  onSelect,
  onRegenerate,
  canRegenerate,
  onRetry,
  retryDisabled,
  showFailed,
}: VariantSlotProps) {
  const ring = isSelected
    ? "ring-2 ring-offset-2 ring-offset-background ring-blue-500"
    : "";

  if (url) {
    return (
      <div className={`group relative aspect-[2/3] overflow-hidden rounded-md border border-border bg-muted transition ${ring}`}>
        <button
          type="button"
          onClick={canSelect ? onSelect : undefined}
          disabled={!canSelect}
          className={`absolute inset-0 w-full h-full ${canSelect ? "cursor-pointer" : "cursor-default"}`}
        >
          <img
            src={`${url}?t=${ts}`}
            alt={`Variant ${index + 1}`}
            className="h-full w-full object-cover"
          />
        </button>
        <div className="absolute top-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white pointer-events-none">
          {index + 1}
        </div>
        {canRegenerate && (
          <div className="absolute bottom-2 inset-x-0 flex justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRegenerate(); }}
              className="rounded bg-black/75 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-black/90 backdrop-blur-sm"
            >
              ↻ Regenerate
            </button>
          </div>
        )}
      </div>
    );
  }

  if (isGenerating) {
    return (
      <div className="aspect-[2/3] overflow-hidden rounded-md border border-border bg-muted relative">
        <Skeleton className="h-full w-full" />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs text-muted-foreground animate-pulse">
            Variant {index + 1}
          </span>
        </div>
      </div>
    );
  }

  if (showFailed) {
    return (
      <div className="aspect-[2/3] rounded-md border-2 border-dashed border-red-500/30 bg-red-500/5 p-3 flex flex-col items-center justify-center gap-2 text-center">
        <span className="text-xs font-medium text-red-400">Generation failed</span>
        <span className="text-[11px] text-muted-foreground">Variant {index + 1}</span>
        <Button variant="outline" size="sm" onClick={onRetry} disabled={retryDisabled}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="aspect-[2/3] rounded-md border border-dashed border-border bg-muted/30 flex items-center justify-center">
      <span className="text-xs text-muted-foreground">Variant {index + 1}</span>
    </div>
  );
}
