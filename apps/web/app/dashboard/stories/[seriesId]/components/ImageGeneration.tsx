"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
// Deep import from the specific submodule rather than the package barrel —
// the barrel re-exports server-only modules (Replicate SDK, sharp, RunPod
// fetch helpers) which would otherwise be dragged into the client bundle.
// `portrait-prompt-builder` is pure (no Node deps after Phase D's
// extraction of prompt-constants), so it's safe to import here.
import { buildSceneCharacterBlockFromLocked } from "@no-safe-word/image-gen/portrait-prompt-builder";
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
  Bug,
  Settings2,
  Undo2,
  Lock,
  Eye,
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
// Diagnostic flags for isolating scene generation components
// ---------------------------------------------------------------------------

interface DiagnosticFlags {
  characterLora: boolean;
  promptEnhancement: boolean;
  styleLoras: boolean;
  bodyShapeLora: boolean;
}

const DEFAULT_DIAGNOSTIC_FLAGS: DiagnosticFlags = {
  characterLora: true,
  promptEnhancement: true,
  styleLoras: true,
  bodyShapeLora: true,
};

const DIAGNOSTIC_TOGGLE_CONFIG: Array<{
  key: keyof DiagnosticFlags;
  label: string;
  group: string;
}> = [
  { key: "characterLora", label: "Character LoRA", group: "Character Identity" },
  { key: "promptEnhancement", label: "AI Enhancement", group: "Prompt Processing" },
  { key: "styleLoras", label: "Style LoRAs", group: "LoRA Stack" },
  { key: "bodyShapeLora", label: "Body Shape LoRA", group: "LoRA Stack" },
];

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
  showPrompt: boolean;
  error: string | null;
  diagnosticFlags: DiagnosticFlags;
  showDiagnostic: boolean;
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
  useRewriter: boolean;
  critiqueText: string | null;
  critiqueLoading: boolean;
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
  const [selectedChapter, setSelectedChapter] = useState<string>("");
  const [collapsedPosts, setCollapsedPosts] = useState<Set<string>>(
    new Set()
  );
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  // ART DIRECTOR — DEACTIVATED 2026-04-19 (see header comment)
  // Sequential batch progress tracked via `batchProgress` instead of the
  // Art Director queue.
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);

  // Build a lookup: promptId → position (for pairing indicators)
  const promptPositionMap = useRef<Record<string, number>>({});

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
          showPrompt: false,
          error: null,
          diagnosticFlags: { ...DEFAULT_DIAGNOSTIC_FLAGS },
          showDiagnostic: false,
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
          useRewriter: true,
          critiqueText: null,
          critiqueLoading: false,
        };

        // Collect "generating" prompts — we'll resolve their real status below
        if (ip.status === "generating") {
          staleGeneratingIds.push(ip.id);
        }
      }
    }

    promptPositionMap.current = posMap;
    setPromptStates(initial);

    // For prompts stuck as "generating" from a previous session, check their
    // actual status via the prompt status endpoint (which also persists
    // completed images). We don't have jobIds for these, so normal polling
    // would just leave them stuck.
    if (staleGeneratingIds.length > 0) {
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
            } else {
              // Still "generating" but no active job — reset to pending so user can retry
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
      );
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

        // ── Part A: Prompt Rewriter ──────────────────────────────────────
        // If the rewriter toggle is ON and the story uses Hunyuan, call the
        // rewrite API before patching. The rewritten prompt replaces the
        // user's current textbox content in both the UI and the DB.
        let promptTextToUse = state?.promptText ?? "";
        let promptWasRewritten = false;

        if (state?.useRewriter && imageModel === "hunyuan3") {
          const rewriteRes = await fetch(
            `/api/stories/images/${promptId}/rewrite`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ prompt: state.promptText }),
            }
          );
          if (!rewriteRes.ok) {
            const rewriteErr = await rewriteRes.json().catch(() => ({}));
            updatePrompt(promptId, {
              status: "failed",
              error: `Rewriter failed — ${rewriteErr?.error ?? "check MISTRAL_API_KEY"}. Disable the Rewrite toggle and retry with the original prompt.`,
            });
            return;
          }
          const rewriteData = await rewriteRes.json().catch(() => ({}));
          if (rewriteData?.rewrittenPrompt) {
            promptTextToUse = rewriteData.rewrittenPrompt;
            promptWasRewritten = true;
            // Update the textbox and mark the baseline in sync so the user
            // sees the rewritten version and a subsequent Regenerate click
            // won't re-patch the prompt unnecessarily.
            updatePrompt(promptId, {
              promptText: promptTextToUse,
              savedPromptText: promptTextToUse,
            });
          }
        }

        // ── Prompt PATCH ─────────────────────────────────────────────────
        // Persist if the prompt changed (either via rewrite or manual edit).
        // Note: `state` was captured before the rewrite; compare
        // `promptTextToUse` against the original savedPromptText.
        if (promptWasRewritten || (state && state.promptText !== state.savedPromptText)) {
          const patchRes = await fetch(
            `/api/stories/images/${promptId}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ prompt: promptTextToUse }),
            }
          );
          if (!patchRes.ok) {
            const patchErr = await patchRes.json().catch(() => ({}));
            updatePrompt(promptId, {
              status: "failed",
              error: patchErr?.error ?? "Failed to save prompt edit",
            });
            return;
          }
          if (!promptWasRewritten) {
            // Rewrite already set savedPromptText above
            updatePrompt(promptId, { savedPromptText: promptTextToUse });
          }
        }

        if (state && state.characterBlockOverride !== state.savedCharacterBlockOverride) {
          const overrideRes = await fetch(
            `/api/stories/images/${promptId}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ character_block_override: state.characterBlockOverride }),
            }
          );
          if (!overrideRes.ok) {
            const overrideErr = await overrideRes.json().catch(() => ({}));
            updatePrompt(promptId, {
              status: "failed",
              error: overrideErr?.error ?? "Failed to save character block override",
            });
            return;
          }
          updatePrompt(promptId, { savedCharacterBlockOverride: state.characterBlockOverride });
        }

        if (state.secondaryCharacterBlockOverride !== state.savedSecondaryCharacterBlockOverride) {
          const secOverrideRes = await fetch(
            `/api/stories/images/${promptId}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ secondary_character_block_override: state.secondaryCharacterBlockOverride }),
            }
          );
          if (!secOverrideRes.ok) {
            const secOverrideErr = await secOverrideRes.json().catch(() => ({}));
            updatePrompt(promptId, {
              status: "failed",
              error: secOverrideErr?.error ?? "Failed to save secondary character block override",
            });
            return;
          }
          updatePrompt(promptId, { savedSecondaryCharacterBlockOverride: state.secondaryCharacterBlockOverride });
        }

        if (state.suppressCharacterBlock !== state.savedSuppressCharacterBlock) {
          const suppressRes = await fetch(`/api/stories/images/${promptId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ suppress_character_block: state.suppressCharacterBlock }),
          });
          if (!suppressRes.ok) {
            const suppressErr = await suppressRes.json().catch(() => ({}));
            updatePrompt(promptId, {
              status: "failed",
              error: suppressErr?.error ?? "Failed to save character block suppression",
            });
            return;
          }
          updatePrompt(promptId, { savedSuppressCharacterBlock: state.suppressCharacterBlock });
        }

        if (state.clothingOverride !== state.savedClothingOverride) {
          const clothingRes = await fetch(`/api/stories/images/${promptId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clothing_override: state.clothingOverride }),
          });
          if (!clothingRes.ok) {
            const clothingErr = await clothingRes.json().catch(() => ({}));
            updatePrompt(promptId, {
              status: "failed",
              error: clothingErr?.error ?? "Failed to save clothing override",
            });
            return;
          }
          updatePrompt(promptId, { savedClothingOverride: state.clothingOverride });
        }

        if (state.sfwConstraintOverride !== state.savedSfwConstraintOverride) {
          const sfwRes = await fetch(`/api/stories/images/${promptId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sfw_constraint_override: state.sfwConstraintOverride }),
          });
          if (!sfwRes.ok) {
            const sfwErr = await sfwRes.json().catch(() => ({}));
            updatePrompt(promptId, {
              status: "failed",
              error: sfwErr?.error ?? "Failed to save SFW constraint override",
            });
            return;
          }
          updatePrompt(promptId, { savedSfwConstraintOverride: state.sfwConstraintOverride });
        }

        if (state.visualSignatureOverride !== state.savedVisualSignatureOverride) {
          const sigRes = await fetch(`/api/stories/images/${promptId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ visual_signature_override: state.visualSignatureOverride }),
          });
          if (!sigRes.ok) {
            const sigErr = await sigRes.json().catch(() => ({}));
            updatePrompt(promptId, {
              status: "failed",
              error: sigErr?.error ?? "Failed to save visual signature override",
            });
            return;
          }
          updatePrompt(promptId, { savedVisualSignatureOverride: state.visualSignatureOverride });
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

  const allPromptIds = Object.keys(promptStates);
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
        const prompts = post.story_image_prompts;

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
            {!isCollapsed && (
              <div className="mt-3 space-y-5 pl-2">
                {(
                  ["facebook_sfw", "website_nsfw_paired", "website_only"] as const
                ).map((imageType) => {
                  const typePrompts = prompts.filter(
                    (ip) => ip.image_type === imageType
                  );
                  if (typePrompts.length === 0) return null;

                  const cfg = IMAGE_TYPE_CONFIG[imageType];

                  return (
                    <div key={imageType}>
                      {/* Type header */}
                      <h4 className="mb-3 text-sm font-medium text-muted-foreground">
                        {cfg.emoji} {cfg.label}{" "}
                        <span className="text-xs">({typePrompts.length})</span>
                      </h4>

                      {/* Image grid */}
                      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                        {typePrompts.map((ip) => (
                          <ImageCard
                            key={ip.id}
                            prompt={ip}
                            state={promptStates[ip.id]}
                            imageType={imageType}
                            seriesId={seriesId}
                            promptPositionMap={promptPositionMap.current}
                            onUpdatePrompt={updatePrompt}
                            onRegenerate={handleRegenerate}
                            onApprove={handleApprove}
                            onRevert={handleRevert}
                            onGenerate={() => handleRegenerate(ip.id)}
                            onImageClick={setLightboxUrl}
                            onArtDirector={handleRegenerate}
                            batchGenerating={batchGenerating}
                            imageModel={imageModel}
                            characterIdentityMap={characterIdentityMap}
                            onNavigateToCharacters={onNavigateToCharacters}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* ======== LIGHTBOX ======== */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
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
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

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
// DiagnosticPanel sub-component
// ---------------------------------------------------------------------------

function DiagnosticPanel({
  flags,
  onChange,
}: {
  flags: DiagnosticFlags;
  onChange: (flags: DiagnosticFlags) => void;
}) {
  const allOn = Object.values(flags).every(Boolean);
  const allOff = Object.values(flags).every((v) => !v);

  const groups = DIAGNOSTIC_TOGGLE_CONFIG.reduce<
    Record<string, Array<{ key: keyof DiagnosticFlags; label: string }>>
  >((acc, item) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group].push({ key: item.key, label: item.label });
    return acc;
  }, {});

  return (
    <div className="space-y-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-amber-400">
          Diagnostic Toggles
        </span>
        <div className="flex gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => {
              const allTrue = {} as DiagnosticFlags;
              for (const k of Object.keys(flags) as Array<keyof DiagnosticFlags>) {
                allTrue[k] = true;
              }
              onChange(allTrue);
            }}
            disabled={allOn}
          >
            All On
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => {
              const allFalse = {} as DiagnosticFlags;
              for (const k of Object.keys(flags) as Array<keyof DiagnosticFlags>) {
                allFalse[k] = false;
              }
              onChange(allFalse);
            }}
            disabled={allOff}
          >
            All Off
          </Button>
        </div>
      </div>

      {Object.entries(groups).map(([group, items]) => (
        <div key={group}>
          <p className="mb-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            {group}
          </p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {items.map(({ key, label }) => (
              <div key={key} className="flex items-center gap-2">
                <Switch
                  id={`diag-${key}`}
                  checked={flags[key]}
                  onCheckedChange={(checked) =>
                    onChange({ ...flags, [key]: checked })
                  }
                  className="h-4 w-7 data-[state=checked]:bg-amber-500"
                />
                <Label
                  htmlFor={`diag-${key}`}
                  className="text-[11px] text-muted-foreground cursor-pointer"
                >
                  {label}
                </Label>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}


// ---------------------------------------------------------------------------
// LockedCharacterBlock — read-only preview of the character text the model
// will receive for a given prompt.
//
// Renders ONLY when the story uses Hunyuan; for Flux 2 Dev, character
// identity is carried by PuLID reference images and no character text is
// injected (see Phase C model-aware injection comments in
// /api/stories/[seriesId]/generate-image/route.ts and /generate-cover/route.ts).
//
// The text shown is the SAME string the server-side scene route prepends
// to the scene prompt (Phase B): `buildSceneCharacterBlockFromLocked`
// applied to the character's `portrait_prompt_locked`. To change it, the
// user re-approves the portrait — there is no per-scene override.
// ---------------------------------------------------------------------------

interface LockedCharacterBlockProps {
  imageModel: ImageModel;
  primaryCharacterId: string | null;
  primaryCharacterName: string | null;
  secondaryCharacterId: string | null;
  secondaryCharacterName: string | null;
  characterIdentityMap: Record<string, CharacterIdentity>;
  onNavigateToCharacters: () => void;
  characterBlockOverride: string | null;
  showOverride: boolean;
  onOverrideChange: (text: string) => void;
  onToggleOverride: (prefilledText: string) => void;
  onClearOverride: () => void;
  secondaryCharacterBlockOverride: string | null;
  showSecondaryOverride: boolean;
  onSecondaryOverrideChange: (text: string) => void;
  onSecondaryToggleOverride: (prefilledText: string) => void;
  onSecondaryClearOverride: () => void;
  suppressCharacterBlock: boolean;
  onToggleSuppressCharacterBlock: () => void;
}

function LockedCharacterBlock({
  imageModel,
  primaryCharacterId,
  primaryCharacterName,
  secondaryCharacterId,
  secondaryCharacterName,
  characterIdentityMap,
  onNavigateToCharacters,
  characterBlockOverride,
  showOverride,
  onOverrideChange,
  onToggleOverride,
  onClearOverride,
  secondaryCharacterBlockOverride,
  showSecondaryOverride,
  onSecondaryOverrideChange,
  onSecondaryToggleOverride,
  onSecondaryClearOverride,
  suppressCharacterBlock,
  onToggleSuppressCharacterBlock,
}: LockedCharacterBlockProps) {
  if (imageModel !== "hunyuan3") return null;
  if (!primaryCharacterId && !secondaryCharacterId) return null;

  const primaryIdent = primaryCharacterId
    ? characterIdentityMap[primaryCharacterId]
    : null;
  const primaryEntry = primaryCharacterId
    ? {
        id: primaryCharacterId,
        name: primaryIdent?.name ?? primaryCharacterName ?? "Character",
        locked: primaryIdent?.portraitPromptLocked ?? null,
      }
    : null;

  const secondaryIdent = secondaryCharacterId
    ? characterIdentityMap[secondaryCharacterId]
    : null;
  const secondaryEntry = secondaryCharacterId
    ? {
        id: secondaryCharacterId,
        name: secondaryIdent?.name ?? secondaryCharacterName ?? "Character",
        locked: secondaryIdent?.portraitPromptLocked ?? null,
      }
    : null;

  const defaultPrimaryLocked = primaryEntry?.locked
    ? buildSceneCharacterBlockFromLocked(primaryEntry.name, primaryEntry.locked)
    : "";
  const defaultSecondaryLocked = secondaryEntry?.locked
    ? buildSceneCharacterBlockFromLocked(secondaryEntry.name, secondaryEntry.locked)
    : "";

  const eitherOverrideActive =
    characterBlockOverride !== null || secondaryCharacterBlockOverride !== null;

  return (
    <div className="mt-1.5 rounded border border-zinc-700/40 bg-zinc-900/40 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-zinc-400">
          <Lock className="h-3 w-3" />
          Locked character text (Hunyuan)
          {eitherOverrideActive && !suppressCharacterBlock && (
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-400">
              Custom
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleSuppressCharacterBlock}
            className={`rounded border px-2 py-0.5 text-[10px] font-medium transition-colors ${
              suppressCharacterBlock
                ? "border-red-700/40 bg-red-900/30 text-red-400 hover:bg-red-900/50"
                : "border-zinc-700/30 bg-zinc-800/40 text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {suppressCharacterBlock ? "Suppressed" : "Inject"}
          </button>
          <button
            onClick={onNavigateToCharacters}
            className="text-[10px] text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline"
          >
            Edit in Characters
          </button>
        </div>
      </div>

      {suppressCharacterBlock ? (
        <p className="mt-1.5 rounded bg-zinc-900/60 px-2 py-1.5 text-[10px] italic text-zinc-500">
          No character description will be sent for this image. Use this for detail shots, hands, objects, and atmospheric images.
        </p>
      ) : (
        <>
        <div className="mt-1.5 space-y-2.5">
        {primaryEntry && (
          <div>
            <div className="text-[10px] font-medium text-zinc-300">
              {primaryEntry.name}
            </div>
            {!showOverride && (
              characterBlockOverride !== null ? (
                <div className="mt-0.5 whitespace-pre-wrap break-words rounded bg-amber-950/30 px-2 py-1 font-mono text-[10px] leading-relaxed text-amber-300/80">
                  {characterBlockOverride}
                </div>
              ) : primaryEntry.locked ? (
                <div className="mt-0.5 whitespace-pre-wrap break-words rounded bg-zinc-950/60 px-2 py-1 font-mono text-[10px] leading-relaxed text-zinc-400">
                  {buildSceneCharacterBlockFromLocked(primaryEntry.name, primaryEntry.locked)}
                </div>
              ) : (
                <div className="mt-0.5 rounded bg-amber-950/30 px-2 py-1 text-[10px] text-amber-400/90">
                  No portrait approved yet — falls back to description-derived
                  identity at generation time.
                </div>
              )
            )}
            {showOverride && (
              <div className="mt-0.5 space-y-1">
                <div className="text-[10px] text-amber-400/80">
                  This override applies to this image only. Other images using{" "}
                  <span className="font-medium text-amber-300">{primaryEntry.name}</span>{" "}
                  are not affected.
                </div>
                <Textarea
                  value={characterBlockOverride ?? ""}
                  onChange={(e) => onOverrideChange(e.target.value)}
                  rows={4}
                  className="leading-relaxed resize-y border-amber-700/40 bg-amber-950/20 font-mono text-[11px]"
                  placeholder="Enter custom character block for this image only…"
                />
              </div>
            )}
            <div className="mt-1 flex items-center justify-end gap-2">
              {characterBlockOverride !== null && !showOverride && (
                <button
                  onClick={onClearOverride}
                  className="text-[10px] text-zinc-400 transition-colors hover:text-red-400"
                >
                  Clear override
                </button>
              )}
              <button
                onClick={() => {
                  if (!showOverride && characterBlockOverride === null) {
                    onToggleOverride(defaultPrimaryLocked);
                  } else {
                    onToggleOverride(characterBlockOverride ?? defaultPrimaryLocked);
                  }
                }}
                className="text-[10px] text-blue-400 transition-colors hover:text-blue-300"
              >
                {showOverride ? "Hide editor" : "Override for this image only"}
              </button>
            </div>
          </div>
        )}

        {secondaryEntry && (
          <div>
            <div className="text-[10px] font-medium text-zinc-300">
              {secondaryEntry.name}
            </div>
            {!showSecondaryOverride && (
              secondaryCharacterBlockOverride !== null ? (
                <div className="mt-0.5 whitespace-pre-wrap break-words rounded bg-amber-950/30 px-2 py-1 font-mono text-[10px] leading-relaxed text-amber-300/80">
                  {secondaryCharacterBlockOverride}
                </div>
              ) : secondaryEntry.locked ? (
                <div className="mt-0.5 whitespace-pre-wrap break-words rounded bg-zinc-950/60 px-2 py-1 font-mono text-[10px] leading-relaxed text-zinc-400">
                  {buildSceneCharacterBlockFromLocked(secondaryEntry.name, secondaryEntry.locked)}
                </div>
              ) : (
                <div className="mt-0.5 rounded bg-amber-950/30 px-2 py-1 text-[10px] text-amber-400/90">
                  No portrait approved yet — falls back to description-derived
                  identity at generation time.
                </div>
              )
            )}
            {showSecondaryOverride && (
              <div className="mt-0.5 space-y-1">
                <div className="text-[10px] text-amber-400/80">
                  This override applies to this image only. Other images using{" "}
                  <span className="font-medium text-amber-300">{secondaryEntry.name}</span>{" "}
                  are not affected.
                </div>
                <Textarea
                  value={secondaryCharacterBlockOverride ?? ""}
                  onChange={(e) => onSecondaryOverrideChange(e.target.value)}
                  rows={4}
                  className="leading-relaxed resize-y border-amber-700/40 bg-amber-950/20 font-mono text-[11px]"
                  placeholder="Enter custom character block for this image only…"
                />
              </div>
            )}
            <div className="mt-1 flex items-center justify-end gap-2">
              {secondaryCharacterBlockOverride !== null && !showSecondaryOverride && (
                <button
                  onClick={onSecondaryClearOverride}
                  className="text-[10px] text-zinc-400 transition-colors hover:text-red-400"
                >
                  Clear override
                </button>
              )}
              <button
                onClick={() => {
                  if (!showSecondaryOverride && secondaryCharacterBlockOverride === null) {
                    onSecondaryToggleOverride(defaultSecondaryLocked);
                  } else {
                    onSecondaryToggleOverride(secondaryCharacterBlockOverride ?? defaultSecondaryLocked);
                  }
                }}
                className="text-[10px] text-blue-400 transition-colors hover:text-blue-300"
              >
                {showSecondaryOverride ? "Hide editor" : "Override for this image only"}
              </button>
            </div>
          </div>
        )}
      </div>

      {!showOverride && !showSecondaryOverride && (
        <div className="mt-1.5 text-[10px] text-zinc-500">
          Edits propagate to every image using this character. The scene
          prompt below is appended to this text.
        </div>
      )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prompt assembly — mirrors the server-side assembleHunyuanPrompt logic so
// the preview is accurate without a round-trip.
// ---------------------------------------------------------------------------

function assembleFullPrompt(
  state: PromptState,
  ip: ImagePromptData,
  characterIdentityMap: Record<string, CharacterIdentity>,
  imageModel: ImageModel
): string {
  const isSfw = ip.image_type === "facebook_sfw" || ip.image_type === "shared";
  const suppress =
    state.suppressCharacterBlock || state.characterBlockOverride === "";
  const parts: string[] = [];

  if (imageModel === "hunyuan3" && !suppress) {
    if (state.characterBlockOverride) {
      parts.push(state.characterBlockOverride);
    } else if (ip.character_id) {
      const ident = characterIdentityMap[ip.character_id];
      if (ident?.name && ident?.portraitPromptLocked) {
        parts.push(buildSceneCharacterBlockFromLocked(ident.name, ident.portraitPromptLocked));
      }
    }

    if (state.secondaryCharacterBlockOverride) {
      parts.push(state.secondaryCharacterBlockOverride);
    } else if (ip.secondary_character_id) {
      const ident = characterIdentityMap[ip.secondary_character_id];
      if (ident?.name && ident?.portraitPromptLocked) {
        parts.push(buildSceneCharacterBlockFromLocked(ident.name, ident.portraitPromptLocked));
      }
    }

    if (isSfw) {
      if (state.clothingOverride !== null) {
        if (state.clothingOverride.trim()) parts.push(state.clothingOverride.trim());
      } else {
        for (const charId of [ip.character_id, ip.secondary_character_id]) {
          if (!charId) continue;
          const ident = characterIdentityMap[charId];
          if (ident?.name && ident?.clothing) {
            parts.push(`${ident.name} is wearing ${ident.clothing}.`);
          }
        }
      }
    }
  }

  if (state.promptText.trim()) parts.push(state.promptText.trim());

  if (isSfw) {
    if (state.sfwConstraintOverride !== null) {
      if (state.sfwConstraintOverride.trim()) parts.push(state.sfwConstraintOverride.trim());
    } else {
      parts.push("Both characters fully clothed. No nudity.");
    }
  }

  if (state.visualSignatureOverride !== null) {
    if (state.visualSignatureOverride.trim()) parts.push(state.visualSignatureOverride.trim());
  } else {
    parts.push(VISUAL_SIGNATURE);
  }

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// ImageCard sub-component
// ---------------------------------------------------------------------------

interface ImageCardProps {
  prompt: ImagePromptData;
  state: PromptState | undefined;
  imageType: string;
  seriesId: string;
  promptPositionMap: Record<string, number>;
  onUpdatePrompt: (id: string, updates: Partial<PromptState>) => void;
  onRegenerate: (id: string) => void;
  onApprove: (id: string) => void;
  onRevert: (id: string) => void;
  onGenerate: () => void;
  onImageClick: (url: string) => void;
  onArtDirector: (promptId: string) => void;
  batchGenerating: boolean;
  imageModel: ImageModel;
  characterIdentityMap: Record<string, CharacterIdentity>;
  onNavigateToCharacters: () => void;
}

function ImageCard({
  prompt: ip,
  state,
  imageType,
  seriesId,
  promptPositionMap,
  onUpdatePrompt,
  onRegenerate,
  onApprove,
  onRevert,
  onGenerate,
  onImageClick,
  onArtDirector,
  batchGenerating,
  imageModel,
  characterIdentityMap,
  onNavigateToCharacters,
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
  const isSfw = imageType === "facebook_sfw" || imageType === "shared";
  const isCharBlockSuppressed =
    state.suppressCharacterBlock || state.characterBlockOverride === "";

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

  return (
    <Card
      className={`overflow-visible transition-colors ${
        isApproved
          ? "border-green-500/30"
          : isGenerated
            ? "border-amber-500/30"
            : isFailed
              ? "border-red-500/30"
              : ""
      }`}
    >
      <div>
        {/* Image area */}
        <div className="relative bg-muted/30 aspect-[2/3]">
          {isGenerating ? (
            <div className="flex flex-col items-center justify-center absolute inset-0">
              <Loader2 className="mb-2 h-8 w-8 animate-spin text-blue-400" />
              <p className="text-xs text-blue-400">Generating...</p>
            </div>
          ) : hasImage ? (
            <div
              className="relative h-full w-full cursor-pointer"
              onClick={() => onImageClick(state.imageUrl!)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={state.imageUrl!}
                alt={`${imageType} image${ip.character_name ? ` - ${ip.character_name}` : ""}`}
                className="w-full object-contain h-full"
                style={{ aspectRatio: "2/3" }}
              />
              {isApproved && (
                <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-green-600/90 px-2 py-1 text-[10px] font-medium text-white shadow backdrop-blur-sm">
                  <Check className="h-3 w-3" />
                  Approved
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center absolute inset-0">
              <div className="mb-2 h-10 w-10 rounded-lg bg-muted/50 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-muted-foreground/50" />
              </div>
              <p className="text-xs text-muted-foreground">Not generated</p>
            </div>
          )}
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
            {state.diagnosticFlags && Object.values(state.diagnosticFlags).some((v) => !v) && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 bg-amber-500/20 text-amber-400 border-amber-500/30"
              >
                Diagnostic
              </Badge>
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

          {/* Prompt toggle */}
          <button
            onClick={() =>
              onUpdatePrompt(ip.id, { showPrompt: !state.showPrompt })
            }
            className="text-muted-foreground hover:text-foreground transition-colors text-[11px]"
          >
            {state.showPrompt ? "Hide prompt" : truncatedPrompt}
          </button>
          </div>

          {/* Zone 2: scrollable editing area */}
          {state.showPrompt && (
            <div className="max-h-[60vh] overflow-y-auto px-3 pb-1 space-y-2">
              <LockedCharacterBlock
                imageModel={imageModel}
                primaryCharacterId={ip.character_id}
                primaryCharacterName={ip.character_name}
                secondaryCharacterId={ip.secondary_character_id}
                secondaryCharacterName={ip.secondary_character_name}
                characterIdentityMap={characterIdentityMap}
                onNavigateToCharacters={onNavigateToCharacters}
                characterBlockOverride={state.characterBlockOverride}
                showOverride={state.showOverride}
                onOverrideChange={(text) =>
                  onUpdatePrompt(ip.id, { characterBlockOverride: text })
                }
                onToggleOverride={(prefilledText) => {
                  if (!state.showOverride && state.characterBlockOverride === null) {
                    onUpdatePrompt(ip.id, {
                      showOverride: true,
                      characterBlockOverride: prefilledText,
                    });
                  } else {
                    onUpdatePrompt(ip.id, { showOverride: !state.showOverride });
                  }
                }}
                onClearOverride={() =>
                  onUpdatePrompt(ip.id, { characterBlockOverride: null, showOverride: false })
                }
                secondaryCharacterBlockOverride={state.secondaryCharacterBlockOverride}
                showSecondaryOverride={state.showSecondaryOverride}
                onSecondaryOverrideChange={(text) =>
                  onUpdatePrompt(ip.id, { secondaryCharacterBlockOverride: text })
                }
                onSecondaryToggleOverride={(prefilledText) => {
                  if (!state.showSecondaryOverride && state.secondaryCharacterBlockOverride === null) {
                    onUpdatePrompt(ip.id, {
                      showSecondaryOverride: true,
                      secondaryCharacterBlockOverride: prefilledText,
                    });
                  } else {
                    onUpdatePrompt(ip.id, { showSecondaryOverride: !state.showSecondaryOverride });
                  }
                }}
                onSecondaryClearOverride={() =>
                  onUpdatePrompt(ip.id, { secondaryCharacterBlockOverride: null, showSecondaryOverride: false })
                }
                suppressCharacterBlock={state.suppressCharacterBlock}
                onToggleSuppressCharacterBlock={() =>
                  onUpdatePrompt(ip.id, { suppressCharacterBlock: !state.suppressCharacterBlock })
                }
              />
              {/* Rewriter toggle — Hunyuan only (Flux uses reference images, not text) */}
              {imageModel === "hunyuan3" && (
                <div className="flex items-center justify-between rounded border border-zinc-700/30 bg-zinc-900/30 px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`rewriter-${ip.id}`}
                      checked={state.useRewriter}
                      onCheckedChange={(checked) =>
                        onUpdatePrompt(ip.id, { useRewriter: checked })
                      }
                      className="h-4 w-7 data-[state=checked]:bg-violet-600"
                    />
                    <Label
                      htmlFor={`rewriter-${ip.id}`}
                      className="cursor-pointer text-[11px] text-zinc-400"
                    >
                      Rewrite for Hunyuan
                    </Label>
                  </div>
                  <span className="text-[10px] text-zinc-600">
                    {state.useRewriter
                      ? "Mistral rewrites before generating"
                      : "Sends prompt as-is"}
                  </span>
                </div>
              )}

              <Textarea
                value={state.promptText}
                onChange={(e) =>
                  onUpdatePrompt(ip.id, { promptText: e.target.value })
                }
                rows={10}
                className="leading-relaxed resize-y bg-muted/30 text-[11px] min-h-[160px]"
                disabled={isGenerating || isApproved}
              />
              {/* Clothing override — SFW only, hidden when character blocks are suppressed */}
              {isSfw && !isCharBlockSuppressed && (
                <div>
                  <button
                    onClick={() => {
                      if (!state.showClothingOverride && state.clothingOverride === null) {
                        const autoClothing = [ip.character_id, ip.secondary_character_id]
                          .filter(Boolean)
                          .map((id) => {
                            const ident = characterIdentityMap[id as string];
                            return ident?.name && ident?.clothing
                              ? `${ident.name} is wearing ${ident.clothing}.`
                              : null;
                          })
                          .filter(Boolean)
                          .join(" ");
                        onUpdatePrompt(ip.id, {
                          showClothingOverride: true,
                          clothingOverride: autoClothing,
                        });
                      } else {
                        onUpdatePrompt(ip.id, { showClothingOverride: !state.showClothingOverride });
                      }
                    }}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ChevronRight className={`h-3 w-3 transition-transform ${state.showClothingOverride ? "rotate-90" : ""}`} />
                    {state.clothingOverride !== null ? "Clothing override (active)" : "Override clothing"}
                  </button>
                  {state.showClothingOverride && (
                    <div className="mt-1 space-y-1">
                      <Textarea
                        value={state.clothingOverride ?? ""}
                        onChange={(e) =>
                          onUpdatePrompt(ip.id, { clothingOverride: e.target.value || null })
                        }
                        rows={2}
                        placeholder={[ip.character_id, ip.secondary_character_id]
                          .filter(Boolean)
                          .map((id) => {
                            const ident = characterIdentityMap[id as string];
                            return ident?.name && ident?.clothing
                              ? `${ident.name} is wearing ${ident.clothing}.`
                              : null;
                          })
                          .filter(Boolean)
                          .join(" ") || "Custom clothing sentence…"}
                        className="resize-y bg-muted/30 text-[11px]"
                      />
                      <p className="text-[10px] text-muted-foreground">Empty = auto. Set to suppress.</p>
                      {state.clothingOverride !== null && (
                        <button
                          onClick={() => onUpdatePrompt(ip.id, { clothingOverride: null, showClothingOverride: false })}
                          className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
                        >
                          Clear override (restore auto)
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* SFW constraint override — SFW only */}
              {isSfw && (
                <div>
                  <button
                    onClick={() => {
                      if (!state.showSfwConstraintOverride && state.sfwConstraintOverride === null) {
                        onUpdatePrompt(ip.id, {
                          showSfwConstraintOverride: true,
                          sfwConstraintOverride: "Both characters fully clothed. No nudity.",
                        });
                      } else {
                        onUpdatePrompt(ip.id, { showSfwConstraintOverride: !state.showSfwConstraintOverride });
                      }
                    }}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ChevronRight className={`h-3 w-3 transition-transform ${state.showSfwConstraintOverride ? "rotate-90" : ""}`} />
                    {state.sfwConstraintOverride !== null ? "SFW constraint (active)" : "Override SFW constraint"}
                  </button>
                  {state.showSfwConstraintOverride && (
                    <div className="mt-1 space-y-1">
                      <Textarea
                        value={state.sfwConstraintOverride ?? ""}
                        onChange={(e) =>
                          onUpdatePrompt(ip.id, { sfwConstraintOverride: e.target.value === "" ? "" : e.target.value })
                        }
                        rows={2}
                        placeholder="Both characters fully clothed. No nudity."
                        className="resize-y bg-muted/30 text-[11px]"
                      />
                      <p className="text-[10px] text-muted-foreground">Empty = suppress entirely.</p>
                      {state.sfwConstraintOverride !== null && (
                        <button
                          onClick={() => onUpdatePrompt(ip.id, { sfwConstraintOverride: null, showSfwConstraintOverride: false })}
                          className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
                        >
                          Clear override (restore default)
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Visual signature override — always shown */}
              <div>
                <button
                  onClick={() => {
                    if (!state.showVisualSignatureOverride && state.visualSignatureOverride === null) {
                      onUpdatePrompt(ip.id, {
                        showVisualSignatureOverride: true,
                        visualSignatureOverride: VISUAL_SIGNATURE,
                      });
                    } else {
                      onUpdatePrompt(ip.id, { showVisualSignatureOverride: !state.showVisualSignatureOverride });
                    }
                  }}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronRight className={`h-3 w-3 transition-transform ${state.showVisualSignatureOverride ? "rotate-90" : ""}`} />
                  {state.visualSignatureOverride !== null ? "Visual signature (active)" : "Override visual signature"}
                </button>
                {state.showVisualSignatureOverride && (
                  <div className="mt-1 space-y-1">
                    <Textarea
                      value={state.visualSignatureOverride ?? ""}
                      onChange={(e) =>
                        onUpdatePrompt(ip.id, { visualSignatureOverride: e.target.value === "" ? "" : e.target.value })
                      }
                      rows={3}
                      placeholder={VISUAL_SIGNATURE}
                      className="resize-y bg-muted/30 text-[11px]"
                    />
                    <p className="text-[10px] text-muted-foreground">Empty = suppress entirely.</p>
                    {state.visualSignatureOverride !== null && (
                      <button
                        onClick={() => onUpdatePrompt(ip.id, { visualSignatureOverride: null, showVisualSignatureOverride: false })}
                        className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
                      >
                        Clear override (restore default)
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Full prompt preview */}
              <div>
                <button
                  onClick={() =>
                    onUpdatePrompt(ip.id, { showFullPromptPreview: !state.showFullPromptPreview })
                  }
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Eye className="h-3 w-3" />
                  {state.showFullPromptPreview ? "Hide full prompt" : "Preview full prompt"}
                </button>
                {state.showFullPromptPreview && (
                  <div className="relative mt-1.5">
                    <p className="mb-1 text-[10px] text-muted-foreground">
                      This is the prompt sent to the model
                    </p>
                    <Textarea
                      value={assembleFullPrompt(state, ip, characterIdentityMap, imageModel)}
                      readOnly
                      rows={8}
                      className="resize-y bg-muted/50 font-mono text-[10px] leading-relaxed pr-16"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="absolute right-1 top-6 h-6 px-2 text-[10px]"
                      onClick={() =>
                        navigator.clipboard.writeText(
                          assembleFullPrompt(state, ip, characterIdentityMap, imageModel)
                        )
                      }
                    >
                      Copy
                    </Button>
                  </div>
                )}
              </div>

              {/* Diagnostic toggles */}
              <div>
                <button
                  onClick={() =>
                    onUpdatePrompt(ip.id, { showDiagnostic: !state.showDiagnostic })
                  }
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-amber-400 transition-colors"
                >
                  <Settings2 className="h-3 w-3" />
                  {state.showDiagnostic ? "Hide diagnostics" : "Diagnostics"}
                </button>
                {state.showDiagnostic && (
                  <div className="mt-1.5">
                    <DiagnosticPanel
                      flags={state.diagnosticFlags}
                      onChange={(newFlags) =>
                        onUpdatePrompt(ip.id, { diagnosticFlags: newFlags })
                      }
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Zone 3: sticky action buttons */}
          <div className="sticky bottom-0 z-10 flex items-center gap-2 border-t border-border/50 bg-card/95 px-3 py-2 backdrop-blur-sm">
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
            <Link
              href={`/dashboard/stories/${seriesId}/debug/${ip.id}`}
              className="ml-auto"
            >
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-zinc-600 hover:text-zinc-400"
                title="Debug"
              >
                <Bug className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </CardContent>
      </div>
    </Card>
  );
}
