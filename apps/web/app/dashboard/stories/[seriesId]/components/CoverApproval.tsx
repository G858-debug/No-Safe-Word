"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { XCircle } from "lucide-react";
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
  cover_secondary_character_id: string | null;
  cover_primary_ref_type: "face" | "body";
  cover_secondary_ref_type: "face" | "body" | null;
  // Used by the polling-side recompose trigger to wait ~30s after
  // approval before firing a recompose-cover POST. Comes from
  // story_series.updated_at via the GET /api/stories/[seriesId] select("*").
  updated_at: string;
}

// Eligible characters for the cover-secondary dropdown.
interface CoverEligibleCharacter {
  character_id: string;
  name: string;
  role: string | null;
  has_approved_portrait: boolean;
}

interface CoverJobState {
  variant_index: number;
  status: string; // 'pending' (queued) | 'processing' (running)
  created_at: string; // ISO timestamp — used for per-slot elapsed display
  job_id: string;
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
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptSavedJust, setPromptSavedJust] = useState(false);
  const [eligibleChars, setEligibleChars] = useState<CoverEligibleCharacter[]>([]);
  const [savingCharacter, setSavingCharacter] = useState(false);
  // Per-slot busy set — tracks which variant indices are currently mid-flight
  // on their own retry HTTP call, separate from the global `busy` flag (which
  // covers full-batch operations). Lets the user click Retry on slot 0 and
  // slot 3 in succession without slot 3's button locking out while slot 0's
  // POST is still resolving.
  const [retryingSlots, setRetryingSlots] = useState<Set<number>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Mirror promptDirty in a ref so async fetchCover calls read the LATEST
  // value rather than a stale closure-captured one. Without this, a polling
  // tick that fires just before the user types overwrites the user's typing
  // when its fetch resolves — because its `promptDirty` was captured back
  // when no edits existed.
  const promptDirtyRef = useRef(promptDirty);
  useEffect(() => {
    promptDirtyRef.current = promptDirty;
  }, [promptDirty]);

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
      setCoverJobStates((data.cover_job_states as CoverJobState[]) ?? []);
      if (!promptDirtyRef.current) {
        setPromptDraft(s.cover_prompt ?? "");
      }

      // Build eligible-characters list from the same response. Only
      // characters with approved portraits can be used as cover refs.
      const charsRaw = (data.characters ?? []) as Array<{
        character_id: string | null;
        role: string | null;
        characters:
          | { id: string; name: string; approved_image_id: string | null }
          | { id: string; name: string; approved_image_id: string | null }[]
          | null;
      }>;
      const eligible: CoverEligibleCharacter[] = [];
      for (const row of charsRaw) {
        const base = Array.isArray(row.characters) ? row.characters[0] : row.characters;
        if (!base || !row.character_id) continue;
        eligible.push({
          character_id: row.character_id,
          name: base.name,
          role: row.role,
          has_approved_portrait: Boolean(base.approved_image_id),
        });
      }
      setEligibleChars(eligible);
    } catch {
      setError("Failed to load cover state");
    } finally {
      setLoading(false);
    }
  }, [seriesId]);

  useEffect(() => {
    fetchCover();
  }, [fetchCover]);

  // Poll every 3s while:
  //   - generating (variant images are being created)
  //   - compositing (typography pass running server-side)
  //   - approved+no cover_sizes (waiting for the polling-side recompose
  //     trigger to fire ~30s post-approval, then waiting for it to land)
  useEffect(() => {
    if (!state) return;
    const shouldPoll =
      state.cover_status === "generating" ||
      state.cover_status === "compositing" ||
      (state.cover_status === "approved" && state.cover_sizes === null);
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

  // Polling-side recompose trigger.
  //
  // approve-cover used to fire-and-forget a POST to composite-cover, but
  // that bare fetch had no auth cookie and the middleware rejected it
  // with 401 silently. We've moved the trigger to the client: once the
  // dashboard has been showing 'approved' with no cover_sizes (and no
  // surfaced error) for >30s, fire one recompose-cover POST. The 30s
  // buffer absorbs any in-flight work and prevents thundering retries
  // if multiple browser tabs are open. A useRef flag ensures we fire
  // exactly once per mount; remounting (page reload) restarts the loop
  // organically.
  const recomposeFiredRef = useRef(false);
  useEffect(() => {
    if (!state) return;
    if (state.cover_status !== "approved") return;
    if (state.cover_sizes !== null) return;
    if (state.cover_error !== null) return; // user retries via the error block button
    if (recomposeFiredRef.current) return;

    const ageMs = Date.now() - new Date(state.updated_at).getTime();
    if (ageMs < 30 * 1000) return;

    recomposeFiredRef.current = true;
    (async () => {
      try {
        await fetch(`/api/stories/${seriesId}/recompose-cover`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
      } catch {
        // Network failures will be picked up by the next mount (page
        // reload) — no inline error UI here, the polling loop just
        // keeps showing 'Compositing typography…'.
      } finally {
        await fetchCover();
      }
    })();
  }, [state, seriesId, fetchCover]);

  // Also poll each outstanding job directly so the status endpoint drives
  // webhook-style writes. /api/status/[jobId] is pull-driven — nothing
  // advances generation_jobs.status until someone GETs it.
  // Per-slot timestamps used to bust the browser image cache when a variant
  // is regenerated (the storage path never changes, so without this the
  // browser serves the old image after an overwrite).
  const [variantTs, setVariantTs] = useState<number[]>(() => Array(VARIANT_COUNT).fill(Date.now()));

  // Per-variant job states (pending=queued, processing=running) fetched from DB
  const [coverJobStates, setCoverJobStates] = useState<CoverJobState[]>([]);
  // Ticks every second when generating so per-slot elapsed times update live
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!state || state.cover_status !== "generating") return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state?.cover_status]);

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

  // Resume polling after a page refresh: when the page mounts (or
  // navigates back) with cover_status='generating' but no outstanding
  // jobs yet, fetch the still-pending generation_jobs from the DB and
  // seed outstandingJobs with them. Without this, /api/status is never
  // called between mount and the auto-fail timeout, so jobs that are
  // legitimately still running on Siray sit untouched until the
  // reconciliation kills them.
  const seedRef = useRef(false);
  useEffect(() => {
    if (seedRef.current) return;
    if (!state || state.cover_status !== "generating") return;
    if (outstandingJobs.length > 0) return;
    seedRef.current = true;
    (async () => {
      try {
        const res = await fetch(`/api/stories/${seriesId}/pending-cover-jobs`);
        if (!res.ok) return;
        const { jobIds } = (await res.json()) as { jobIds: string[] };
        if (jobIds?.length) setOutstandingJobs(jobIds);
      } catch {
        /* non-fatal — auto-fail will eventually unblock */
      }
    })();
  }, [state, seriesId, outstandingJobs.length]);

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

  // Slots that need generation: empty in cover_variants AND not currently
  // being generated (no pending/processing job for that slot). Drives the
  // dynamic "Generate N Variants" button — only the slots actually available
  // to be filled count.
  const availableSlots = useMemo(() => {
    const activeIndices = new Set(
      coverJobStates
        .filter((j) => j.status === "pending" || j.status === "processing")
        .map((j) => j.variant_index)
    );
    return variants
      .map((v, i) => (v === null && !activeIndices.has(i) ? i : -1))
      .filter((i) => i >= 0);
  }, [variants, coverJobStates]);

  // Low-level: submits a generation request, merges returned jobIds into
  // outstandingJobs (so concurrent retries don't clobber each other), and
  // refreshes cover state. Throws on error so callers can wrap with their
  // own busy/lock state.
  async function submitGenerationRequest(body: {
    prompt?: string;
    retryVariants?: number[];
  }) {
    const res = await fetch(`/api/stories/${seriesId}/generate-cover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as GenerateCoverResponse;
    if (!res.ok) {
      if (res.status === 409) {
        await fetchCover();
        throw new Error(data.error || "Generation recovered");
      }
      throw new Error(data.error || "Generation failed");
    }
    const newIds = data.jobIds ?? [];
    if (newIds.length > 0) {
      // MERGE — preserve any in-flight jobs from prior submissions so the
      // 3s polling loop continues to drive them. Replacing here would
      // strand earlier retries with no client-side polling.
      setOutstandingJobs((prev) =>
        Array.from(new Set([...prev, ...newIds]))
      );
    }
    // Refresh cover state FIRST — the server has already nulled the
    // retried slots in cover_variants, so after fetchCover the slot
    // will render as "Generating…" with no <img> tag. Only then bump
    // variantTs. If we bumped before fetchCover, React would briefly
    // render <img src="<oldUrl>?t=<newTs>"> in the window between
    // setVariantTs and fetchCover resolving, the browser would fetch
    // and cache the old image under that exact URL, and the eventual
    // post-completion render with the same URL would serve the cached
    // old image instead of the freshly-uploaded new one.
    await fetchCover();
    const regeneratedIndices: number[] =
      body.retryVariants ?? Array.from({ length: VARIANT_COUNT }, (_, i) => i);
    const now = Date.now();
    setVariantTs((prev) =>
      prev.map((ts, i) => (regeneratedIndices.includes(i) ? now : ts))
    );
  }

  async function generate(body: { prompt?: string; retryVariants?: number[] }) {
    setBusy(true);
    setError(null);
    try {
      await submitGenerationRequest(body);
      setPromptDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerate() {
    // Approved/complete: regenerating invalidates the user's selection AND
    // any composited typography variants, so always do a FULL regenerate
    // with confirm — clean slate.
    if (state?.cover_status === "approved" || state?.cover_status === "complete") {
      const ok = window.confirm(
        "Regenerating will reset the approved cover and discard all composited website/OG/email versions. You'll need to re-approve a new variant and wait for compositing to re-run. Continue?"
      );
      if (!ok) return;
      await generate(promptDirty ? { prompt: promptDraft } : {});
      return;
    }

    // No available slots and dirty prompt: the user wants to apply new
    // prompt edits but every slot is filled or in-flight. Confirm before
    // full regenerate (which discards the existing art).
    if (availableSlots.length === 0) {
      if (!promptDirty) return;
      const ok = window.confirm(
        "All variants are filled and you have prompt edits. Regenerating will reset all 4 slots to apply your new prompt. Continue?"
      );
      if (!ok) return;
      await generate({ prompt: promptDraft });
      return;
    }

    // Partial regenerate of available slots — carries the user's textarea
    // content if they've edited it, so per-cover prompt iteration works
    // without every click reseting the slots they're keeping.
    const body: { retryVariants: number[]; prompt?: string } = {
      retryVariants: availableSlots,
    };
    if (promptDirty) body.prompt = promptDraft;
    await generate(body);
  }

  async function handleRetryCompositing() {
    setBusy(true);
    setError(null);
    // Reset the one-shot guard so the polling loop can retrigger if
    // this manual retry doesn't land. recompose-cover handles stale
    // 'compositing' state recovery internally.
    recomposeFiredRef.current = false;
    try {
      const res = await fetch(`/api/stories/${seriesId}/recompose-cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      // recompose-cover runs synchronously; on success it returns 200,
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
    const body: { retryVariants: number[]; prompt?: string } = {
      retryVariants: failedIndices,
    };
    if (promptDirty) body.prompt = promptDraft;
    await generate(body);
  }

  async function handleRetrySingle(index: number) {
    // Per-slot retry uses the per-slot busy set instead of the global `busy`
    // flag, so the user can fire off multiple slot retries in quick succession
    // without each click locking the rest of the cover UI.
    setRetryingSlots((prev) => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
    setError(null);
    try {
      // Send the textarea content along with the retry so the user's edits
      // are applied. Without this, partial retries silently fall back to
      // the previously-saved cover_prompt and the user's local edits get
      // dropped.
      const body: { retryVariants: number[]; prompt?: string } = {
        retryVariants: [index],
      };
      if (promptDirty) body.prompt = promptDraft;
      await submitGenerationRequest(body);
      if (promptDirty) setPromptDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetryingSlots((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    }
  }

  async function handleCancelCover() {
    const ok = window.confirm(
      "Cancel all queued cover generation jobs? The cover will return to 'pending' and you can restart generation when ready."
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/stories/${seriesId}/cancel-cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Cancel failed");
      }
      setOutstandingJobs([]);
      await fetchCover();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setBusy(false);
    }
  }

  // Save the current textarea content to story_series.cover_prompt without
  // triggering generation. Lets the user iterate on the prompt text across
  // page reloads without spending GPU. After save, clear the dirty flag so
  // the polling fetchCover doesn't fight the save.
  async function handleSavePrompt() {
    if (!promptDirty) return;
    setSavingPrompt(true);
    setError(null);
    try {
      const res = await fetch(`/api/stories/${seriesId}/cover-prompt`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptDraft }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save prompt");
        return;
      }
      setPromptDirty(false);
      setPromptSavedJust(true);
      await fetchCover();
      setTimeout(() => setPromptSavedJust(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save prompt");
    } finally {
      setSavingPrompt(false);
    }
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

  // Persist a cover ref-type dropdown change. Both dropdowns hit the same
  // endpoint; the body fields are sparse so we only PATCH the one that
  // changed. Locked while the cover is generating/approved/complete.
  async function handleCoverRefTypeChange(
    field: "primary_ref_type" | "secondary_ref_type",
    value: "face" | "body"
  ) {
    setSavingCharacter(true);
    setError(null);
    try {
      const res = await fetch(`/api/stories/${seriesId}/cover-ref-type`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to update reference type");
        return;
      }
      await fetchCover();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update reference type"
      );
    } finally {
      setSavingCharacter(false);
    }
  }

  // Save the secondary cover-character override. `value === ""` means
  // clear the override and fall back to the love_interest role.
  async function handleSecondaryCharacterChange(value: string) {
    setSavingCharacter(true);
    setError(null);
    try {
      const characterId = value === "" ? null : value;
      const res = await fetch(`/api/stories/${seriesId}/cover-character`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to update cover character");
        return;
      }
      await fetchCover();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update cover character");
    } finally {
      setSavingCharacter(false);
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

          {/* Stuck/in-progress fallback: cover is approved but composites
              haven't landed yet. Covers the ~30s pre-trigger wait + the
              actual compositing pass. Mutually exclusive with the
              cover_error block above. */}
          {state.cover_status === "approved" &&
            state.cover_sizes === null &&
            state.cover_error === null && (
              <div className="rounded-md border border-border bg-muted/30 p-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Compositing typography…</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Generating hero, card, OG, and email covers. This takes about
                    a minute. If it persists for more than a minute, click Retry.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRetryCompositing}
                  disabled={busy}
                >
                  Retry now
                </Button>
              </div>
            )}

          {state.cover_status === "complete" && heroUrl && (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">
                  Composited hero preview
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRetryCompositing}
                  disabled={busy || isCompositing}
                  title="Re-render typography on top of the selected cover variant. Use after a title or hashtag change — the underlying base image stays the same."
                  className="text-xs"
                >
                  {busy || isCompositing ? "Recomposing…" : "Recompose typography"}
                </Button>
              </div>
              <img
                src={heroUrl}
                alt="Composited hero cover"
                className="mx-auto max-h-[480px] rounded-md border border-border"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-muted-foreground">
              Secondary character on cover
            </label>
            <div className="flex items-center gap-3">
              <Select
                value={state.cover_secondary_character_id ?? "__default__"}
                onValueChange={(v) =>
                  handleSecondaryCharacterChange(v === "__default__" ? "" : v)
                }
                disabled={
                  savingCharacter ||
                  busy ||
                  regeneratingPrompt ||
                  isGenerating ||
                  isCompositing ||
                  state.cover_status === "approved" ||
                  state.cover_status === "complete"
                }
              >
                <SelectTrigger className="max-w-md">
                  <SelectValue placeholder="Default (use love interest)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">
                    Default (love interest)
                    {(() => {
                      const li = eligibleChars.find((c) => c.role === "love_interest");
                      return li ? ` — ${li.name}` : "";
                    })()}
                  </SelectItem>
                  {eligibleChars
                    .filter(
                      (c) =>
                        c.has_approved_portrait && c.role !== "protagonist"
                    )
                    .map((c) => (
                      <SelectItem key={c.character_id} value={c.character_id}>
                        {c.name}
                        {c.role ? ` (${c.role})` : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {savingCharacter && (
                <span className="text-xs text-muted-foreground">Saving…</span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Choose which character appears beside the protagonist on the cover.
              Override only — the story&rsquo;s love-interest role is unchanged.
              Changes take effect on the next prompt regeneration and the next
              variant generation.
            </p>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-3">
              <label className="text-sm font-medium text-muted-foreground">
                Cover prompt
              </label>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSavePrompt}
                  disabled={
                    !promptDirty ||
                    savingPrompt ||
                    busy ||
                    regeneratingPrompt ||
                    isCompositing
                  }
                >
                  {savingPrompt ? "Saving..." : "Save"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRegeneratePrompt}
                  disabled={
                    regeneratingPrompt ||
                    busy ||
                    isGenerating ||
                    isCompositing ||
                    savingPrompt
                  }
                >
                  {regeneratingPrompt
                    ? "Regenerating with Mistral..."
                    : "Regenerate prompt with Mistral"}
                </Button>
              </div>
            </div>
            <Textarea
              value={promptDraft}
              placeholder={COVER_PROMPT_PLACEHOLDER}
              disabled={!canEditPrompt || busy || regeneratingPrompt || savingPrompt}
              onChange={(e) => {
                setPromptDraft(e.target.value);
                setPromptDirty(e.target.value !== (state.cover_prompt ?? ""));
              }}
              className="min-h-[160px] text-sm"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              This text is sent <strong>verbatim</strong> to the image model.
              No character descriptions, no visual signature, and no other text
              is injected behind the scenes — what you see here is what the
              model gets. The approved character portrait(s) are also attached
              as reference image(s); identity (faces, bodies, skin, hair) flows
              through those, so you don&rsquo;t need to describe physical
              features in the prompt. Use the prompt to control wardrobe,
              pose, setting, lighting, and composition.
            </p>
            {promptDirty && (
              <p className="mt-1 text-xs text-amber-400">
                Unsaved edits — click Save to persist, or click any Generate
                button to apply and generate at the same time.
              </p>
            )}
            {promptSavedJust && !promptDirty && (
              <p className="mt-1 text-xs text-green-400">
                Prompt saved.
              </p>
            )}
            {promptRegenJustSucceeded && !promptDirty && !promptSavedJust && (
              <p className="mt-1 text-xs text-green-400">
                New prompt generated. Review it, then click &ldquo;Generate 4
                Variants&rdquo; to spend RunPod time.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {variants.map((url, i) => {
              const jobState = coverJobStates.find((j) => j.variant_index === i) ?? null;
              const slotIsActive =
                jobState?.status === "pending" || jobState?.status === "processing";
              const slotIsBusy = retryingSlots.has(i);
              // A slot can be retried if it's not currently being generated
              // AND we're not mid-flight on its own retry HTTP call. This is
              // independent of the global cover_status — partial retries can
              // fire concurrently with other slots in flight.
              const canRetryThisSlot =
                !slotIsActive &&
                !slotIsBusy &&
                state.cover_status !== "compositing" &&
                state.cover_status !== "pending";
              return (
                <VariantSlot
                  key={i}
                  index={i}
                  url={url}
                  ts={variantTs[i]}
                  jobStatus={jobState?.status ?? null}
                  jobCreatedAtMs={jobState ? new Date(jobState.created_at).getTime() : null}
                  nowMs={nowMs}
                  isGenerating={slotIsActive}
                  isSelected={selectedIdx === i}
                  canSelect={
                    state.cover_status === "variants_ready" ||
                    state.cover_status === "approved" ||
                    state.cover_status === "complete"
                  }
                  onSelect={() => setPendingSelection(i)}
                  onRegenerate={() => handleRetrySingle(i)}
                  canRegenerate={canRetryThisSlot}
                  onRetry={() => handleRetrySingle(i)}
                  retryDisabled={!canRetryThisSlot}
                  showFailed={
                    !slotIsActive &&
                    !slotIsBusy &&
                    url === null &&
                    state.cover_status !== "pending"
                  }
                />
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={handleGenerate}
              disabled={(() => {
                if (busy) return true;
                if (!promptDraft && !state.cover_prompt) return true;
                // Approved/complete always allowed — full regen with confirm.
                if (
                  state.cover_status === "approved" ||
                  state.cover_status === "complete"
                ) {
                  return false;
                }
                // Dirty prompt always allowed — partial regen if slots
                // available, full regen with confirm if not.
                if (promptDirty) return false;
                // Otherwise need at least one available slot to do a
                // partial regen.
                return availableSlots.length === 0;
              })()}
            >
              {primaryButtonLabel(
                state.cover_status,
                completedCount,
                availableSlots.length,
                promptDirty
              )}
            </Button>

            {/* Cancel: shown when generation is in-flight with queued/running jobs */}
            {isGenerating && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelCover}
                disabled={busy}
                className="gap-1.5 text-muted-foreground hover:text-destructive hover:border-destructive/50"
              >
                <XCircle className="h-3.5 w-3.5" />
                Cancel generation
              </Button>
            )}

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
  availableCount: number,
  promptDirty: boolean
): string {
  // Approved/complete: always full regen (selection invalidated).
  if (status === "approved" || status === "complete") {
    return promptDirty ? "Regenerate 4 Variants (new prompt)" : "Regenerate 4 Variants";
  }

  if (availableCount === 0) {
    // Dirty edits with no empty slots → user has to discard existing art
    // to apply the new prompt. Show full-regen label.
    if (promptDirty) return "Regenerate 4 Variants (new prompt)";
    if (status === "generating") {
      return `Generating... (${completedCount}/${VARIANT_COUNT} complete)`;
    }
    return "All variants ready";
  }

  const noun = availableCount === 1 ? "Variant" : "Variants";
  if (promptDirty) return `Generate ${availableCount} ${noun} (new prompt)`;
  return `Generate ${availableCount} ${noun}`;
}

interface VariantSlotProps {
  index: number;
  url: string | null;
  ts: number;
  /** DB status of the generation_job for this variant ('pending'=queued, 'processing'=running, null=none). */
  jobStatus: string | null;
  /** Epoch ms when the job was created — drives the per-slot elapsed display. */
  jobCreatedAtMs: number | null;
  /** Parent-level "now" tick (updated every second when generating). */
  nowMs: number;
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

function formatSlotElapsed(createdAtMs: number, nowMs: number): string {
  const s = Math.floor((nowMs - createdAtMs) / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function VariantSlot({
  index,
  url,
  ts,
  jobStatus,
  jobCreatedAtMs,
  nowMs,
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
            src={`${url}${url.includes("?") ? "&" : "?"}t=${ts}`}
            alt={`Variant ${index + 1}`}
            className="h-full w-full object-cover"
          />
        </button>
        <div className="absolute top-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white pointer-events-none">
          {index + 1}
        </div>
        {/* Hover hint — only when the variant is selectable and not already
            the current selection. Sits centered, fades in with the rest of
            the hover affordances, doesn't intercept clicks (button below
            handles them). */}
        {canSelect && !isSelected && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="rounded-full bg-black/70 px-3 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
              Click to select
            </div>
          </div>
        )}
        {/* Persistent badge on the currently-selected variant so the user
            sees the selected state even when not hovering. */}
        {isSelected && (
          <div className="pointer-events-none absolute top-1 right-1 rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            Selected
          </div>
        )}
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
    const isQueued = jobStatus === "pending";
    const isRunning = jobStatus === "processing";
    const elapsed =
      jobCreatedAtMs !== null ? formatSlotElapsed(jobCreatedAtMs, nowMs) : null;

    return (
      <div className="aspect-[2/3] overflow-hidden rounded-md border border-border bg-muted relative">
        <Skeleton className="h-full w-full" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-2">
          {isQueued ? (
            <>
              <span className="text-[11px] font-medium text-zinc-400">
                Queued
              </span>
              {elapsed && (
                <span className="text-[10px] text-zinc-500 animate-pulse">
                  {elapsed} — waiting for GPU
                </span>
              )}
            </>
          ) : isRunning ? (
            <>
              <span className="text-[11px] font-medium text-blue-400 animate-pulse">
                Generating
              </span>
              {elapsed && (
                <span className="text-[10px] text-zinc-500">{elapsed}</span>
              )}
            </>
          ) : (
            <span className="text-xs text-muted-foreground animate-pulse">
              Variant {index + 1}
            </span>
          )}
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
