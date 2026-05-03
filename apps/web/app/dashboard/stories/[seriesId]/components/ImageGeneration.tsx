"use client";

import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
// Deep import from the specific submodule rather than the package barrel —
// the barrel re-exports server-only modules (Replicate SDK, sharp, RunPod
// fetch helpers) which would otherwise be dragged into the client bundle.
// `portrait-prompt-builder` is pure (no Node deps after Phase D's
// extraction of prompt-constants), so it's safe to import here.
import { VISUAL_SIGNATURE } from "@no-safe-word/image-gen/prompt-constants";
import type { ImageModel } from "@no-safe-word/shared";
import type { CharacterFromAPI } from "./CharacterApproval";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sparkles,
  RefreshCw,
  Check,
  Loader2,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  X,
  Users,
  Zap,
  CheckCircle2,
  Undo2,
  Eye,
  Trash2,
  Star,
} from "lucide-react";
// ══════════════════════════════════════════════════════════════
// ART DIRECTOR — DEACTIVATED 2026-04-19
// The Art Director pipeline (Qwen VL + CivitAI search + iterative
// generation) has been replaced by direct model generation (Flux 2
// Dev / HunyuanImage 3.0) via /api/stories/[seriesId]/generate-image.
// Code preserved for potential reactivation. See /api/art-director/*
// routes and ./ArtDirectorModal for the original implementation.
// To reactivate: restore the import below, restore the state +
// handlers guarded by the "ART DIRECTOR" markers, and restore the
// <ArtDirectorModal /> render block further down.
// ══════════════════════════════════════════════════════════════
// import ArtDirectorModal from "./ArtDirectorModal";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImagePromptData {
  id: string;
  image_type: string;
  pairs_with: string | null;
  position: number;
  position_after_word: number | null;
  character_name: string | null;
  character_id: string | null;
  secondary_character_id: string | null;
  secondary_character_name: string | null;
  prompt: string;
  image_id: string | null;
  previous_image_id: string | null;
  status: string;
  character_block_override: string | null;
  secondary_character_block_override: string | null;
  suppress_character_block: boolean;
  clothing_override: string | null;
  sfw_constraint_override: string | null;
  visual_signature_override: string | null;
  final_prompt: string | null;
  final_prompt_drafted_at: string | null;
  pose_template_id: string | null;
  is_chapter_hero: boolean;
}

export interface PostWithPrompts {
  id: string;
  part_number: number;
  title: string;
  story_image_prompts: ImagePromptData[];
}

interface ImageGenerationProps {
  seriesId: string;
  posts: PostWithPrompts[];
  imageUrls: Record<string, string>;
  allCharactersApproved: boolean;
  imageModel: ImageModel;
  characters: CharacterFromAPI[];
  onNavigateToCharacters: () => void;
}

/**
 * Minimal character info needed by the locked-block UI. Keyed by the
 * canonical `characters.id` (== `story_image_prompts.character_id`).
 */
interface CharacterIdentity {
  name: string | null;
  portraitPromptLocked: string | null;
  clothing: string | null;
}

interface PromptState {
  status: string;
  imageUrl: string | null;
  promptText: string;
  savedPromptText: string;
  error: string | null;
  previousImageId: string | null;
  isReverting: boolean;
  characterBlockOverride: string | null;
  savedCharacterBlockOverride: string | null;
  showOverride: boolean;
  secondaryCharacterBlockOverride: string | null;
  savedSecondaryCharacterBlockOverride: string | null;
  showSecondaryOverride: boolean;
  suppressCharacterBlock: boolean;
  savedSuppressCharacterBlock: boolean;
  clothingOverride: string | null;
  savedClothingOverride: string | null;
  showClothingOverride: boolean;
  sfwConstraintOverride: string | null;
  savedSfwConstraintOverride: string | null;
  showSfwConstraintOverride: boolean;
  visualSignatureOverride: string | null;
  savedVisualSignatureOverride: string | null;
  showVisualSignatureOverride: boolean;
  showFullPromptPreview: boolean;
  critiqueText: string | null;
  critiqueLoading: boolean;
  savingPrompt: boolean;
  promptSavedJust: boolean;
  // ── Mistral-drafted final prompt ───────────────────────────────────
  // The text Mistral has drafted (and the user may have edited) that
  // gets sent verbatim to Siray. Source of truth lives at
  // story_image_prompts.final_prompt.
  finalPromptText: string;
  savedFinalPromptText: string;
  finalPromptDraftedAt: string | null;
  isDraftingFinalPrompt: boolean;
  draftError: string | null;
  // ── Pose template ──────────────────────────────────────────────────
  poseTemplateId: string | null;
  savedPoseTemplateId: string | null;
}

export interface PoseTemplate {
  id: string;
  name: string;
  pose_description: string;
  reference_url: string | null;
  send_image_to_model: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  pending: {
    label: "Pending",
    className: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  },
  generating: {
    label: "Generating",
    className:
      "bg-blue-500/20 text-blue-400 border-blue-500/30 animate-pulse",
  },
  generated: {
    label: "Generated",
    className: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  },
  approved: {
    label: "Approved",
    className: "bg-green-500/20 text-green-400 border-green-500/30",
  },
  failed: {
    label: "Failed",
    className: "bg-red-500/20 text-red-400 border-red-500/30",
  },
};

const IMAGE_TYPE_CONFIG: Record<
  string,
  { emoji: string; label: string; shortLabel: string }
> = {
  facebook_sfw: {
    emoji: "\u{1F4F1}",
    label: "Facebook SFW",
    shortLabel: "SFW",
  },
  website_nsfw_paired: {
    emoji: "\u{1F512}",
    label: "Website NSFW (Paired)",
    shortLabel: "NSFW",
  },
  website_only: {
    emoji: "\u{1F4D6}",
    label: "Website Only",
    shortLabel: "Web",
  },
};

const POLL_INTERVAL = 4000;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ImageGeneration({
  seriesId,
  posts,
  imageUrls,
  allCharactersApproved,
  imageModel,
  characters,
  onNavigateToCharacters,
}: ImageGenerationProps) {
  // Lookup table for the locked-block UI: character_id → name + portrait
  // text. Same source as the server-side scene block (Phase B); kept in
  // sync via the `characters` prop loaded on the page.
  const characterIdentityMap = useMemo<Record<string, CharacterIdentity>>(() => {
    const m: Record<string, CharacterIdentity> = {};
    for (const c of characters) {
      if (!c.character_id) continue;
      m[c.character_id] = {
        name: c.name,
        portraitPromptLocked: c.portrait_prompt_locked,
        clothing: (c.description as Record<string, string>)?.clothing ?? null,
      };
    }
    return m;
  }, [characters]);
  // ---- State ----
  const [promptStates, setPromptStates] = useState<
    Record<string, PromptState>
  >({});
  const [isPolling, setIsPolling] = useState(false);
  const pollingIdsRef = useRef<Set<string>>(new Set());
  const promptToJobIdRef = useRef<Map<string, string>>(new Map());
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchApproving, setBatchApproving] = useState(false);
  const [deletedPromptIds, setDeletedPromptIds] = useState<Set<string>>(new Set());
  const [selectedChapter, setSelectedChapter] = useState<string>("");
  const [collapsedPosts, setCollapsedPosts] = useState<Set<string>>(
    new Set()
  );
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  // ART DIRECTOR — DEACTIVATED 2026-04-19 (see header comment)
  // Sequential batch progress tracked via `batchProgress` instead of the
  // Art Director queue.
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);

  // Detail modal — currently selected prompt (null = closed).
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);

  // Per-post chapter-hero state. Hydrated from props; mutated optimistically
  // by handleSetHero. The server is the source of truth (set_chapter_hero
  // RPC + partial unique index); this map mirrors the flag for UI
  // responsiveness so editors don't wait on a round trip to see the badge
  // move.
  const [heroByPost, setHeroByPost] = useState<Record<string, string | null>>(
    () => {
      const m: Record<string, string | null> = {};
      for (const post of posts) {
        const hero = post.story_image_prompts.find(
          (ip) =>
            ip.image_type === "facebook_sfw" && ip.is_chapter_hero === true
        );
        m[post.id] = hero?.id ?? null;
      }
      return m;
    }
  );

  // Pose templates (loaded once when the page mounts; refreshed when the
  // user adds/removes one via the dedicated management page).
  const [poseTemplates, setPoseTemplates] = useState<PoseTemplate[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/pose-templates");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data?.templates)) {
          setPoseTemplates(data.templates);
        }
      } catch {
        // non-fatal — dropdown just stays empty
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Build a lookup: promptId → position (for pairing indicators)
  const promptPositionMap = useRef<Record<string, number>>({});

  // Ordered list of {prompt, imageType, postTitle} mirroring the grid render
  // order — drives ←/→ navigation in the detail modal.
  const orderedPromptList = useMemo(() => {
    const out: Array<{ ip: ImagePromptData; imageType: string; postTitle: string }> = [];
    for (const post of posts) {
      const live = post.story_image_prompts.filter((ip) => !deletedPromptIds.has(ip.id));
      for (const imageType of ["facebook_sfw", "website_nsfw_paired", "website_only"] as const) {
        for (const ip of live.filter((p) => p.image_type === imageType)) {
          out.push({ ip, imageType, postTitle: post.title });
        }
      }
    }
    return out;
  }, [posts, deletedPromptIds]);

  // ---- Initialize state from props ----
  useEffect(() => {
    const initial: Record<string, PromptState> = {};
    const posMap: Record<string, number> = {};
    const staleGeneratingIds: string[] = [];

    for (const post of posts) {
      for (const ip of post.story_image_prompts) {
        posMap[ip.id] = ip.position;

        // Determine image URL: stored/approved first, then blob
        const url = ip.image_id ? imageUrls[ip.image_id] || null : null;

        initial[ip.id] = {
          status: ip.status,
          imageUrl: url,
          promptText: ip.prompt,
          savedPromptText: ip.prompt,
          error: null,
          previousImageId: ip.previous_image_id || null,
          isReverting: false,
          characterBlockOverride: ip.character_block_override ?? null,
          savedCharacterBlockOverride: ip.character_block_override ?? null,
          showOverride: Boolean(ip.character_block_override),
          secondaryCharacterBlockOverride: ip.secondary_character_block_override ?? null,
          savedSecondaryCharacterBlockOverride: ip.secondary_character_block_override ?? null,
          showSecondaryOverride: Boolean(ip.secondary_character_block_override),
          suppressCharacterBlock: ip.suppress_character_block ?? false,
          savedSuppressCharacterBlock: ip.suppress_character_block ?? false,
          clothingOverride: ip.clothing_override ?? null,
          savedClothingOverride: ip.clothing_override ?? null,
          showClothingOverride: Boolean(ip.clothing_override),
          sfwConstraintOverride: ip.sfw_constraint_override ?? null,
          savedSfwConstraintOverride: ip.sfw_constraint_override ?? null,
          showSfwConstraintOverride: Boolean(ip.sfw_constraint_override),
          visualSignatureOverride: ip.visual_signature_override ?? null,
          savedVisualSignatureOverride: ip.visual_signature_override ?? null,
          showVisualSignatureOverride: Boolean(ip.visual_signature_override),
          showFullPromptPreview: false,
          critiqueText: null,
          critiqueLoading: false,
          savingPrompt: false,
          promptSavedJust: false,
          finalPromptText: ip.final_prompt ?? "",
          savedFinalPromptText: ip.final_prompt ?? "",
          finalPromptDraftedAt: ip.final_prompt_drafted_at ?? null,
          isDraftingFinalPrompt: false,
          draftError: null,
          poseTemplateId: ip.pose_template_id ?? null,
          savedPoseTemplateId: ip.pose_template_id ?? null,
        };

        // Collect "generating" prompts — we'll resolve their real status below
        if (ip.status === "generating") {
          staleGeneratingIds.push(ip.id);
        }
      }
    }

    promptPositionMap.current = posMap;
    setPromptStates(initial);

    // For prompts stuck as "generating" from a previous session, check
    // their actual status via the prompt status endpoint. Three branches:
    //   1. Job has completed since the page was last open → mark generated.
    //   2. Job has failed → mark failed.
    //   3. Job is still in flight → resume client-side polling so we
    //      pick up the result when it lands. Without this, the previous
    //      version reset the prompt to 'pending' even when the job was
    //      genuinely still running on Siray, abandoning it silently —
    //      the result would land server-side but the UI never updated.
    if (staleGeneratingIds.length > 0) {
      let anyResumed = false;
      Promise.allSettled(
        staleGeneratingIds.map(async (promptId) => {
          try {
            const res = await fetch(`/api/stories/images/${promptId}/status`);
            if (!res.ok) return;
            const data = await res.json();

            if (data.status === "generated" || data.status === "approved") {
              setPromptStates((prev) => ({
                ...prev,
                [promptId]: {
                  ...prev[promptId],
                  status: data.status,
                  imageUrl: data.storedUrl || data.blobUrl || prev[promptId]?.imageUrl || null,
                  error: null,
                },
              }));
            } else if (data.status === "failed") {
              setPromptStates((prev) => ({
                ...prev,
                [promptId]: {
                  ...prev[promptId],
                  status: "failed",
                  error: "Generation failed",
                },
              }));
            } else if (data.status === "generating" && data.jobId) {
              // Job still running — wire it back into the polling loop
              // so the eventual completion lands in this UI.
              promptToJobIdRef.current.set(promptId, data.jobId);
              pollingIdsRef.current.add(promptId);
              anyResumed = true;
              setPromptStates((prev) => ({
                ...prev,
                [promptId]: {
                  ...prev[promptId],
                  status: "generating",
                  error: null,
                },
              }));
            } else {
              // 'generating' with no jobId, or 'pending' — nothing to
              // resume; let the user retry.
              setPromptStates((prev) => ({
                ...prev,
                [promptId]: {
                  ...prev[promptId],
                  status: "pending",
                  error: null,
                },
              }));
            }
          } catch {
            // Status endpoint failed — reset to pending so user can retry
            setPromptStates((prev) => ({
              ...prev,
              [promptId]: {
                ...prev[promptId],
                status: "pending",
                error: null,
              },
            }));
          }
        })
      ).then(() => {
        if (anyResumed) setIsPolling(true);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ART DIRECTOR POD MANAGEMENT — DEACTIVATED 2026-04-19
  // The Qwen VL pod is no longer involved in image generation, so
  // polling /api/art-director/pod and the idle-cost banner are gone.
  // The pod route itself still works; use it manually if you need to
  // stop a running pod (e.g. POST /api/art-director/pod { action: "stop" }).

  // ---- Helpers ----

  const updatePrompt = useCallback(
    (id: string, updates: Partial<PromptState>) => {
      setPromptStates((prev) => ({
        ...prev,
        [id]: { ...prev[id], ...updates },
      }));
    },
    []
  );

  // Trigger a Mistral re-draft of the final prompt for this image.
  // Persists server-side and updates the textarea on success.
  const draftFinalPrompt = useCallback(
    async (promptId: string): Promise<void> => {
      updatePrompt(promptId, { isDraftingFinalPrompt: true, draftError: null });
      try {
        const res = await fetch(
          `/api/stories/images/${promptId}/draft-prompt`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          updatePrompt(promptId, {
            isDraftingFinalPrompt: false,
            draftError: data?.error ?? "Drafting failed",
          });
          return;
        }
        updatePrompt(promptId, {
          isDraftingFinalPrompt: false,
          finalPromptText: data.final_prompt,
          savedFinalPromptText: data.final_prompt,
          finalPromptDraftedAt: data.final_prompt_drafted_at,
          draftError: null,
        });
      } catch (err) {
        updatePrompt(promptId, {
          isDraftingFinalPrompt: false,
          draftError: err instanceof Error ? err.message : "Drafting failed",
        });
      }
    },
    [updatePrompt]
  );

  // Persist textarea edits without triggering generation. Mirrors the
  // cover-page Save button — without it, edits are lost on refresh
  // because they only get PATCHed as a side effect of clicking Generate.
  // Save every dirty field on a prompt (text + all overrides) without
  // triggering generation. Used by the detail modal's Save button.
  // Generate's own auto-save block in handleRegenerate is unchanged.
  const handleSaveAll = useCallback(
    async (promptId: string): Promise<boolean> => {
      const state = promptStates[promptId];
      if (!state) return true;

      const dirty: Array<{
        body: Record<string, unknown>;
        savedKey: keyof PromptState;
        value: PromptState[keyof PromptState];
      }> = [];
      const queue = (
        cur: PromptState[keyof PromptState],
        saved: PromptState[keyof PromptState],
        apiKey: string,
        savedKey: keyof PromptState,
      ) => {
        if (cur !== saved) dirty.push({ body: { [apiKey]: cur }, savedKey, value: cur });
      };
      queue(state.promptText, state.savedPromptText, "prompt", "savedPromptText");
      queue(state.characterBlockOverride, state.savedCharacterBlockOverride, "character_block_override", "savedCharacterBlockOverride");
      queue(state.secondaryCharacterBlockOverride, state.savedSecondaryCharacterBlockOverride, "secondary_character_block_override", "savedSecondaryCharacterBlockOverride");
      queue(state.suppressCharacterBlock, state.savedSuppressCharacterBlock, "suppress_character_block", "savedSuppressCharacterBlock");
      queue(state.clothingOverride, state.savedClothingOverride, "clothing_override", "savedClothingOverride");
      queue(state.sfwConstraintOverride, state.savedSfwConstraintOverride, "sfw_constraint_override", "savedSfwConstraintOverride");
      queue(state.visualSignatureOverride, state.savedVisualSignatureOverride, "visual_signature_override", "savedVisualSignatureOverride");
      queue(state.finalPromptText, state.savedFinalPromptText, "final_prompt", "savedFinalPromptText");

      if (dirty.length === 0) return true;

      updatePrompt(promptId, { savingPrompt: true, error: null });
      for (const { body, savedKey, value } of dirty) {
        try {
          const res = await fetch(`/api/stories/images/${promptId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            updatePrompt(promptId, {
              savingPrompt: false,
              error: err?.error || "Failed to save edits",
            });
            return false;
          }
          updatePrompt(promptId, { [savedKey]: value } as Partial<PromptState>);
        } catch (err) {
          updatePrompt(promptId, {
            savingPrompt: false,
            error: err instanceof Error ? err.message : "Failed to save edits",
          });
          return false;
        }
      }
      updatePrompt(promptId, { savingPrompt: false, promptSavedJust: true });
      setTimeout(() => {
        updatePrompt(promptId, { promptSavedJust: false });
      }, 2500);
      return true;
    },
    [promptStates, updatePrompt]
  );

  // ---- Polling ----

  useEffect(() => {
    if (!isPolling) return;

    const interval = setInterval(async () => {
      const promptIds = Array.from(pollingIdsRef.current);
      if (promptIds.length === 0) {
        setIsPolling(false);
        return;
      }

      // Build array of {promptId, jobId} for polling
      const pollTargets = promptIds
        .map((promptId) => ({
          promptId,
          jobId: promptToJobIdRef.current.get(promptId),
        }))
        .filter((t) => t.jobId) as { promptId: string; jobId: string }[];

      if (pollTargets.length === 0) {
        setIsPolling(false);
        return;
      }

      const results = await Promise.allSettled(
        pollTargets.map(({ promptId, jobId }) =>
          fetch(`/api/status/${jobId}`)
            .then((r) => r.json())
            .then((data) => ({ promptId, jobId, data }))
        )
      );

      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        const { promptId, data } = result.value;

        if (data.completed) {
          // Job completed — persist to DB and store image permanently
          pollingIdsRef.current.delete(promptId);
          promptToJobIdRef.current.delete(promptId);

          // Call the prompt status endpoint which updates story_image_prompts
          // status to "generated" and stores the blob to Supabase Storage
          try {
            const statusRes = await fetch(`/api/stories/images/${promptId}/status`);
            if (statusRes.ok) {
              const statusData = await statusRes.json();
              updatePrompt(promptId, {
                status: "generated",
                imageUrl: statusData.storedUrl || statusData.blobUrl || data.imageUrl || null,
                error: null,
              });
            } else {
              updatePrompt(promptId, {
                status: "generated",
                imageUrl: data.imageUrl || null,
                error: null,
              });
            }
          } catch {
            // Fallback to blob URL if status endpoint fails
            updatePrompt(promptId, {
              status: "generated",
              imageUrl: data.imageUrl || null,
              error: null,
            });
          }
          // Trigger critique for the completed async job
          void (async () => {
            updatePrompt(promptId, { critiqueLoading: true, critiqueText: null });
            try {
              const critiqueRes = await fetch(
                `/api/stories/images/${promptId}/critique`,
                { method: "POST" }
              );
              if (critiqueRes.ok) {
                const critiqueData = await critiqueRes.json();
                updatePrompt(promptId, {
                  critiqueText: critiqueData.critique ?? null,
                  critiqueLoading: false,
                });
              } else {
                updatePrompt(promptId, { critiqueLoading: false });
              }
            } catch {
              updatePrompt(promptId, { critiqueLoading: false });
            }
          })();
        } else if (data.error) {
          // Job failed
          pollingIdsRef.current.delete(promptId);
          promptToJobIdRef.current.delete(promptId);
          updatePrompt(promptId, {
            status: "failed",
            error: data.error || "Generation failed",
          });
        }
        // If not completed and no error, keep polling
      }

      // Stop polling if no more IDs
      if (pollingIdsRef.current.size === 0) {
        setIsPolling(false);
      }
    }, POLL_INTERVAL);

    return () => clearInterval(interval);
  }, [isPolling, updatePrompt]);

  // ---- Actions ----

  // OLD PIPELINE — kept for reference. Art Director is now the default for story images.
  // const handleBatchGenerate_OLD = useCallback(
  //   async (postId?: string, regenerate?: boolean) => {
  //     setBatchGenerating(true);
  //     try {
  //       const body: Record<string, string | boolean> = {};
  //       if (postId) body.post_id = postId;
  //       if (regenerate) body.regenerate = true;
  //       const res = await fetch(`/api/stories/${seriesId}/generate-images-v4`, {
  //         method: "POST",
  //         headers: { "Content-Type": "application/json" },
  //         body: JSON.stringify(body),
  //       });
  //       if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Batch generation failed"); }
  //       const data = await res.json();
  //       for (const job of data.jobs || []) {
  //         if (job.jobId) promptToJobIdRef.current.set(job.promptId, job.jobId);
  //         updatePrompt(job.promptId, { status: "generating", error: null });
  //         pollingIdsRef.current.add(job.promptId);
  //       }
  //       for (const fail of data.errors || []) {
  //         updatePrompt(fail.promptId, { status: "failed", error: fail.error });
  //       }
  //       if (pollingIdsRef.current.size > 0) setIsPolling(true);
  //     } catch (err) { console.error("Batch generate error:", err); }
  //     finally { setBatchGenerating(false); }
  //   },
  //   [seriesId, updatePrompt]
  // );

  /**
   * Generate a single image via the unified model-dispatching route.
   * Works for both flux2_dev and hunyuan3 — the route handles model
   * dispatch server-side based on story_series.image_model.
   */
  const generateOne = useCallback(
    async (promptId: string): Promise<void> => {
      updatePrompt(promptId, { status: "generating", error: null, critiqueText: null });
      try {
        const state = promptStates[promptId];

        // ── Final-prompt PATCH ──────────────────────────────────────────
        // The user edits final_prompt directly on the card. Persist any
        // pending edits before kicking off generation so Siray sees the
        // exact text the user is looking at. The other override fields
        // (character block, clothing, SFW constraint, visual signature)
        // are now consumed by Mistral as inputs and are not editable from
        // the card, so they don't need PATCHing here.
        if (state && state.finalPromptText !== state.savedFinalPromptText) {
          const patchRes = await fetch(
            `/api/stories/images/${promptId}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ final_prompt: state.finalPromptText }),
            }
          );
          if (!patchRes.ok) {
            const patchErr = await patchRes.json().catch(() => ({}));
            updatePrompt(promptId, {
              status: "failed",
              error: patchErr?.error ?? "Failed to save final prompt edit",
            });
            return;
          }
          updatePrompt(promptId, { savedFinalPromptText: state.finalPromptText });
        }

        const res = await fetch(
          `/api/stories/${seriesId}/generate-image`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ promptId }),
          }
        );
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const msg =
            data?.error ??
            (res.status === 501
              ? "Generation backend not yet implemented"
              : "Generation failed");
          updatePrompt(promptId, { status: "failed", error: msg });
          return;
        }

        // If the route auto-drafted final_prompt server-side (because the
        // user clicked Generate before ever drafting), pull the new text
        // into the editor so the textarea fills in immediately.
        if (data?.auto_drafted) {
          try {
            const refetch = await fetch(`/api/stories/images/${promptId}`);
            if (refetch.ok) {
              const row = await refetch.json();
              if (row?.final_prompt) {
                updatePrompt(promptId, {
                  finalPromptText: row.final_prompt,
                  savedFinalPromptText: row.final_prompt,
                  finalPromptDraftedAt: row.final_prompt_drafted_at ?? null,
                });
              }
            }
          } catch {
            // non-fatal — the row will pick up final_prompt on next page load
          }
        }

        // Sync success path (Replicate-style) — response includes image URL.
        if (data?.imageUrl) {
          updatePrompt(promptId, {
            status: "generated",
            imageUrl: data.imageUrl,
            error: null,
          });
          // Trigger critique asynchronously — don't block the generation UI
          // feedback. critiqueLoading goes true, then resolves in the background.
          void (async () => {
            updatePrompt(promptId, { critiqueLoading: true, critiqueText: null });
            try {
              const critiqueRes = await fetch(
                `/api/stories/images/${promptId}/critique`,
                { method: "POST" }
              );
              if (critiqueRes.ok) {
                const critiqueData = await critiqueRes.json();
                updatePrompt(promptId, {
                  critiqueText: critiqueData.critique ?? null,
                  critiqueLoading: false,
                });
              } else {
                updatePrompt(promptId, { critiqueLoading: false });
              }
            } catch {
              updatePrompt(promptId, { critiqueLoading: false });
            }
          })();
          return;
        }

        // Async success path (RunPod-style) — response includes jobId to poll.
        if (data?.jobId) {
          promptToJobIdRef.current.set(promptId, data.jobId);
          pollingIdsRef.current.add(promptId);
          setIsPolling(true);
          return;
        }

        updatePrompt(promptId, {
          status: "failed",
          error: "Generation response missing imageUrl/jobId",
        });
      } catch (err) {
        updatePrompt(promptId, {
          status: "failed",
          error: err instanceof Error ? err.message : "Generation failed",
        });
      }
    },
    [seriesId, updatePrompt, promptStates, imageModel]
  );

  /** Generate all eligible prompts sequentially. */
  const handleBatchGenerate = useCallback(
    async (postId?: string, regenerate?: boolean) => {
      const eligible: string[] = [];
      const targetPosts = postId ? posts.filter((p) => p.id === postId) : posts;
      for (const post of targetPosts) {
        for (const ip of post.story_image_prompts) {
          const status = promptStates[ip.id]?.status || ip.status;
          if (
            status === "pending" ||
            status === "failed" ||
            (regenerate && status === "generated")
          ) {
            eligible.push(ip.id);
          }
        }
      }

      if (eligible.length === 0) return;

      setBatchGenerating(true);
      setBatchProgress({ current: 0, total: eligible.length });
      try {
        for (let i = 0; i < eligible.length; i++) {
          setBatchProgress({ current: i + 1, total: eligible.length });
          await generateOne(eligible[i]);
        }
      } finally {
        setBatchGenerating(false);
        setBatchProgress(null);
      }
    },
    [posts, promptStates, generateOne]
  );

  const handleRegenerate = useCallback(
    (promptId: string) => {
      void generateOne(promptId);
    },
    [generateOne]
  );

  const handleApprove = useCallback(
    async (promptId: string) => {
      updatePrompt(promptId, { error: null });

      try {
        const res = await fetch(
          `/api/stories/images/${promptId}/approve`,
          { method: "POST" }
        );

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Approval failed");
        }

        const data = await res.json();
        updatePrompt(promptId, {
          status: "approved",
          imageUrl: data.stored_url || promptStates[promptId]?.imageUrl,
        });
      } catch (err) {
        updatePrompt(promptId, {
          error: err instanceof Error ? err.message : "Approval failed",
        });
      }
    },
    [promptStates, updatePrompt]
  );

  const handleRevert = useCallback(
    async (promptId: string) => {
      const state = promptStates[promptId];
      if (!state?.previousImageId) return;

      updatePrompt(promptId, { isReverting: true, error: null });

      try {
        const res = await fetch(
          `/api/stories/images/${promptId}/revert`,
          { method: "POST" }
        );

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Revert failed");
        }

        const data = await res.json();
        // API swaps current ↔ previous in the DB, so the user
        // can toggle back and forth between the two images
        updatePrompt(promptId, {
          status: "generated",
          imageUrl: data.imageUrl || null,
          // The old current image is now the previous
          previousImageId: state.previousImageId,
          isReverting: false,
        });
      } catch (err) {
        updatePrompt(promptId, {
          isReverting: false,
          error: err instanceof Error ? err.message : "Revert failed",
        });
      }
    },
    [promptStates, updatePrompt]
  );

  const handleSetHero = useCallback(
    async (postId: string, promptId: string) => {
      // Toggle: clicking the currently-flagged hero clears it; clicking
      // any other facebook_sfw image promotes it to hero.
      const current = heroByPost[postId] ?? null;
      const nextHero = current === promptId ? null : promptId;

      // Optimistic update so the badge moves immediately. We roll back
      // on failure.
      setHeroByPost((prev) => ({ ...prev, [postId]: nextHero }));

      try {
        const res = await fetch(
          `/api/stories/posts/${postId}/set-hero`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ promptId: nextHero }),
          }
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || "Failed to set hero");
        }
      } catch (err) {
        setHeroByPost((prev) => ({ ...prev, [postId]: current }));
        updatePrompt(promptId, {
          error:
            err instanceof Error ? err.message : "Failed to set chapter hero",
        });
      }
    },
    [heroByPost, updatePrompt]
  );

  const handleDelete = useCallback(async (promptId: string) => {
    if (!window.confirm("Remove this image from the story? This cannot be undone.")) return;
    const res = await fetch(`/api/stories/images/${promptId}`, { method: "DELETE" });
    if (res.ok) {
      setDeletedPromptIds((prev) => new Set(prev).add(promptId));
    } else {
      const err = await res.json().catch(() => ({}));
      updatePrompt(promptId, { error: err?.error ?? "Delete failed" });
    }
  }, [updatePrompt]);

  const handleApproveAllGenerated = useCallback(async () => {
    const toApprove = Object.entries(promptStates)
      .filter(([, s]) => s.status === "generated")
      .map(([id]) => id);

    if (toApprove.length === 0) return;

    setBatchApproving(true);

    const results = await Promise.allSettled(
      toApprove.map(async (promptId) => {
        const res = await fetch(
          `/api/stories/images/${promptId}/approve`,
          { method: "POST" }
        );
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Approval failed");
        }
        const data = await res.json();
        return { promptId, storedUrl: data.stored_url };
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        updatePrompt(result.value.promptId, {
          status: "approved",
          imageUrl:
            result.value.storedUrl ||
            promptStates[result.value.promptId]?.imageUrl,
        });
      } else {
        // Find the promptId from the failed batch — can't easily extract
        // so just log. Individual errors will be visible on cards.
      }
    }

    setBatchApproving(false);
  }, [promptStates, updatePrompt]);

  const togglePost = useCallback((postId: string) => {
    setCollapsedPosts((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return next;
    });
  }, []);

  // ---- Derived counts ----

  const allPromptIds = Object.keys(promptStates).filter(
    (id) => !deletedPromptIds.has(id)
  );
  const counts = {
    total: allPromptIds.length,
    pending: allPromptIds.filter((id) => promptStates[id].status === "pending")
      .length,
    generating: allPromptIds.filter(
      (id) => promptStates[id].status === "generating"
    ).length,
    generated: allPromptIds.filter(
      (id) => promptStates[id].status === "generated"
    ).length,
    approved: allPromptIds.filter(
      (id) => promptStates[id].status === "approved"
    ).length,
    failed: allPromptIds.filter((id) => promptStates[id].status === "failed")
      .length,
  };

  const progressPct =
    counts.total > 0 ? Math.round((counts.approved / counts.total) * 100) : 0;

  // ---- Guard: characters not approved ----

  if (!allCharactersApproved) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Users className="mb-4 h-12 w-12 text-yellow-400" />
        <h3 className="mb-2 text-lg font-semibold">
          All Characters Must Be Approved First
        </h3>
        <p className="max-w-md text-sm text-muted-foreground">
          Character portraits must be finalized before generating story images.
          This ensures visual consistency across all scenes.
        </p>
      </div>
    );
  }

  // ---- Render ----

  return (
    <div className="space-y-6">
      {/* ======== TOP CONTROLS ======== */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Generate All */}
          <Button
            onClick={() => handleBatchGenerate()}
            disabled={batchGenerating || (counts.pending + counts.failed === 0)}
          >
            {batchGenerating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            {batchGenerating
              ? "Submitting..."
              : `Generate All Images (${counts.pending + counts.failed})`}
          </Button>

          {/* Regenerate All — re-generates already-generated images */}
          {counts.generated > 0 && (
            <Button
              variant="outline"
              onClick={() => handleBatchGenerate(undefined, true)}
              disabled={batchGenerating}
            >
              {batchGenerating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Regenerate All ({counts.generated})
            </Button>
          )}

          {/* Generate Chapter */}
          <div className="flex items-center gap-2">
            <Select value={selectedChapter} onValueChange={setSelectedChapter}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Select chapter..." />
              </SelectTrigger>
              <SelectContent>
                {posts.map((post) => (
                  <SelectItem key={post.id} value={post.id}>
                    Part {post.part_number}: {post.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              disabled={!selectedChapter || batchGenerating}
              onClick={() => {
                if (selectedChapter) handleBatchGenerate(selectedChapter);
              }}
            >
              <Zap className="mr-1.5 h-3.5 w-3.5" />
              Generate
            </Button>
          </div>

          {/* Approve All Generated */}
          {counts.generated > 0 && (
            <Button
              variant="outline"
              onClick={handleApproveAllGenerated}
              disabled={batchApproving}
              className="ml-auto"
            >
              {batchApproving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              Approve All Generated ({counts.generated})
            </Button>
          )}
        </div>

        {/* ART DIRECTOR POD STATUS — DEACTIVATED 2026-04-19
            Replaced by a simple batch-progress indicator. The Qwen VL pod
            is no longer required for story image generation. */}
        {batchProgress && (
          <div className="flex items-center gap-3 rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
            <span className="text-xs text-blue-400 font-medium">
              Generating image {batchProgress.current} of {batchProgress.total}
            </span>
          </div>
        )}

        {/* Progress summary */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-medium">
              {counts.approved} of {counts.total} images approved
            </span>
            <span className="text-muted-foreground">|</span>
            {counts.generating > 0 && (
              <>
                <span className="text-blue-400">
                  {counts.generating} generating
                </span>
                <span className="text-muted-foreground">|</span>
              </>
            )}
            {counts.generated > 0 && (
              <>
                <span className="text-amber-400">
                  {counts.generated} ready to approve
                </span>
                <span className="text-muted-foreground">|</span>
              </>
            )}
            {counts.failed > 0 && (
              <>
                <span className="text-red-400">{counts.failed} failed</span>
                <span className="text-muted-foreground">|</span>
              </>
            )}
            <span className="text-muted-foreground">
              {counts.pending} pending
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-green-500 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* ======== POST SECTIONS ======== */}
      {posts.map((post) => {
        const isCollapsed = collapsedPosts.has(post.id);
        const prompts = post.story_image_prompts.filter(
          (ip) => !deletedPromptIds.has(ip.id)
        );

        // Count by type
        const typeCounts: Record<string, number> = {};
        for (const ip of prompts) {
          typeCounts[ip.image_type] = (typeCounts[ip.image_type] || 0) + 1;
        }

        const typeBreakdown = Object.entries(typeCounts)
          .map(([type, count]) => {
            const cfg = IMAGE_TYPE_CONFIG[type];
            return cfg ? `${count} ${cfg.shortLabel}` : `${count} ${type}`;
          })
          .join(", ");

        return (
          <div key={post.id}>
            {/* Post header */}
            <button
              onClick={() => togglePost(post.id)}
              className="flex w-full items-center gap-2 rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/50"
            >
              {isCollapsed ? (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                {post.part_number}
              </span>
              <span className="font-medium text-sm truncate">
                {post.title}
              </span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {typeBreakdown}
              </span>
            </button>

            {/* Post content */}
            {!isCollapsed && (() => {
              // Per-post helper map for orphan detection. Used by the
              // website_nsfw_paired cards to flag rows whose own
              // position_after_word is null AND whose paired SFW
              // partner has no position_after_word either — those would
              // be silently skipped by the website chapter renderer.
              const positionAfterWordById: Record<string, number | null> = {};
              for (const ip of prompts) {
                positionAfterWordById[ip.id] = ip.position_after_word;
              }
              const heroPromptId = heroByPost[post.id] ?? null;

              return (
                <div className="mt-3 space-y-5 pl-2">
                  {(
                    ["facebook_sfw", "website_nsfw_paired", "website_only"] as const
                  ).map((imageType) => {
                    const typePrompts = prompts.filter(
                      (ip) => ip.image_type === imageType
                    );
                    if (typePrompts.length === 0) return null;

                    const cfg = IMAGE_TYPE_CONFIG[imageType];

                    // For the SFW header: show the currently-flagged hero
                    // (or a warning when none is set). Hero is a facebook_sfw
                    // concept — the badge only renders on that subgroup.
                    let heroSummary: ReactNode = null;
                    if (imageType === "facebook_sfw") {
                      const heroPrompt = heroPromptId
                        ? typePrompts.find((ip) => ip.id === heroPromptId)
                        : null;
                      if (heroPrompt) {
                        const names = [
                          heroPrompt.character_name,
                          heroPrompt.secondary_character_name,
                        ]
                          .filter(Boolean)
                          .join(" + ");
                        heroSummary = (
                          <span className="ml-2 inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                            <Star className="h-3 w-3 fill-amber-300" />
                            Hero: {names || "selected"}
                          </span>
                        );
                      } else {
                        heroSummary = (
                          <span className="ml-2 inline-flex items-center gap-1 rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
                            <AlertCircle className="h-3 w-3" />
                            No hero set
                          </span>
                        );
                      }
                    }

                    return (
                      <div key={imageType}>
                        {/* Type header */}
                        <h4 className="mb-3 text-sm font-medium text-muted-foreground">
                          {cfg.emoji} {cfg.label}{" "}
                          <span className="text-xs">({typePrompts.length})</span>
                          {heroSummary}
                        </h4>

                        {/* Image grid */}
                        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                          {typePrompts.map((ip) => {
                            const isHero =
                              imageType === "facebook_sfw" &&
                              heroPromptId === ip.id;

                            // Orphan: paired NSFW image with no resolvable
                            // position. Will be silently skipped by the
                            // website renderer; surface that here so
                            // editors can spot it before publish.
                            let isOrphan = false;
                            if (imageType === "website_nsfw_paired") {
                              const ownPos = ip.position_after_word;
                              if (ownPos == null) {
                                if (!ip.pairs_with) {
                                  isOrphan = true;
                                } else {
                                  const partnerPos =
                                    positionAfterWordById[ip.pairs_with];
                                  if (partnerPos == null) isOrphan = true;
                                }
                              }
                            }

                            return (
                              <ImageCard
                                key={ip.id}
                                prompt={ip}
                                state={promptStates[ip.id]}
                                imageType={imageType}
                                promptPositionMap={promptPositionMap.current}
                                onRegenerate={handleRegenerate}
                                onApprove={handleApprove}
                                onRevert={handleRevert}
                                onArtDirector={handleRegenerate}
                                onDelete={handleDelete}
                                onOpenDetail={setSelectedPromptId}
                                onSetHero={() =>
                                  void handleSetHero(post.id, ip.id)
                                }
                                isHero={isHero}
                                isOrphan={isOrphan}
                                batchGenerating={batchGenerating}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        );
      })}

      {/* ======== LIGHTBOX ======== */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="Full size preview"
            className="max-h-[95vh] max-w-[95vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* ======== DETAIL MODAL ======== */}
      {(() => {
        if (!selectedPromptId) return null;
        const idx = orderedPromptList.findIndex(
          (p) => p.ip.id === selectedPromptId
        );
        if (idx === -1) return null;
        const entry = orderedPromptList[idx];
        const detailState = promptStates[selectedPromptId];
        if (!detailState) return null;
        return (
          <ImageDetailModal
            ip={entry.ip}
            imageType={entry.imageType}
            postTitle={entry.postTitle}
            state={detailState}
            hasPrev={idx > 0}
            hasNext={idx < orderedPromptList.length - 1}
            indexLabel={`${idx + 1} of ${orderedPromptList.length}`}
            onClose={() => setSelectedPromptId(null)}
            onPrev={async () => {
              await handleSaveAll(selectedPromptId);
              setSelectedPromptId(orderedPromptList[idx - 1].ip.id);
            }}
            onNext={async () => {
              await handleSaveAll(selectedPromptId);
              setSelectedPromptId(orderedPromptList[idx + 1].ip.id);
            }}
            onUpdatePrompt={updatePrompt}
            onSaveAll={handleSaveAll}
            onRegenerate={handleRegenerate}
            onApprove={handleApprove}
            onRevert={handleRevert}
            onDelete={(id) => {
              handleDelete(id);
              setSelectedPromptId(null);
            }}
            onLightbox={setLightboxUrl}
            onDraftFinalPrompt={draftFinalPrompt}
            batchGenerating={batchGenerating}
            imageModel={imageModel}
            characterIdentityMap={characterIdentityMap}
            onNavigateToCharacters={onNavigateToCharacters}
            poseTemplates={poseTemplates}
          />
        );
      })()}

      {/* ======== ART DIRECTOR MODAL ========
          DEACTIVATED 2026-04-19. The modal has been replaced by direct
          generation via /api/stories/[seriesId]/generate-image, which
          dispatches to the correct backend (Flux 2 Dev or HunyuanImage
          3.0) based on story_series.image_model. The original modal
          code lives in ./ArtDirectorModal and the /api/art-director/*
          routes remain functional. To reactivate, restore the import
          at the top of this file and the block below. */}
    </div>
  );
}

// ---------------------------------------------------------------------------
// (LockedCharacterBlock + assembleFullPrompt removed)
//
// The modal no longer renders the per-image character-block override UI —
// Mistral now drafts the final prompt from the structured character
// description + scene description. The "Inputs Mistral consumed" disclosure
// in the modal shows the same context as read-only text. The override fields
// (character_block_override, secondary_character_block_override, suppress_character_block,
// clothing_override, sfw_constraint_override, visual_signature_override) still
// exist on the DB row but are no longer surfaced for editing in the dashboard.
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// ImageCard sub-component
// ---------------------------------------------------------------------------

interface ImageCardProps {
  prompt: ImagePromptData;
  state: PromptState | undefined;
  imageType: string;
  promptPositionMap: Record<string, number>;
  onRegenerate: (id: string) => void;
  onApprove: (id: string) => void;
  onRevert: (id: string) => void;
  onArtDirector: (promptId: string) => void;
  onDelete: (promptId: string) => void;
  onOpenDetail: (promptId: string) => void;
  onSetHero?: () => void;
  isHero?: boolean;
  isOrphan?: boolean;
  batchGenerating: boolean;
}

function ImageCard({
  prompt: ip,
  state,
  imageType,
  promptPositionMap,
  onRegenerate,
  onApprove,
  onRevert,
  onArtDirector,
  onDelete,
  onOpenDetail,
  onSetHero,
  isHero = false,
  isOrphan = false,
  batchGenerating,
}: ImageCardProps) {
  if (!state) return null;

  const statusStyle =
    STATUS_STYLES[state.status] || STATUS_STYLES.pending;
  const hasImage = !!state.imageUrl;
  const isGenerating = state.status === "generating";
  const isGenerated = state.status === "generated";
  const isApproved = state.status === "approved";
  const isFailed = state.status === "failed";
  const isPending = state.status === "pending";

  // Build meta indicator
  let metaLabel: string | null = null;
  if (imageType === "website_nsfw_paired" && ip.pairs_with) {
    const pairedPos = promptPositionMap[ip.pairs_with];
    metaLabel =
      pairedPos != null
        ? `Pairs with Facebook #${pairedPos}`
        : "Paired with SFW";
  } else if (imageType === "website_only" && ip.position_after_word != null) {
    metaLabel = `After word ~${ip.position_after_word}`;
  }

  // Truncated prompt for collapsed view
  const truncatedPrompt =
    state.promptText.length > 100
      ? state.promptText.slice(0, 100) + "..."
      : state.promptText;

  // Aspect ratio mirrors the rule in /api/stories/[seriesId]/generate-image/route.ts:
  // two-character scenes are landscape 5:4, single/none are portrait 4:5.
  const isTwoCharacter = Boolean(ip.character_id && ip.secondary_character_id);
  const ratioLabel = isTwoCharacter ? "5:4" : "4:5";
  const ratioCss = isTwoCharacter ? "5 / 4" : "4 / 5";

  return (
    <Card
      className={`overflow-visible transition-colors ${
        isHero
          ? "border-amber-400 ring-2 ring-amber-400/40"
          : isApproved
          ? "border-green-500/30"
          : isGenerated
            ? "border-amber-500/30"
            : isFailed
              ? "border-red-500/30"
              : ""
      }`}
    >
      <div>
        {/* Image area — clicking anywhere opens the detail modal where
            the user can edit prompts and see the enlarged image. */}
        <div
          className="relative bg-muted/30 cursor-pointer"
          style={{ aspectRatio: ratioCss }}
          onClick={() => onOpenDetail(ip.id)}
        >
          {isGenerating ? (
            <div className="flex flex-col items-center justify-center absolute inset-0">
              <Loader2 className="mb-2 h-8 w-8 animate-spin text-blue-400" />
              <p className="text-xs text-blue-400">Generating...</p>
            </div>
          ) : hasImage ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={state.imageUrl!}
                alt={`${imageType} image${ip.character_name ? ` - ${ip.character_name}` : ""}`}
                className="h-full w-full object-cover"
              />
              {isApproved && (
                <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-green-600/90 px-2 py-1 text-[10px] font-medium text-white shadow backdrop-blur-sm">
                  <Check className="h-3 w-3" />
                  Approved
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center absolute inset-0">
              <div className="mb-2 h-10 w-10 rounded-lg bg-muted/50 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-muted-foreground/50" />
              </div>
              <p className="text-xs text-muted-foreground">Not generated</p>
            </div>
          )}
          {/* Aspect-ratio badge — bottom-left so it doesn't collide with the
              top-right Approved pill. */}
          <div className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-sm">
            {ratioLabel}
          </div>
        </div>

        {/* Controls area */}
        <CardContent className="p-0">
          {/* Zone 1: always-visible header */}
          <div className="space-y-2.5 p-3">
          {/* Status + meta row */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className={`text-[10px] px-1.5 py-0 ${statusStyle.className}`}
            >
              {statusStyle.label}
            </Badge>
            {ip.character_name && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 bg-purple-500/20 text-purple-400 border-purple-500/30"
              >
                {ip.character_name}
              </Badge>
            )}
            {metaLabel && (
              <span className="text-[10px] text-muted-foreground">
                {metaLabel}
              </span>
            )}
            {(state.characterBlockOverride !== null || state.secondaryCharacterBlockOverride !== null) && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 bg-amber-500/20 text-amber-400 border-amber-500/30"
              >
                Custom char block
              </Badge>
            )}
            {state.suppressCharacterBlock && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 bg-zinc-700/20 text-zinc-400 border-zinc-700/40"
              >
                No char injection
              </Badge>
            )}
            {isHero && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 bg-amber-500/20 text-amber-300 border-amber-500/40"
              >
                <Star className="mr-1 h-3 w-3 fill-amber-300" />
                Chapter hero
              </Badge>
            )}
            {isOrphan && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 bg-red-500/15 text-red-300 border-red-500/40"
                title="This NSFW image has no resolvable position — neither its own position_after_word nor its paired SFW partner's. The website chapter renderer will skip it."
              >
                <AlertCircle className="mr-1 h-3 w-3" />
                Won&apos;t render — no position
              </Badge>
            )}
          </div>

          {/* Error */}
          {state.error && (
            <div className="flex items-start gap-1.5 rounded bg-red-500/10 p-2 text-[11px] text-red-400">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              {state.error}
            </div>
          )}

          {/* AI Critique panel — appears after generation, always visible */}
          {(state.critiqueLoading || state.critiqueText) && (
            <div className="rounded border border-zinc-700/40 bg-zinc-900/40 p-2">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-zinc-400">
                <Eye className="h-3 w-3" />
                AI Critique
                <span className="text-zinc-600">· Pixtral</span>
              </div>
              {state.critiqueLoading ? (
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Analysing image…
                </div>
              ) : (
                <p className="text-[11px] leading-relaxed text-zinc-300">
                  {state.critiqueText}
                </p>
              )}
            </div>
          )}

          {/* Prompt preview — clicking opens the detail modal where the
              user edits all prompt fields. */}
          <button
            onClick={() => onOpenDetail(ip.id)}
            className="block w-full text-left text-[11px] leading-relaxed text-muted-foreground hover:text-foreground transition-colors"
          >
            {truncatedPrompt}
          </button>
          </div>

          {/* Zone 2: scrollable editing area */}
          {/* Zone 3: sticky action buttons */}
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-border/50 bg-card/95 px-3 py-2 backdrop-blur-sm">
            {imageType === "facebook_sfw" && onSetHero && (
              <Button
                variant={isHero ? "default" : "outline"}
                size="sm"
                className={`h-7 text-xs ${
                  isHero
                    ? "bg-amber-500 text-amber-950 hover:bg-amber-400"
                    : ""
                }`}
                onClick={onSetHero}
                title={
                  isHero
                    ? "Click to unset as chapter hero"
                    : "Set this image as the chapter hero (replaces any other hero on this chapter)"
                }
              >
                <Star
                  className={`mr-1.5 h-4 w-4 ${isHero ? "fill-amber-950" : ""}`}
                />
                {isHero ? "Hero" : "Set as hero"}
              </Button>
            )}
            {/* Generate / Regenerate — calls the unified /generate-image route (dispatches on image_model) */}
            {(isPending || isFailed) && (
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => onArtDirector(ip.id)}
                disabled={batchGenerating}
              >
                <Sparkles className="mr-1.5 h-4 w-4" />
                {isFailed ? "Retry" : "Generate"}
              </Button>
            )}
            {(isGenerated) && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onArtDirector(ip.id)}
              >
                <RefreshCw className="mr-1.5 h-4 w-4" />
                Regenerate
              </Button>
            )}
            {isGenerated && state.previousImageId && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs text-orange-400 border-orange-500/30 hover:bg-orange-500/10"
                onClick={() => onRevert(ip.id)}
                disabled={state.isReverting}
              >
                {state.isReverting ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Undo2 className="mr-1.5 h-4 w-4" />
                )}
                Revert
              </Button>
            )}
            {isGenerated && (
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 h-7 text-xs"
                onClick={() => onApprove(ip.id)}
              >
                <Check className="mr-1.5 h-4 w-4" />
                Approve
              </Button>
            )}
            {isApproved && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-green-400 border-green-500/30 h-7 text-xs"
                  disabled
                >
                  <Check className="mr-1.5 h-4 w-4" />
                  Approved
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => onArtDirector(ip.id)}
                  disabled={batchGenerating}
                >
                  <RefreshCw className="mr-1.5 h-4 w-4" />
                  Regenerate
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7 px-2 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 text-[11px] gap-1"
              title="Remove from story"
              onClick={() => onDelete(ip.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
        </CardContent>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// ImageDetailModal — full-screen editor surface for a single prompt.
// Click a card to open. Image + AI critique on the left, all prompt fields
// expanded on the right, the assembled prompt-to-model pinned below the
// editor at all times. Keyboard: Esc to close, ⌘S to save, ⌘↵ to generate,
// ←/→ to switch prompts (auto-saves first).
// ---------------------------------------------------------------------------

interface ImageDetailModalProps {
  ip: ImagePromptData;
  imageType: string;
  postTitle: string;
  state: PromptState;
  hasPrev: boolean;
  hasNext: boolean;
  indexLabel: string;
  onClose: () => void;
  onPrev: () => Promise<void> | void;
  onNext: () => Promise<void> | void;
  onUpdatePrompt: (id: string, updates: Partial<PromptState>) => void;
  onSaveAll: (id: string) => Promise<boolean>;
  onRegenerate: (id: string) => void;
  onApprove: (id: string) => void;
  onRevert: (id: string) => void;
  onDelete: (id: string) => void;
  onLightbox: (url: string) => void;
  onDraftFinalPrompt: (id: string) => Promise<void>;
  batchGenerating: boolean;
  imageModel: ImageModel;
  characterIdentityMap: Record<string, CharacterIdentity>;
  onNavigateToCharacters: () => void;
  poseTemplates: PoseTemplate[];
}

function ImageDetailModal({
  ip,
  imageType,
  postTitle,
  state,
  hasPrev,
  hasNext,
  indexLabel,
  onClose,
  onPrev,
  onNext,
  onUpdatePrompt,
  onSaveAll,
  onRegenerate,
  onApprove,
  onRevert,
  onDelete,
  onLightbox,
  onDraftFinalPrompt,
  batchGenerating,
  imageModel: _imageModel,
  characterIdentityMap,
  onNavigateToCharacters: _onNavigateToCharacters,
  poseTemplates,
}: ImageDetailModalProps) {
  const isGenerating = state.status === "generating";
  const isGenerated = state.status === "generated";
  const isApproved = state.status === "approved";
  const isFailed = state.status === "failed";
  const isPending = state.status === "pending";
  const isSfw = imageType === "facebook_sfw" || imageType === "shared";

  // Only the editable final_prompt textarea contributes to "dirty" now —
  // every other field on this card is read-only context that Mistral
  // consumed when drafting.
  const isDirty = state.finalPromptText !== state.savedFinalPromptText;

  const isTwoCharacter = Boolean(ip.character_id && ip.secondary_character_id);
  const ratioLabel = isTwoCharacter ? "5:4" : "4:5";
  const ratioCss = isTwoCharacter ? "5 / 4" : "4 / 5";

  const statusStyle = STATUS_STYLES[state.status] || STATUS_STYLES.pending;
  const cfg = IMAGE_TYPE_CONFIG[imageType];
  const charNames = [ip.character_name, ip.secondary_character_name]
    .filter(Boolean)
    .join(" + ");

  const hasFinalPrompt = state.finalPromptText.trim().length > 0;

  const closeWithConfirm = useCallback(() => {
    if (isDirty) {
      const ok = window.confirm(
        "You have unsaved edits. Discard them and close?"
      );
      if (!ok) return;
    }
    onClose();
  }, [isDirty, onClose]);

  // Keyboard shortcuts. ←/→ is suppressed when the user is typing in a
  // textarea/input so it doesn't fight cursor movement.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      const inField =
        tgt &&
        (tgt.tagName === "TEXTAREA" ||
          tgt.tagName === "INPUT" ||
          tgt.isContentEditable);

      if (e.key === "Escape") {
        e.preventDefault();
        closeWithConfirm();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (isDirty && !state.savingPrompt) onSaveAll(ip.id);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (!isGenerating && !batchGenerating) onRegenerate(ip.id);
        return;
      }
      if (!inField) {
        if (e.key === "ArrowLeft" && hasPrev) {
          e.preventDefault();
          onPrev();
        } else if (e.key === "ArrowRight" && hasNext) {
          e.preventDefault();
          onNext();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [
    ip.id,
    isDirty,
    isGenerating,
    batchGenerating,
    hasPrev,
    hasNext,
    state.savingPrompt,
    closeWithConfirm,
    onSaveAll,
    onRegenerate,
    onPrev,
    onNext,
  ]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={closeWithConfirm}
    >
      <div
        className="flex w-full max-w-[1500px] max-h-[95vh] flex-col rounded-lg border bg-card shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border/50 px-4 py-2.5 shrink-0">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2 text-xs text-muted-foreground truncate">
              <span className="font-medium text-foreground truncate">{postTitle}</span>
              <span>·</span>
              <span>{cfg?.emoji} {cfg?.label || imageType}</span>
              <span>·</span>
              <span>{ratioLabel}</span>
              {charNames && (
                <>
                  <span>·</span>
                  <span>{charNames}</span>
                </>
              )}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <Badge
                variant="outline"
                className={`text-[10px] px-1.5 py-0 ${statusStyle.className}`}
              >
                {statusStyle.label}
              </Badge>
              <span className="text-[10px] text-muted-foreground">{indexLabel}</span>
              {isDirty && (
                <span className="text-[10px] text-amber-400">• Unsaved</span>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            disabled={!hasPrev}
            onClick={() => onPrev()}
            title="Previous (←)"
          >
            <ChevronRight className="h-4 w-4 rotate-180" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            disabled={!hasNext}
            onClick={() => onNext()}
            title="Next (→)"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={closeWithConfirm}
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Image pane */}
          <div className="flex w-1/2 flex-col gap-3 overflow-y-auto bg-muted/5 p-4 border-r border-border/50">
            <div
              className="relative overflow-hidden rounded-lg bg-muted/30"
              style={{ aspectRatio: ratioCss }}
            >
              {isGenerating ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <Loader2 className="mb-2 h-10 w-10 animate-spin text-blue-400" />
                  <p className="text-sm text-blue-400">Generating...</p>
                </div>
              ) : state.imageUrl ? (
                <button
                  type="button"
                  onClick={() => onLightbox(state.imageUrl!)}
                  className="block h-full w-full"
                  title="Click to view full size"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={state.imageUrl}
                    alt={`${imageType} image${ip.character_name ? ` - ${ip.character_name}` : ""}`}
                    className="h-full w-full object-contain"
                  />
                </button>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className="mb-2 h-12 w-12 rounded-lg bg-muted/50 flex items-center justify-center">
                    <Sparkles className="h-6 w-6 text-muted-foreground/50" />
                  </div>
                  <p className="text-sm text-muted-foreground">Not generated</p>
                </div>
              )}
              <div className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-sm">
                {ratioLabel}
              </div>
            </div>

            {state.error && (
              <div className="flex items-start gap-1.5 rounded bg-red-500/10 p-2 text-xs text-red-400">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                {state.error}
              </div>
            )}

            {(state.critiqueLoading || state.critiqueText) && (
              <div className="rounded border border-zinc-700/40 bg-zinc-900/40 p-3">
                <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-zinc-400">
                  <Eye className="h-3 w-3" />
                  AI Critique
                  <span className="text-zinc-600">· Pixtral</span>
                </div>
                {state.critiqueLoading ? (
                  <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Analysing image…
                  </div>
                ) : (
                  <p className="text-xs leading-relaxed text-zinc-300">
                    {state.critiqueText}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Editor pane */}
          <div className="flex w-1/2 min-w-0 flex-col">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* PRIMARY EDITABLE SURFACE — Mistral-drafted final prompt */}
              <div className="flex flex-col">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-baseline gap-2">
                    <label className="text-[11px] font-medium uppercase tracking-wide text-foreground">
                      Final prompt — sent to Siray
                    </label>
                    {state.finalPromptDraftedAt && (
                      <span className="text-[10px] text-muted-foreground">
                        drafted {new Date(state.finalPromptDraftedAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {hasFinalPrompt && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[10px]"
                        onClick={() =>
                          navigator.clipboard.writeText(state.finalPromptText)
                        }
                      >
                        Copy
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => onDraftFinalPrompt(ip.id)}
                      disabled={
                        state.isDraftingFinalPrompt ||
                        isGenerating ||
                        isApproved
                      }
                      title={
                        state.critiqueText
                          ? "Mistral will receive the previous prompt + the AI critique and rewrite to address the issues"
                          : undefined
                      }
                    >
                      <Sparkles className="mr-1 h-3 w-3" />
                      {state.isDraftingFinalPrompt
                        ? "Drafting…"
                        : hasFinalPrompt
                          ? state.critiqueText
                            ? "Re-draft with critique"
                            : "Re-draft with Mistral"
                          : "Draft with Mistral"}
                    </Button>
                  </div>
                </div>
                {state.draftError && (
                  <div className="mb-1.5 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-200">
                    {state.draftError}
                  </div>
                )}
                <Textarea
                  value={state.finalPromptText}
                  onChange={(e) =>
                    onUpdatePrompt(ip.id, { finalPromptText: e.target.value })
                  }
                  placeholder={
                    hasFinalPrompt
                      ? ""
                      : "No prompt yet — click \"Draft with Mistral\" to generate one from the inputs below, or just click Generate (it will auto-draft first)."
                  }
                  className="resize-y bg-muted/30 text-xs leading-relaxed min-h-[420px]"
                  disabled={
                    isGenerating ||
                    isApproved ||
                    state.savingPrompt ||
                    state.isDraftingFinalPrompt
                  }
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  This text is sent verbatim to Siray when you click Generate. Edit it
                  freely — the inputs below are read-only context that Mistral consumed.
                </p>
              </div>

              {/* POSE TEMPLATE picker — editable, persists on change */}
              <PoseTemplatePicker
                templates={poseTemplates}
                selectedId={state.poseTemplateId}
                disabled={isGenerating || isApproved || state.savingPrompt}
                onChange={async (newId) => {
                  // Optimistically update local state, then PATCH.
                  onUpdatePrompt(ip.id, { poseTemplateId: newId });
                  try {
                    const res = await fetch(`/api/stories/images/${ip.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ pose_template_id: newId }),
                    });
                    if (res.ok) {
                      onUpdatePrompt(ip.id, { savedPoseTemplateId: newId });
                    } else {
                      // revert on failure
                      onUpdatePrompt(ip.id, {
                        poseTemplateId: state.savedPoseTemplateId,
                      });
                    }
                  } catch {
                    onUpdatePrompt(ip.id, {
                      poseTemplateId: state.savedPoseTemplateId,
                    });
                  }
                }}
              />

              {/* READ-ONLY INPUTS — what Mistral consumed when drafting */}
              <details className="rounded border border-border/50 bg-muted/10" open>
                <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Inputs Mistral consumed
                </summary>
                <div className="space-y-3 px-3 pb-3 pt-1">
                  <ReadOnlyField label="Scene description" value={state.promptText} />

                  <ReadOnlyCharacterBlock
                    label="Primary character (approved description)"
                    characterId={ip.character_id}
                    characterIdentityMap={characterIdentityMap}
                  />

                  {ip.secondary_character_id && (
                    <ReadOnlyCharacterBlock
                      label="Secondary character (approved description)"
                      characterId={ip.secondary_character_id}
                      characterIdentityMap={characterIdentityMap}
                    />
                  )}

                  {isSfw && (
                    <ReadOnlyField
                      label="Clothing"
                      value={
                        state.clothingOverride !== null
                          ? state.clothingOverride
                          : [ip.character_id, ip.secondary_character_id]
                              .filter(Boolean)
                              .map((id) => {
                                const ident = characterIdentityMap[id as string];
                                return ident?.name && ident?.clothing
                                  ? `${ident.name} is wearing ${ident.clothing}.`
                                  : null;
                              })
                              .filter(Boolean)
                              .join(" ") || "(no clothing in character description)"
                      }
                    />
                  )}

                  {isSfw && (
                    <ReadOnlyField
                      label="SFW constraint"
                      value={
                        state.sfwConstraintOverride ??
                        "Both characters fully clothed. No nudity."
                      }
                    />
                  )}

                  <ReadOnlyField
                    label="Visual signature"
                    value={state.visualSignatureOverride ?? VISUAL_SIGNATURE}
                  />
                </div>
              </details>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border/50 bg-card px-4 py-2.5 shrink-0">
          {(isPending || isFailed) && (
            <Button
              size="sm"
              onClick={() => onRegenerate(ip.id)}
              disabled={batchGenerating}
              className="text-xs"
            >
              <Sparkles className="mr-1.5 h-4 w-4" />
              {isFailed ? "Retry" : "Generate"}
              <span className="ml-1.5 text-[9px] opacity-70">⌘↵</span>
            </Button>
          )}
          {isGenerated && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRegenerate(ip.id)}
              disabled={batchGenerating}
              className="text-xs"
            >
              <RefreshCw className="mr-1.5 h-4 w-4" />
              Regenerate
              <span className="ml-1.5 text-[9px] opacity-70">⌘↵</span>
            </Button>
          )}
          {isGenerated && state.previousImageId && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRevert(ip.id)}
              disabled={state.isReverting}
              className="text-xs text-orange-400 border-orange-500/30 hover:bg-orange-500/10"
            >
              {state.isReverting ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Undo2 className="mr-1.5 h-4 w-4" />
              )}
              Revert
            </Button>
          )}
          {isGenerated && (
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-xs"
              onClick={() => onApprove(ip.id)}
            >
              <Check className="mr-1.5 h-4 w-4" />
              Approve
            </Button>
          )}
          {isApproved && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled
                className="text-green-400 border-green-500/30 text-xs"
              >
                <Check className="mr-1.5 h-4 w-4" />
                Approved
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onRegenerate(ip.id)}
                disabled={batchGenerating}
                className="text-xs"
              >
                <RefreshCw className="mr-1.5 h-4 w-4" />
                Regenerate
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => onSaveAll(ip.id)}
            disabled={
              !isDirty ||
              state.savingPrompt ||
              isGenerating ||
              isApproved
            }
            className="text-xs"
          >
            {state.savingPrompt
              ? "Saving..."
              : isDirty
                ? "Save"
                : state.promptSavedJust
                  ? "Saved"
                  : "Saved"}
            {isDirty && !state.savingPrompt && (
              <span className="ml-1.5 text-[9px] opacity-70">⌘S</span>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 text-[11px] gap-1"
            onClick={() => onDelete(ip.id)}
            title="Remove from story"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PoseTemplatePicker — dropdown of available pose templates plus a small
// preview of the selected template's reference image. Persists immediately
// on change via PATCH /api/stories/images/[promptId].
// ---------------------------------------------------------------------------

function PoseTemplatePicker({
  templates,
  selectedId,
  disabled,
  onChange,
}: {
  templates: PoseTemplate[];
  selectedId: string | null;
  disabled?: boolean;
  onChange: (newId: string | null) => void;
}) {
  const selected = selectedId
    ? templates.find((t) => t.id === selectedId) ?? null
    : null;

  return (
    <div className="rounded border border-border/50 bg-muted/10 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Pose template
        </label>
        <a
          href="/dashboard/pose-templates"
          target="_blank"
          rel="noreferrer"
          className="text-[10px] text-blue-400 hover:text-blue-300"
        >
          Manage templates →
        </a>
      </div>
      <select
        value={selectedId ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        className="w-full rounded border border-border/50 bg-muted/30 px-2 py-1.5 text-xs"
      >
        <option value="">— No pose template (Mistral picks pose) —</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {selected && (
        <div className="space-y-2">
          <div className="flex gap-3">
            {selected.reference_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={selected.reference_url}
                alt={selected.name}
                className="h-20 w-20 rounded border border-border/50 object-cover"
              />
            )}
            <p className="flex-1 text-[11px] leading-relaxed text-zinc-400 whitespace-pre-wrap">
              {selected.pose_description}
            </p>
          </div>
          <p className="text-[10px] leading-relaxed text-amber-400/80">
            {selected.send_image_to_model
              ? "Reference image WILL be sent to Siray as a 3rd i2i input — only safe for silhouettes / line drawings, otherwise the reference person's identity will bleed into the rendered character."
              : "Pose description text only — reference image is NOT sent to Siray (recommended for any photo-style reference). Toggle on the management page if your reference is identity-safe."}
          </p>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">
        Mistral writes the prompt around the chosen pose. The image-vs-text-only
        behaviour for Siray is controlled per-template on the management page.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReadOnlyField — small read-only display for one of Mistral's input
// fields (scene description, clothing, SFW constraint, visual signature).
// All shown together inside the "Inputs Mistral consumed" disclosure on
// the image card. Editing happens via the final_prompt textarea above.
// ---------------------------------------------------------------------------

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <div className="mt-1 rounded bg-zinc-900/40 px-2 py-1.5 text-[11px] leading-relaxed text-zinc-400 whitespace-pre-wrap">
        {value || "(empty)"}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReadOnlyCharacterBlock — read-only display of a linked character's
// approved description (sourced from `characters.description` via the
// page-level identity map). This is the same data Mistral receives when
// drafting; shown here so the user can see what context Mistral had.
// ---------------------------------------------------------------------------

function ReadOnlyCharacterBlock({
  label,
  characterId,
  characterIdentityMap,
}: {
  label: string;
  characterId: string | null;
  characterIdentityMap: Record<string, CharacterIdentity>;
}) {
  if (!characterId) return null;
  const ident = characterIdentityMap[characterId];
  const text =
    ident?.portraitPromptLocked ??
    (ident?.name ? `${ident.name} (no approved description on file)` : "(unknown character)");
  return <ReadOnlyField label={label} value={text} />;
}

