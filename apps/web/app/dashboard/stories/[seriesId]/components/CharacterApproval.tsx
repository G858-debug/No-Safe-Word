"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Check,
  Loader2,
  Sparkles,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  User,
  Wand2,
  AlertCircle,
  Dna,
  Eye,
  Pencil,
  Save,
  X,
  Lock,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ImageType = "portrait" | "fullBody";

export interface CharacterFromAPI {
  id: string; // story_character id
  role: string;
  prose_description: string | null;
  approved: boolean;
  approved_image_id: string | null;
  approved_seed: number | null;
  approved_fullbody: boolean;
  approved_fullbody_image_id: string | null;
  approved_fullbody_seed: number | null;
  face_url: string | null;
  characters: {
    id: string;
    name: string;
    description: Record<string, unknown>;
  };
  approved_image_url: string | null;
  approved_fullbody_image_url: string | null;
  pending_image_id: string | null;
  pending_image_url: string | null;
  pending_fullbody_image_id: string | null;
  pending_fullbody_image_url: string | null;
}

interface CharacterApprovalProps {
  seriesId: string;
  characters: CharacterFromAPI[];
  modelUrn?: string;
  onProceedToImages?: () => void;
  onCharacterApproved?: (storyCharId: string, imageUrl: string, imageId: string, type: ImageType) => void;
}

interface ImageSlotState {
  imageUrl: string | null;
  imageId: string | null;
  isGenerating: boolean;
  approved: boolean;
  approvedUrl: string | null;
  previewUrl?: string; // stitched face+body composite — display only
  prompt: string; // Flux identity preview — used for approved_prompt, not displayed
  error: string | null;
  jobId: string | null;
  pollStartTime: number | null;
  seed: number | null;
  lockSeed: boolean;
  runpodStatus: "IN_QUEUE" | "IN_PROGRESS" | null;
}

interface LoraTrainingState {
  status: "no_lora" | "pending" | "generating_dataset" | "evaluating" | "awaiting_dataset_approval" | "captioning" | "training" | "validating" | "deployed" | "failed" | "archived";
  loraId: string | null;
  datasetGenerated: number;
  datasetApproved: number;
  humanApproved: number;
  humanRejected: number;
  trainingAttempt: number;
  validationScore: number | null;
  error: string | null;
  estimatedTimeRemaining: string | null;
  isTriggering: boolean;
  /** Set when user approves a new face/body while LoRA is deployed */
  referencesChanged?: boolean;
}

interface CharState {
  portrait: ImageSlotState;
  fullBody: ImageSlotState;
  showDescription: boolean;
  lora: LoraTrainingState;
  editingDescription: boolean;
  localDescription: Record<string, string>; // saved/displayed version
  descriptionDraft: Record<string, string>;  // in-progress edits
  savingDescription: boolean;
  descriptionError: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROLE_STYLES: Record<string, { label: string; className: string }> = {
  protagonist: {
    label: "Protagonist",
    className: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  },
  love_interest: {
    label: "Love Interest",
    className: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  },
  supporting: {
    label: "Supporting",
    className: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  },
  antagonist: {
    label: "Antagonist",
    className: "bg-red-500/20 text-red-400 border-red-500/30",
  },
};

/**
 * Client-side mirror of buildKontextIdentityPrefix.
 * Generates the Flux prose identity string shown in the preview and stored as approved_prompt.
 * Flux's T5 encoder processes natural language — no emphasis weights, no tag lists.
 */
function buildFluxIdentityPreview(desc: Record<string, unknown>): string {
  const d = desc as Record<string, string>;
  const gender = d.gender === "male" ? "man" : d.gender === "female" ? "woman" : "person";
  const pronoun = d.gender === "male" ? "He" : d.gender === "female" ? "She" : "They";

  let core = "";
  if (d.age && d.ethnicity) core = `A ${d.age}-year-old ${d.ethnicity} ${gender}`;
  else if (d.age) core = `A ${d.age}-year-old ${gender}`;
  else if (d.ethnicity) core = `A ${d.ethnicity} ${gender}`;
  else core = `A ${gender}`;

  const details: string[] = [];
  if (d.hairColor || d.hairStyle) {
    const hair = [d.hairColor, d.hairStyle].filter(Boolean).join(" ");
    details.push(/\bhair\b/i.test(hair) ? hair : `${hair} hair`);
  }
  if (d.eyeColor) details.push(`${d.eyeColor} eyes`);
  if (d.skinTone) details.push(`${d.skinTone} skin`);
  if (details.length > 0) core += ` with ${details.join(", ")}`;

  const sentences = [core + "."];
  if (d.distinguishingFeatures) {
    const verb2 = pronoun === "They" ? "have" : "has";
    sentences.push(`${pronoun} ${verb2} ${d.distinguishingFeatures}.`);
  }
  if (d.bodyType) sentences.push(`${pronoun} has a ${d.bodyType} build.`);
  if (d.gender === "female") sentences.push("She has beautiful features and smooth, glowing skin.");
  return sentences.join(" ");
}

const POLL_INTERVAL = 3000;
const MAX_POLL_ATTEMPTS = 360; // 18 minutes (cold starts with premium model downloads take ~14 min)

function makeSlotState(
  imageUrl: string | null,
  imageId: string | null,
  approved: boolean,
  approvedUrl: string | null,
  seed: number | null,
  prompt: string,
): ImageSlotState {
  return {
    imageUrl,
    imageId,
    isGenerating: false,
    approved,
    approvedUrl,
    prompt,
    error: null,
    jobId: null,
    pollStartTime: null,
    seed,
    lockSeed: true,
    runpodStatus: null,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CharacterApproval({
  seriesId,
  characters,
  modelUrn,
  onProceedToImages,
  onCharacterApproved,
}: CharacterApprovalProps) {
  // Per-character state keyed by story_character id
  const [charStates, setCharStates] = useState<Record<string, CharState>>({});
  const pollTimers = useRef<Record<string, NodeJS.Timeout>>({});
  const pollCounts = useRef<Record<string, number>>({});
  const [generatingAll, setGeneratingAll] = useState(false);
  const [generateAllProgress, setGenerateAllProgress] = useState<string | null>(null);
  const [, setTick] = useState(0); // Force re-render for elapsed time display
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Initialize state from props (runs once)
  useEffect(() => {
    console.log(`[StoryPublisher] CharacterApproval mounted with ${characters.length} characters:`,
      characters.map(ch => ({
        id: ch.id,
        name: ch.characters.name,
        approved: ch.approved,
        approved_fullbody: ch.approved_fullbody,
        approved_image_url: ch.approved_image_url,
        approved_fullbody_image_url: ch.approved_fullbody_image_url,
      }))
    );

    const initial: Record<string, CharState> = {};
    for (const ch of characters) {
      const desc = ch.characters.description || {};

      // Portrait state
      const portraitUrl = ch.approved_image_url || ch.pending_image_url || null;
      const portraitId = ch.approved_image_id || ch.pending_image_id || null;

      // Full body state
      const fullBodyUrl = ch.approved_fullbody_image_url || ch.pending_fullbody_image_url || null;
      const fullBodyId = ch.approved_fullbody_image_id || ch.pending_fullbody_image_id || null;

      const fluxPreview = buildFluxIdentityPreview(desc);
      const localDesc = Object.fromEntries(
        Object.entries(desc).map(([k, v]) => [k, String(v ?? "")])
      );
      initial[ch.id] = {
        portrait: makeSlotState(
          portraitUrl,
          portraitId,
          ch.approved,
          ch.approved_image_url || null,
          ch.approved_seed ?? null,
          fluxPreview,
        ),
        fullBody: makeSlotState(
          fullBodyUrl,
          fullBodyId,
          ch.approved_fullbody ?? false,
          ch.approved_fullbody_image_url || null,
          ch.approved_fullbody_seed ?? null,
          fluxPreview,
        ),
        showDescription: false,
        lora: {
          status: "no_lora",
          loraId: null,
          datasetGenerated: 0,
          datasetApproved: 0,
          humanApproved: 0,
          humanRejected: 0,
          trainingAttempt: 0,
          validationScore: null,
          error: null,
          estimatedTimeRemaining: null,
          isTriggering: false,
        },
        editingDescription: false,
        localDescription: localDesc,
        descriptionDraft: localDesc,
        savingDescription: false,
        descriptionError: null,
      };
    }
    setCharStates(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pre-warm the RunPod endpoint on mount so cold start happens before user clicks Generate
  useEffect(() => {
    const anyNeedGeneration = characters.some(
      (ch) => !ch.approved_image_url && !ch.pending_image_url
    );
    if (anyNeedGeneration) {
      fetch("/api/warmup", { method: "POST" })
        .then((r) => r.json())
        .then((data) => {
          if (data.triggered) {
            console.log("[StoryPublisher] Pre-warm triggered — cold start in progress");
          } else if (data.warmed) {
            console.log("[StoryPublisher] Workers already warm:", data.workers);
          }
        })
        .catch(() => {/* ignore warmup errors */});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      Object.values(pollTimers.current).forEach(clearInterval);
    };
  }, []);

  // Update elapsed time display every second when any character is generating
  useEffect(() => {
    const anyGenerating = Object.values(charStates).some(
      (s) => s.portrait.isGenerating || s.fullBody.isGenerating
    );
    if (!anyGenerating) return;

    const interval = setInterval(() => {
      setTick((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [charStates]);

  // ------- Helpers -------

  const updateSlot = useCallback(
    (id: string, type: ImageType, updates: Partial<ImageSlotState>) => {
      setCharStates((prev) => ({
        ...prev,
        [id]: {
          ...prev[id],
          [type]: { ...prev[id]?.[type], ...updates },
        },
      }));
    },
    []
  );

  const updateCharMeta = useCallback(
    (id: string, updates: Partial<Omit<CharState, "portrait" | "fullBody" | "lora">>) => {
      setCharStates((prev) => ({
        ...prev,
        [id]: { ...prev[id], ...updates },
      }));
    },
    []
  );

  // Polling key includes type to allow concurrent portrait + full body polling
  const pollKey = (storyCharId: string, type: ImageType) => `${storyCharId}-${type}`;

  const startPolling = useCallback(
    (storyCharId: string, type: ImageType, jobId: string, imageId: string) => {
      const key = pollKey(storyCharId, type);
      console.log(`[StoryPublisher] Starting polling for ${key}, jobId: ${jobId}, imageId: ${imageId}`);

      // Clear existing poll if any
      if (pollTimers.current[key]) {
        clearInterval(pollTimers.current[key]);
      }
      pollCounts.current[key] = 0;
      const startTime = Date.now();

      // Store jobId and start time in state
      updateSlot(storyCharId, type, {
        jobId,
        pollStartTime: startTime,
      });

      pollTimers.current[key] = setInterval(async () => {
        pollCounts.current[key]++;
        const elapsed = Math.floor((Date.now() - startTime) / 1000);

        if (pollCounts.current[key] >= MAX_POLL_ATTEMPTS) {
          console.error(`[StoryPublisher] Generation timed out for ${key} after ${elapsed}s`);
          clearInterval(pollTimers.current[key]);
          delete pollTimers.current[key];
          updateSlot(storyCharId, type, {
            isGenerating: false,
            error: "Generation timed out. Click 'Check Status' to retry.",
            pollStartTime: null,
            runpodStatus: null,
          });
          return;
        }

        try {
          const res = await fetch(`/api/status/${jobId}`);
          if (!res.ok) throw new Error("Status check failed");
          const data = await res.json();

          // Track RunPod status for phase-aware progress messages
          if (data.status && !data.completed) {
            updateSlot(storyCharId, type, { runpodStatus: data.status });
          }

          if (data.error && !data.completed) {
            console.error(`[StoryPublisher] Generation failed for ${key}:`, data.error);
            clearInterval(pollTimers.current[key]);
            delete pollTimers.current[key];
            updateSlot(storyCharId, type, {
              isGenerating: false,
              error: data.error,
              pollStartTime: null,
              runpodStatus: null,
            });
            return;
          }

          if (data.completed && data.imageUrl) {
            console.log(`[StoryPublisher] Generation completed for ${key}, imageUrl: ${data.imageUrl}, seed: ${data.seed}`);
            clearInterval(pollTimers.current[key]);
            delete pollTimers.current[key];
            const completedSeed: number | null = data.seed ?? null;

            // Immediately store the image to Supabase Storage to preserve it
            try {
              const character = characters.find((c) => c.id === storyCharId);
              const characterName = character?.characters.name || "character";
              const timestamp = Date.now();
              const prefix = type === "fullBody" ? "fullbody" : "portrait";
              const filename = `characters/${characterName.replace(/\s+/g, "-").toLowerCase()}-${prefix}-${timestamp}.jpeg`;

              console.log(`[StoryPublisher] Storing image to Supabase Storage for ${characterName} (${type})`);
              const storeRes = await fetch("/api/images/store", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  blob_url: data.imageUrl,
                  image_id: imageId,
                  filename,
                }),
              });

              if (storeRes.ok) {
                const storeData = await storeRes.json();
                console.log(`[StoryPublisher] Image stored successfully: ${storeData.stored_url}`);

                // Persist the pending image to the database so it survives page refresh
                try {
                  await fetch(`/api/stories/characters/${storyCharId}/set-pending-image`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      image_id: imageId,
                      image_url: storeData.stored_url,
                      type,
                    }),
                  });
                  console.log(`[StoryPublisher] Pending ${type} image persisted to database`);
                } catch (persistErr) {
                  console.warn(`[StoryPublisher] Failed to persist pending image:`, persistErr);
                }

                // Use the permanent stored URL instead of the temporary blob URL
                updateSlot(storyCharId, type, {
                  isGenerating: false,
                  imageUrl: storeData.stored_url,
                  imageId: imageId,
                  error: null,
                  jobId: null,
                  pollStartTime: null,
                  seed: completedSeed,
                  runpodStatus: null,
                });

                // For fullBody images, stitch approved face on top for preview
                if (type === "fullBody") {
                  try {
                    const stitchRes = await fetch(
                      `/api/stories/characters/${storyCharId}/stitch-preview`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ body_image_url: storeData.stored_url }),
                      }
                    );
                    if (stitchRes.ok) {
                      const stitchData = await stitchRes.json();
                      if (stitchData.preview_url) {
                        updateSlot(storyCharId, type, { previewUrl: stitchData.preview_url });
                        console.log(`[StoryPublisher] Stitched face+body preview ready`);
                      }
                    }
                  } catch (stitchErr) {
                    console.warn(`[StoryPublisher] Stitching failed — showing body only:`, stitchErr);
                  }
                }
              } else {
                console.warn(`[StoryPublisher] Storage failed, using blob URL as fallback`);
                updateSlot(storyCharId, type, {
                  isGenerating: false,
                  imageUrl: data.imageUrl,
                  imageId: imageId,
                  error: null,
                  jobId: null,
                  pollStartTime: null,
                  seed: completedSeed,
                  runpodStatus: null,
                });
              }
            } catch (err) {
              console.error(`[StoryPublisher] Error storing image:`, err);
              updateSlot(storyCharId, type, {
                isGenerating: false,
                imageUrl: data.imageUrl,
                imageId: imageId,
                error: null,
                jobId: null,
                pollStartTime: null,
                seed: completedSeed,
                runpodStatus: null,
              });
            }
          }
        } catch {
          // Silently retry — will timeout eventually
        }
      }, POLL_INTERVAL);
    },
    [updateSlot, characters]
  );

  // ------- Actions -------

  const handleGenerate = useCallback(
    async (storyCharId: string, type: ImageType) => {
      const stage = type === "fullBody" ? "body" : "face";
      console.log(`[StoryPublisher] Generating ${stage} (${type}) for character ${storyCharId}`);
      updateSlot(storyCharId, type, { isGenerating: true, error: null });

      try {
        const state = charStates[storyCharId]?.[type];
        const body: Record<string, string | number> = { type, stage };
        if (modelUrn) body.model_urn = modelUrn;
        if (state?.lockSeed && state.seed) body.seed = state.seed;
        const slotPrompt = state?.prompt;
        if (slotPrompt && slotPrompt.trim().length > 20) {
          body.customPrompt = slotPrompt;
        }

        const res = await fetch(
          `/api/stories/characters/${storyCharId}/generate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        if (!res.ok) {
          let errMsg = `Generation failed (HTTP ${res.status})`;
          try {
            const err = await res.json();
            const detail = err.details ? ` — ${err.details}` : "";
            errMsg = (err.error || "Generation failed") + detail;
          } catch { /* server returned non-JSON (HTML error page) */ }
          throw new Error(errMsg);
        }
        const data = await res.json();
        console.log(`[StoryPublisher] Generation started - jobId: ${data.jobId}, imageId: ${data.imageId}, type: ${type}, instant: ${!!data.instant}`);

        // Nano Banana 2 returns instantly — no polling needed
        if (data.instant && data.storedUrl) {
          updateSlot(storyCharId, type, {
            isGenerating: false,
            imageUrl: data.storedUrl,
            imageId: data.imageId,
            error: null,
            jobId: null,
            pollStartTime: null,
            seed: data.seed ?? null,
            runpodStatus: null,
          });

          // Persist as pending image
          try {
            await fetch(`/api/stories/characters/${storyCharId}/set-pending-image`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                image_id: data.imageId,
                image_url: data.storedUrl,
                type,
              }),
            });
          } catch {
            // Non-fatal
          }
        } else {
          startPolling(storyCharId, type, data.jobId, data.imageId);
        }
      } catch (err) {
        console.error(`[StoryPublisher] Error in handleGenerate:`, err);
        updateSlot(storyCharId, type, {
          isGenerating: false,
          error: err instanceof Error ? err.message : "Generation failed",
        });
      }
    },
    [charStates, updateSlot, startPolling, modelUrn]
  );

  const handleRegenerate = useCallback(
    async (storyCharId: string, type: ImageType) => {
      const state = charStates[storyCharId]?.[type];
      if (!state) return;

      const stage = type === "fullBody" ? "body" : "face";

      updateSlot(storyCharId, type, {
        isGenerating: true,
        error: null,
        approved: false,
        approvedUrl: null,
      });

      try {
        const body: Record<string, string | number> = { type, stage };
        if (modelUrn) body.model_urn = modelUrn;
        if (state.lockSeed && state.seed) body.seed = state.seed;

        const res = await fetch(
          `/api/stories/characters/${storyCharId}/regenerate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        if (!res.ok) {
          let errMsg = `Regeneration failed (HTTP ${res.status})`;
          try {
            const err = await res.json();
            const detail = err.details ? ` — ${err.details}` : "";
            errMsg = (err.error || "Regeneration failed") + detail;
          } catch { /* server returned non-JSON (HTML error page) */ }
          throw new Error(errMsg);
        }
        const data = await res.json();

        // Nano Banana 2 returns instantly
        if (data.instant && data.storedUrl) {
          updateSlot(storyCharId, type, {
            isGenerating: false,
            imageUrl: data.storedUrl,
            imageId: data.imageId,
            error: null,
            jobId: null,
            pollStartTime: null,
            seed: data.seed ?? null,
            runpodStatus: null,
          });
        } else {
          startPolling(storyCharId, type, data.jobId, data.imageId);
        }
      } catch (err) {
        updateSlot(storyCharId, type, {
          isGenerating: false,
          error: err instanceof Error ? err.message : "Regeneration failed",
        });
      }
    },
    [charStates, updateSlot, startPolling, modelUrn]
  );

  const handleApprove = useCallback(
    async (storyCharId: string, type: ImageType) => {
      const state = charStates[storyCharId]?.[type];
      if (!state?.imageId) {
        console.error(`[StoryPublisher] Cannot approve - no imageId for character ${storyCharId} (${type})`);
        return;
      }

      console.log(`[StoryPublisher] Approving ${type} for character ${storyCharId}, imageId: ${state.imageId}`);
      updateSlot(storyCharId, type, { error: null });

      try {
        const res = await fetch(
          `/api/stories/characters/${storyCharId}/approve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              image_id: state.imageId,
              seed: state.seed,
              prompt: state.prompt, // Flux identity preview stored as approved_prompt
              type,
            }),
          }
        );
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Approval failed");
        }
        const data = await res.json();
        const finalUrl = data.stored_url || state.imageUrl;
        updateSlot(storyCharId, type, {
          approved: true,
          approvedUrl: finalUrl,
        });
        onCharacterApproved?.(storyCharId, finalUrl!, state.imageId!, type);

        // Flag that references changed if LoRA is already deployed
        const loraState = charStates[storyCharId]?.lora;
        if (loraState?.status === 'deployed') {
          updateLoraState(storyCharId, { referencesChanged: true });
        }
      } catch (err) {
        console.error(`[StoryPublisher] Error in handleApprove:`, err);
        updateSlot(storyCharId, type, {
          error: err instanceof Error ? err.message : "Approval failed",
        });
      }
    },
    [charStates, updateSlot, onCharacterApproved, characters]
  );

  const handleCheckStatus = useCallback(
    async (storyCharId: string, type: ImageType) => {
      const state = charStates[storyCharId]?.[type];
      if (!state?.jobId || !state?.imageId) {
        updateSlot(storyCharId, type, {
          error: "No job ID found. Please regenerate.",
        });
        return;
      }

      updateSlot(storyCharId, type, {
        isGenerating: true,
        error: null,
      });

      // Re-start polling with the existing jobId and imageId
      startPolling(storyCharId, type, state.jobId, state.imageId);
    },
    [charStates, updateSlot, startPolling]
  );

  const handleGenerateAll = useCallback(async () => {
    setGeneratingAll(true);
    setGenerateAllProgress(null);

    // Build a flat list of (character, type) pairs that need generation
    // Respects face→body sequencing: only queue fullBody if portrait is already approved
    const toGenerate: { ch: CharacterFromAPI; type: ImageType }[] = [];
    for (const ch of characters) {
      const s = charStates[ch.id];
      if (!s) continue;
      if (!s.portrait.imageUrl && !s.portrait.isGenerating && !s.portrait.approved) {
        toGenerate.push({ ch, type: "portrait" });
      }
      if (s.portrait.approved && !s.fullBody.imageUrl && !s.fullBody.isGenerating && !s.fullBody.approved) {
        toGenerate.push({ ch, type: "fullBody" });
      }
    }

    for (let i = 0; i < toGenerate.length; i++) {
      const { ch, type } = toGenerate[i];
      const charName = ch.characters.name;
      const label = type === "fullBody" ? "full body" : "portrait";

      setGenerateAllProgress(`Generating ${i + 1} of ${toGenerate.length}: ${charName} (${label})...`);

      try {
        updateSlot(ch.id, type, { isGenerating: true, error: null });

        const chState = charStates[ch.id]?.[type];
        const stage = type === "fullBody" ? "body" : "face";
        const body: Record<string, string | number> = { type, stage };
        if (modelUrn) body.model_urn = modelUrn;
        if (chState?.lockSeed && chState.seed) body.seed = chState.seed;

        const res = await fetch(
          `/api/stories/characters/${ch.id}/generate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );

        if (!res.ok) {
          const err = await res.json();
          const detail = err.details ? ` — ${err.details}` : "";
          throw new Error((err.error || "Generation failed") + detail);
        }

        const data = await res.json();

        // Nano Banana 2 returns instantly — no polling needed
        if (data.instant && data.storedUrl) {
          updateSlot(ch.id, type, {
            isGenerating: false,
            imageUrl: data.storedUrl,
            imageId: data.imageId,
            error: null,
            jobId: null,
            pollStartTime: null,
            seed: data.seed ?? null,
            runpodStatus: null,
          });
        } else {
          startPolling(ch.id, type, data.jobId, data.imageId);
        }

        // Wait 4 seconds before starting the next one to avoid rate limits
        if (i < toGenerate.length - 1) {
          await new Promise((r) => setTimeout(r, 4000));
        }
      } catch (err) {
        updateSlot(ch.id, type, {
          isGenerating: false,
          error: err instanceof Error ? err.message : "Generation failed",
        });

        if (i < toGenerate.length - 1) {
          await new Promise((r) => setTimeout(r, 4000));
        }
      }
    }

    setGeneratingAll(false);
    setGenerateAllProgress(null);
  }, [characters, charStates, updateSlot, startPolling, modelUrn]);

  // ------- Description Editing -------

  const handleSaveDescription = useCallback(
    async (storyCharId: string, characterId: string) => {
      const state = charStates[storyCharId];
      if (!state) return;

      updateCharMeta(storyCharId, { savingDescription: true, descriptionError: null });

      try {
        const res = await fetch("/api/characters", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: characterId, description: state.descriptionDraft }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Save failed");
        }

        const newPreview = buildFluxIdentityPreview(state.descriptionDraft);
        updateCharMeta(storyCharId, {
          savingDescription: false,
          editingDescription: false,
          descriptionError: null,
          localDescription: { ...state.descriptionDraft },
        });
        // Update the stored prompt in both slots so approval captures the new identity
        updateSlot(storyCharId, "portrait", { prompt: newPreview });
        updateSlot(storyCharId, "fullBody", { prompt: newPreview });
      } catch (err) {
        updateCharMeta(storyCharId, {
          savingDescription: false,
          descriptionError: err instanceof Error ? err.message : "Save failed",
        });
      }
    },
    [charStates, updateCharMeta, updateSlot]
  );

  // ------- LoRA Training Actions -------

  const updateLoraState = useCallback(
    (id: string, updates: Partial<LoraTrainingState>) => {
      setCharStates((prev) => ({
        ...prev,
        [id]: {
          ...prev[id],
          lora: { ...prev[id]?.lora, ...updates },
        },
      }));
    },
    []
  );

  const handleTrainLora = useCallback(
    async (storyCharId: string) => {
      updateLoraState(storyCharId, { isTriggering: true, error: null });

      try {
        const currentState = charStates[storyCharId]?.lora;
        const isRetrain = currentState?.status === 'deployed';

        if (isRetrain) {
          console.log('[Retrain] Sending retrain request for', storyCharId);
        }

        const res = await fetch(
          `/api/stories/characters/${storyCharId}/train-lora`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(isRetrain ? { retrain: true } : {}),
          }
        );

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to start LoRA training");
        }

        const data = await res.json();

        // Reset state so polling picks up the new pipeline progress
        if (isRetrain) {
          updateLoraState(storyCharId, { status: 'no_lora', loraId: null });
        }

        updateLoraState(storyCharId, {
          isTriggering: false,
          referencesChanged: false,
          status: "pending",
          loraId: data.loraId,
        });

        // Start polling for progress
        startLoraPolling(storyCharId);
      } catch (err) {
        updateLoraState(storyCharId, {
          isTriggering: false,
          error: err instanceof Error ? err.message : "Failed to start training",
        });
      }
    },
    [updateLoraState, charStates]
  );

  const loraPollingTimers = useRef<Record<string, NodeJS.Timeout>>({});

  const startLoraPolling = useCallback(
    (storyCharId: string) => {
      // Clear existing timer
      if (loraPollingTimers.current[storyCharId]) {
        clearInterval(loraPollingTimers.current[storyCharId]);
      }

      loraPollingTimers.current[storyCharId] = setInterval(async () => {
        try {
          const res = await fetch(`/api/stories/characters/${storyCharId}/lora-progress`);
          if (!res.ok) return;

          const data = await res.json();

          if (!data || data.status === "no_lora") return;

          updateLoraState(storyCharId, {
            status: data.status,
            loraId: data.loraId,
            datasetGenerated: data.progress?.datasetGenerated || 0,
            datasetApproved: data.progress?.datasetApproved || 0,
            humanApproved: data.progress?.humanApproved || 0,
            humanRejected: data.progress?.humanRejected || 0,
            trainingAttempt: data.progress?.trainingAttempt || 0,
            validationScore: data.progress?.validationScore || null,
            error: data.error,
            estimatedTimeRemaining: data.estimatedTimeRemaining,
          });

          // Stop polling when terminal state reached
          if (["deployed", "failed", "archived", "awaiting_dataset_approval"].includes(data.status)) {
            clearInterval(loraPollingTimers.current[storyCharId]);
            delete loraPollingTimers.current[storyCharId];
          }
        } catch {
          // Silently retry
        }
      }, 5000);
    },
    [updateLoraState]
  );

  // Fetch LoRA progress for all approved characters
  const refreshLoraProgress = useCallback(() => {
    for (const ch of characters) {
      if (ch.approved && ch.approved_fullbody) {
        fetch(`/api/stories/characters/${ch.id}/lora-progress`)
          .then((r) => r.json())
          .then((data) => {
            if (data && data.status && data.status !== "no_lora") {
              updateLoraState(ch.id, {
                status: data.status,
                loraId: data.loraId,
                datasetGenerated: data.progress?.datasetGenerated || 0,
                datasetApproved: data.progress?.datasetApproved || 0,
                humanApproved: data.progress?.humanApproved || 0,
                humanRejected: data.progress?.humanRejected || 0,
                trainingAttempt: data.progress?.trainingAttempt || 0,
                validationScore: data.progress?.validationScore || null,
                error: data.error,
                estimatedTimeRemaining: data.estimatedTimeRemaining,
              });

              // If still in progress, start polling
              if (!["deployed", "failed", "archived", "awaiting_dataset_approval", "no_lora"].includes(data.status)) {
                startLoraPolling(ch.id);
              }
            }
          })
          .catch(() => {/* ignore */});
      }
    }
  }, [characters, updateLoraState, startLoraPolling]);

  // On mount: check LoRA progress for already-approved characters
  useEffect(() => {
    refreshLoraProgress();

    return () => {
      Object.values(loraPollingTimers.current).forEach(clearInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch when page becomes visible (e.g. navigating back from dataset approval)
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") {
        refreshLoraProgress();
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [refreshLoraProgress]);

  // ------- Derived state -------

  // A character is "fully ready" when portrait + fullBody approved AND LoRA deployed
  const approvedCount = Object.values(charStates).filter(
    (s) => s.portrait?.approved && s.fullBody?.approved && s.lora?.status === "deployed"
  ).length;
  const totalCount = characters.length;
  const allApproved = totalCount > 0 && approvedCount === totalCount;
  const anyGenerating = Object.values(charStates).some(
    (s) => s.portrait?.isGenerating || s.fullBody?.isGenerating
  );
  const ungeneratedCount = characters.reduce((count, ch) => {
    const s = charStates[ch.id];
    if (!s) return count;
    let needs = 0;
    if (!s.portrait.imageUrl && !s.portrait.isGenerating && !s.portrait.approved) needs++;
    if (!s.fullBody.imageUrl && !s.fullBody.isGenerating && !s.fullBody.approved) needs++;
    return count + needs;
  }, 0);

  // ------- Render -------

  if (characters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <User className="mb-4 h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">
          No characters linked to this series.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Progress header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2 flex-1 mr-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {approvedCount} of {totalCount} characters fully approved
            </span>
            <span className="font-medium">
              {totalCount > 0
                ? Math.round((approvedCount / totalCount) * 100)
                : 0}
              %
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-green-500 transition-all duration-500"
              style={{
                width: `${totalCount > 0 ? (approvedCount / totalCount) * 100 : 0}%`,
              }}
            />
          </div>
        </div>

        {ungeneratedCount > 0 && (
          <div className="flex flex-col items-end gap-2">
            <Button
              onClick={handleGenerateAll}
              disabled={generatingAll || anyGenerating}
              variant="outline"
              size="sm"
            >
              {generatingAll ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="mr-2 h-4 w-4" />
              )}
              Generate All ({ungeneratedCount})
            </Button>
            {generateAllProgress && (
              <p className="text-xs text-muted-foreground">
                {generateAllProgress}
              </p>
            )}
          </div>
        )}
      </div>

      {/* All approved banner OR blocking reasons */}
      {allApproved ? (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Check className="h-5 w-5 text-green-400" />
              <div>
                <p className="font-medium text-green-400">
                  All characters approved!
                </p>
                <p className="text-sm text-green-400/70">
                  You can now proceed to generate story images.
                </p>
              </div>
            </div>
            {onProceedToImages && (
              <Button
                onClick={onProceedToImages}
                className="bg-green-600 hover:bg-green-700"
              >
                Proceed to Image Generation
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      ) : totalCount > 0 && (() => {
        const blockers: string[] = [];
        for (const ch of characters) {
          const s = charStates[ch.id];
          if (!s) continue;
          const reasons: string[] = [];
          if (!s.portrait.approved) reasons.push("face not approved");
          else if (!s.fullBody.approved) reasons.push("body not approved");
          if (s.portrait.approved && s.fullBody.approved && s.lora.status !== "deployed") {
            const loraInProgress = ["pending", "generating_dataset", "evaluating", "captioning", "training", "validating"].includes(s.lora.status);
            const needsReview = s.lora.status === "awaiting_dataset_approval";
            reasons.push(loraInProgress ? "LoRA training in progress" : needsReview ? "dataset needs review" : s.lora.status === "failed" ? "LoRA training failed" : "LoRA not started");
          }
          if (reasons.length > 0) blockers.push(`${ch.characters.name} (${reasons.join(", ")})`);
        }
        return blockers.length > 0 ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-sm text-amber-400">
              <span className="font-medium">Waiting for:</span>{" "}
              {blockers.join(", ")}
            </p>
          </div>
        ) : null;
      })()}

      {/* Character cards */}
      <div className="space-y-6">
        {characters.map((ch) => {
          const state = charStates[ch.id];
          if (!state) return null;

          const role = ROLE_STYLES[ch.role] || ROLE_STYLES.supporting;
          const fullyApproved = state.portrait.approved && state.fullBody.approved;

          return (
            <Card
              key={ch.id}
              className={`transition-colors ${
                fullyApproved
                  ? "border-green-500/30"
                  : (state.portrait.approved || state.fullBody.approved)
                    ? "border-blue-500/30"
                    : ""
              }`}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-xl">
                    {ch.characters.name}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={role.className}>
                      {role.label}
                    </Badge>
                    {fullyApproved && (
                      <Badge
                        variant="outline"
                        className="bg-green-500/20 text-green-400 border-green-500/30"
                      >
                        <Check className="mr-1 h-3 w-3" />
                        Approved
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {/* Step progress indicator */}
                <div className="flex items-center gap-1 text-xs">
                  {(() => {
                    const faceColor = state.portrait.approved ? "text-green-400" : state.portrait.isGenerating ? "text-amber-400" : "text-muted-foreground/40";
                    const faceDot = state.portrait.approved ? "bg-green-400" : state.portrait.isGenerating ? "bg-amber-400" : "bg-muted-foreground/30";
                    const bodyColor = state.fullBody.approved ? "text-green-400" : state.fullBody.isGenerating ? "text-amber-400" : "text-muted-foreground/40";
                    const bodyDot = state.fullBody.approved ? "bg-green-400" : state.fullBody.isGenerating ? "bg-amber-400" : "bg-muted-foreground/30";
                    const loraInProgress = ["pending", "generating_dataset", "evaluating", "captioning", "training", "validating"].includes(state.lora.status);
                    const loraNeedsReview = state.lora.status === "awaiting_dataset_approval";
                    const loraColor = state.lora.status === "deployed" ? "text-green-400" : state.lora.status === "failed" ? "text-red-400" : loraInProgress ? "text-amber-400" : loraNeedsReview ? "text-amber-400" : "text-muted-foreground/40";
                    const loraDot = state.lora.status === "deployed" ? "bg-green-400" : state.lora.status === "failed" ? "bg-red-400" : loraInProgress ? "bg-amber-400" : loraNeedsReview ? "bg-amber-400" : "bg-muted-foreground/30";
                    return (
                      <>
                        <span className={`inline-flex items-center gap-1 ${faceColor}`}>
                          <span className={`inline-block h-2 w-2 rounded-full ${faceDot}`} />
                          Face{state.portrait.approved && <Check className="h-2.5 w-2.5" />}
                        </span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground/30" />
                        <span className={`inline-flex items-center gap-1 ${bodyColor}`}>
                          <span className={`inline-block h-2 w-2 rounded-full ${bodyDot}`} />
                          Body{state.fullBody.approved && <Check className="h-2.5 w-2.5" />}
                        </span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground/30" />
                        <span className={`inline-flex items-center gap-1 ${loraColor}`}>
                          <span className={`inline-block h-2 w-2 rounded-full ${loraDot}`} />
                          LoRA{state.lora.status === "deployed" && <Check className="h-2.5 w-2.5" />}
                        </span>
                      </>
                    );
                  })()}
                </div>

                {/* Collapsible prose description */}
                {ch.prose_description && (
                  <div>
                    <button
                      onClick={() =>
                        updateCharMeta(ch.id, {
                          showDescription: !state.showDescription,
                        })
                      }
                      className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {state.showDescription ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                      Character Description
                    </button>
                    {state.showDescription && (
                      <p className="mt-2 text-sm text-muted-foreground leading-relaxed rounded-md bg-muted/50 p-3">
                        {ch.prose_description}
                      </p>
                    )}
                  </div>
                )}

                {/* Flux identity preview — editable */}
                <div className="rounded-md bg-blue-500/5 border border-blue-500/20 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-blue-400 uppercase tracking-wider">
                      Character Identity Preview
                    </p>
                    {!state.editingDescription ? (
                      <button
                        onClick={() => updateCharMeta(ch.id, {
                          editingDescription: true,
                          descriptionDraft: { ...state.localDescription },
                          descriptionError: null,
                        })}
                        className="flex items-center gap-1 text-xs text-blue-400/70 hover:text-blue-400 transition-colors"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                    ) : (
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => updateCharMeta(ch.id, {
                            editingDescription: false,
                            descriptionError: null,
                          })}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <X className="h-3 w-3" />
                          Cancel
                        </button>
                        <button
                          onClick={() => handleSaveDescription(ch.id, ch.characters.id)}
                          disabled={state.savingDescription}
                          className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors disabled:opacity-50"
                        >
                          {state.savingDescription
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Save className="h-3 w-3" />
                          }
                          Save
                        </button>
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground leading-relaxed font-mono">
                    {buildFluxIdentityPreview(
                      state.editingDescription ? state.descriptionDraft : state.localDescription
                    )}
                  </p>

                  {state.editingDescription && (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2 pt-2 border-t border-blue-500/20">
                      {([
                        { key: "age", label: "Age" },
                        { key: "ethnicity", label: "Ethnicity" },
                        { key: "skinTone", label: "Skin Tone" },
                        { key: "hairColor", label: "Hair Color" },
                        { key: "hairStyle", label: "Hair Style" },
                        { key: "eyeColor", label: "Eye Color" },
                        { key: "bodyType", label: "Body Type" },
                      ] as const).map(({ key, label }) => (
                        <div key={key} className="space-y-1">
                          <label className="text-xs text-muted-foreground/70">{label}</label>
                          <input
                            type="text"
                            value={state.descriptionDraft[key] || ""}
                            onChange={(e) => updateCharMeta(ch.id, {
                              descriptionDraft: { ...state.descriptionDraft, [key]: e.target.value },
                            })}
                            className="w-full rounded px-2 py-1 text-xs bg-background border border-muted text-foreground focus:outline-none focus:border-blue-500/50"
                          />
                        </div>
                      ))}

                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground/70">Gender</label>
                        <select
                          value={state.descriptionDraft.gender || "female"}
                          onChange={(e) => updateCharMeta(ch.id, {
                            descriptionDraft: { ...state.descriptionDraft, gender: e.target.value },
                          })}
                          className="w-full rounded px-2 py-1 text-xs bg-background border border-muted text-foreground focus:outline-none focus:border-blue-500/50"
                        >
                          <option value="female">Female</option>
                          <option value="male">Male</option>
                          <option value="non-binary">Non-binary</option>
                          <option value="other">Other</option>
                        </select>
                      </div>

                      <div className="col-span-2 space-y-1">
                        <label className="text-xs text-muted-foreground/70">Distinguishing Features</label>
                        <textarea
                          value={state.descriptionDraft.distinguishingFeatures || ""}
                          onChange={(e) => updateCharMeta(ch.id, {
                            descriptionDraft: { ...state.descriptionDraft, distinguishingFeatures: e.target.value },
                          })}
                          rows={2}
                          className="w-full rounded px-2 py-1 text-xs bg-background border border-muted text-foreground focus:outline-none focus:border-blue-500/50 resize-none"
                        />
                      </div>
                    </div>
                  )}

                  {state.descriptionError && (
                    <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {state.descriptionError}
                    </div>
                  )}
                </div>

                {/* Dual image slots: Portrait + Full Body */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(["portrait", "fullBody"] as const).map((type) => {
                    const slot = state[type];
                    const hasImage = !!slot.imageUrl;
                    const displayUrl = slot.approved
                      ? slot.approvedUrl || slot.imageUrl
                      : slot.imageUrl;
                    const showingComposite = false; // stitch-preview no longer used as primary display
                    const label = type === "portrait" ? "Face Portrait" : "Full Body";
                    const aspectClass = type === "portrait" ? "aspect-[3/4]" : "aspect-[5/8]";
                    const isBodyLocked = type === "fullBody" && !state.portrait.approved;

                    return (
                      <div key={type} className={`space-y-3 ${isBodyLocked ? "relative" : ""}`}>
                        {isBodyLocked && (
                          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg bg-background/80 backdrop-blur-sm">
                            <Lock className="mb-2 h-6 w-6 text-muted-foreground/50" />
                            <p className="text-sm text-muted-foreground/70">Approve face first</p>
                          </div>
                        )}
                        {/* Slot label */}
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            {label}
                          </span>
                          {slot.approved ? (
                            <span className="text-xs text-green-400 flex items-center gap-1">
                              <Check className="h-3 w-3" /> Approved
                            </span>
                          ) : hasImage ? (
                            <span className="text-xs text-blue-400">Generated</span>
                          ) : slot.isGenerating ? (
                            <span className="text-xs text-blue-400">Generating...</span>
                          ) : (
                            <span className="text-xs text-muted-foreground/50">Not generated</span>
                          )}
                        </div>

                        {/* Image display area */}
                        <div className="relative">
                          {slot.isGenerating ? (
                            <div className={`flex flex-col items-center justify-center rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 ${aspectClass}`}>
                              <Loader2 className="mb-3 h-8 w-8 animate-spin text-blue-400" />
                              <p className="text-sm font-medium text-blue-400">
                                {slot.runpodStatus === "IN_QUEUE"
                                  ? "Waiting for GPU worker..."
                                  : slot.runpodStatus === "IN_PROGRESS"
                                    ? type === "fullBody"
                                      ? "Rendering body with face swap..."
                                      : `Rendering ${label.toLowerCase()}...`
                                    : "Submitting to GPU..."}
                              </p>
                              {slot.pollStartTime && (() => {
                                const elapsed = Math.floor((Date.now() - slot.pollStartTime) / 1000);
                                return (
                                  <>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      {elapsed < 60
                                        ? `${elapsed}s elapsed`
                                        : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s elapsed`}
                                    </p>
                                    {elapsed > 60 && slot.runpodStatus === "IN_QUEUE" && (
                                      <p className="mt-1 text-xs text-muted-foreground/70">
                                        GPU worker is starting up — this can take a few minutes on first run
                                      </p>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          ) : displayUrl ? (
                            <>
                              <div
                                className="relative overflow-hidden rounded-lg cursor-zoom-in"
                                onClick={() => setLightboxUrl(displayUrl)}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={displayUrl}
                                  alt={`${label} of ${ch.characters.name}`}
                                  className={`h-full w-full object-cover rounded-lg ${slot.approved ? "ring-2 ring-green-500/50" : ""}`}
                                  style={{ aspectRatio: type === "portrait" ? "3/4" : "5/8" }}
                                />
                                {slot.approved && (
                                  <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-green-600/90 px-2 py-1 text-xs font-medium text-white shadow-lg backdrop-blur-sm">
                                    <Check className="h-3 w-3" />
                                  </div>
                                )}
                              </div>
                            </>
                          ) : (
                            <div className={`flex flex-col items-center justify-center rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 ${aspectClass}`}>
                              <User className="mb-2 h-8 w-8 text-muted-foreground/50" />
                              <p className="text-xs text-muted-foreground">
                                No {label.toLowerCase()} yet
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Error display */}
                        {slot.error && (
                          <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400">
                            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {slot.error}
                          </div>
                        )}

                        {/* Lock Seed option */}
                        <div className="flex items-center gap-2">
                          <label
                            className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer"
                            title={slot.lockSeed
                              ? "When locked, regeneration keeps the same base appearance. Unlock for a completely new look."
                              : "Unlocked — regeneration will produce a completely different look."}
                          >
                            <input
                              type="checkbox"
                              checked={slot.lockSeed}
                              onChange={(e) =>
                                updateSlot(ch.id, type, { lockSeed: e.target.checked })
                              }
                              disabled={slot.isGenerating}
                              className="rounded border-muted-foreground/30"
                            />
                            {slot.lockSeed ? (
                              <span>
                                Lock Seed{" "}
                                <span className="text-muted-foreground/50">
                                  {slot.isGenerating
                                    ? "(Generating...)"
                                    : slot.seed != null
                                      ? `(${slot.seed})`
                                      : "(no seed yet)"}
                                </span>
                              </span>
                            ) : (
                              <span>Random Seed</span>
                            )}
                          </label>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {!hasImage && !slot.isGenerating && !slot.error && (
                            <Button
                              onClick={() => handleGenerate(ch.id, type)}
                              disabled={generatingAll || isBodyLocked}
                              size="sm"
                            >
                              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                              Generate {label}
                            </Button>
                          )}

                          {!slot.isGenerating && slot.error && slot.jobId && (
                            <>
                              <Button
                                onClick={() => handleCheckStatus(ch.id, type)}
                                disabled={generatingAll || isBodyLocked}
                                size="sm"
                                variant="outline"
                              >
                                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                                Check Status
                              </Button>
                              <Button
                                onClick={() => handleGenerate(ch.id, type)}
                                disabled={generatingAll || isBodyLocked}
                                size="sm"
                              >
                                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                                Generate New
                              </Button>
                            </>
                          )}

                          {!hasImage && !slot.isGenerating && slot.error && !slot.jobId && (
                            <Button
                              onClick={() => handleGenerate(ch.id, type)}
                              disabled={generatingAll || isBodyLocked}
                              size="sm"
                            >
                              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                              Generate {label}
                            </Button>
                          )}

                          {hasImage && !slot.isGenerating && (
                            <Button
                              onClick={() => handleRegenerate(ch.id, type)}
                              disabled={isBodyLocked}
                              variant="outline"
                              size="sm"
                            >
                              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                              Regenerate
                            </Button>
                          )}

                          {hasImage && !slot.approved && !slot.isGenerating && (
                            <Button
                              onClick={() => handleApprove(ch.id, type)}
                              disabled={isBodyLocked}
                              size="sm"
                              className="bg-green-600 hover:bg-green-700"
                            >
                              <Check className="mr-1.5 h-3.5 w-3.5" />
                              Approve {type === "portrait" ? "Face" : "Body"}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Combined status line */}
                <div className="flex items-center gap-3 text-xs text-muted-foreground border-t border-muted/50 pt-3">
                  <span>
                    Face: {state.portrait.approved ? (
                      <span className="text-green-400">Approved</span>
                    ) : state.portrait.imageUrl ? (
                      <span className="text-blue-400">Pending approval</span>
                    ) : (
                      <span className="text-muted-foreground/50">Not generated</span>
                    )}
                  </span>
                  <span className="text-muted-foreground/30">|</span>
                  <span>
                    Full Body: {state.fullBody.approved ? (
                      <span className="text-green-400">Approved</span>
                    ) : state.fullBody.imageUrl ? (
                      <span className="text-blue-400">Pending approval</span>
                    ) : (
                      <span className="text-muted-foreground/50">Not generated</span>
                    )}
                  </span>
                </div>

                {/* LoRA Training Section */}
                <LoraTrainingSection
                  storyCharId={ch.id}
                  seriesId={seriesId}
                  characterName={ch.characters.name}
                  loraState={state.lora}
                  onTrain={() => handleTrainLora(ch.id)}
                  onStartPolling={() => startLoraPolling(ch.id)}
                  locked={!fullyApproved}
                />
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            onClick={() => setLightboxUrl(null)}
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="Enlarged portrait"
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LoRA Training Section Component
// ---------------------------------------------------------------------------

const LORA_STATUS_CONFIG: Record<string, { label: string; color: string; description: string }> = {
  no_lora: { label: "Not Started", color: "text-muted-foreground/50", description: "Train a character LoRA for consistent identity across all scenes" },
  pending: { label: "Starting...", color: "text-blue-400", description: "Initializing pipeline" },
  generating_dataset: { label: "Generating Dataset", color: "text-blue-400", description: "Creating training images (Nano Banana 2 + ComfyUI)" },
  evaluating: { label: "Evaluating Quality", color: "text-blue-400", description: "Claude Vision is checking face & body consistency" },
  awaiting_dataset_approval: { label: "Review Dataset", color: "text-amber-400", description: "Dataset generated — review and approve images before training" },
  captioning: { label: "Captioning", color: "text-blue-400", description: "Generating training captions" },
  training: { label: "Training LoRA", color: "text-purple-400", description: "Character LoRA training in progress" },
  validating: { label: "Validating", color: "text-purple-400", description: "Testing LoRA with sample generations" },
  deployed: { label: "Active", color: "text-green-400", description: "Character LoRA is deployed and will be used in scene generation" },
  failed: { label: "Failed", color: "text-red-400", description: "Training failed — click Retry to try again" },
  archived: { label: "Not Started", color: "text-muted-foreground/50", description: "Previous LoRA archived — ready for retraining" },
};

function LoraTrainingSection({
  storyCharId,
  seriesId,
  characterName,
  loraState,
  onTrain,
  onStartPolling,
  locked,
}: {
  storyCharId: string;
  seriesId: string;
  characterName: string;
  loraState: LoraTrainingState;
  onTrain: () => void;
  onStartPolling: () => void;
  locked: boolean;
}) {
  const [generatingMore, setGeneratingMore] = useState(false);

  const config = LORA_STATUS_CONFIG[loraState.status] || LORA_STATUS_CONFIG.no_lora;
  const isInProgress = !["no_lora", "deployed", "failed", "archived", "awaiting_dataset_approval"].includes(loraState.status);
  const isDeployed = loraState.status === "deployed";
  const isFailed = loraState.status === "failed";

  const handleGenerateMore = async () => {
    setGeneratingMore(true);
    try {
      const res = await fetch(`/api/stories/characters/${storyCharId}/generate-more-dataset`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("Generate more failed:", err.error);
      } else {
        onStartPolling();
      }
    } catch {
      // ignore
    }
    setGeneratingMore(false);
  };

  return (
    <div className="border-t border-muted/50 pt-3 mt-1 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Dna className={`h-4 w-4 ${isDeployed ? "text-green-400" : isInProgress ? "text-purple-400" : "text-muted-foreground/50"}`} />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            LoRA Training
          </span>
          <span className={`text-xs font-medium ${config.color}`}>
            {config.label}
          </span>
        </div>

        {/* Action buttons */}
        {(loraState.status === "no_lora" || loraState.status === "archived") && (
          <Button
            onClick={onTrain}
            disabled={loraState.isTriggering || locked}
            size="sm"
            variant="outline"
            className="border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
            title={locked ? "Approve body first" : undefined}
          >
            {locked ? (
              <Lock className="mr-1.5 h-3.5 w-3.5" />
            ) : loraState.isTriggering ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Dna className="mr-1.5 h-3.5 w-3.5" />
            )}
            {locked ? "Approve body first" : "Generate Dataset Images"}
          </Button>
        )}

        {loraState.status === "awaiting_dataset_approval" && (
          <div className="flex items-center gap-2">
            <Button
              onClick={handleGenerateMore}
              disabled={generatingMore}
              size="sm"
              variant="outline"
              className="border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
            >
              {generatingMore ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Dna className="mr-1.5 h-3.5 w-3.5" />
              )}
              Generate Dataset Images
            </Button>
            <a
              href={`/dashboard/stories/${seriesId}/dataset-approval/${storyCharId}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-transparent px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/10"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Review Dataset
            </a>
          </div>
        )}

        {isFailed && loraState.loraId && (
          <a
            href={`/dashboard/stories/${seriesId}/dataset-approval/${storyCharId}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-600 bg-transparent px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-200"
          >
            <Eye className="h-3.5 w-3.5" />
            View Dataset
          </a>
        )}

        {isFailed && (
          <div className="flex items-center gap-2">
            <Button
              onClick={onTrain}
              disabled={loraState.isTriggering || locked}
              size="sm"
              variant="outline"
              className="border-red-500/30 text-red-400 hover:bg-red-500/10"
              title={locked ? "Approve body first" : undefined}
            >
              {loraState.isTriggering ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              )}
              Retry
            </Button>
            {loraState.loraId && (
              <Button
                onClick={handleGenerateMore}
                disabled={generatingMore}
                size="sm"
                variant="outline"
                className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
              >
                {generatingMore ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                Generate more images
              </Button>
            )}
          </div>
        )}

        {isDeployed && loraState.referencesChanged && (
          <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 space-y-2">
            <p className="text-xs text-amber-300">
              Reference images updated — dataset and LoRA are out of date.
            </p>
            <Button
              onClick={onTrain}
              disabled={loraState.isTriggering}
              size="sm"
              className="bg-amber-600 text-white hover:bg-amber-500"
            >
              {loraState.isTriggering ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              )}
              Regenerate Dataset &amp; Retrain
            </Button>
          </div>
        )}

        {isDeployed && !loraState.referencesChanged && (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-green-400">
              <Check className="h-3 w-3" />
              LoRA Active
            </span>
            <Button
              onClick={onTrain}
              disabled={loraState.isTriggering}
              size="sm"
              variant="outline"
              className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
            >
              {loraState.isTriggering ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              )}
              Retrain
            </Button>
          </div>
        )}
      </div>

      {/* Progress details for in-progress states */}
      {isInProgress && (
        <div className="rounded-md bg-purple-500/5 border border-purple-500/20 p-2.5 space-y-1.5">
          <p className="text-xs text-purple-300">{config.description}</p>

          {loraState.status === "generating_dataset" && loraState.datasetGenerated > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Dataset: {loraState.datasetGenerated}/30 images</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted/50">
                <div
                  className="h-1.5 rounded-full bg-purple-500 transition-all duration-500"
                  style={{ width: `${Math.min(100, (loraState.datasetGenerated / 30) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {loraState.status === "evaluating" && (
            <p className="text-xs text-muted-foreground">
              {loraState.datasetApproved} images approved so far
            </p>
          )}

          {loraState.status === "training" && loraState.trainingAttempt > 0 && (
            <p className="text-xs text-muted-foreground">
              Attempt {loraState.trainingAttempt}/3
            </p>
          )}

          {loraState.estimatedTimeRemaining && (
            <p className="text-xs text-muted-foreground/70">
              Estimated: {loraState.estimatedTimeRemaining}
            </p>
          )}

          <div className="flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin text-purple-400" />
            <span className="text-xs text-purple-400">Running in background...</span>
          </div>
        </div>
      )}

      {/* Awaiting dataset approval */}
      {loraState.status === "awaiting_dataset_approval" && (
        <div className="rounded-md bg-amber-500/5 border border-amber-500/20 p-2.5 space-y-1.5">
          <p className="text-xs text-amber-300">{config.description}</p>
          <p className="text-xs text-muted-foreground">
            {loraState.humanApproved}/{20} approved · {loraState.datasetApproved} AI-passed · {loraState.datasetGenerated} total
          </p>
        </div>
      )}

      {/* Failed — show dataset counts so user knows where things stand */}
      {loraState.status === "failed" && loraState.datasetGenerated > 0 && (
        <div className="rounded-md bg-zinc-500/5 border border-zinc-500/20 p-2.5 space-y-1.5">
          <p className="text-xs text-muted-foreground">
            {loraState.humanApproved}/{20} approved · {loraState.datasetApproved} AI-passed · {loraState.datasetGenerated} total
          </p>
        </div>
      )}

      {/* Error display — hide if user has since approved enough images */}
      {loraState.error && loraState.humanApproved < 20 && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {loraState.error}
        </div>
      )}

      {/* Deployed details */}
      {isDeployed && (
        <p className="text-xs text-muted-foreground/70">
          {config.description}
          {loraState.validationScore && ` (validation: ${loraState.validationScore.toFixed(1)}/10)`}
        </p>
      )}

      {/* Not started description */}
      {(loraState.status === "no_lora" || loraState.status === "archived") && (
        <p className="text-xs text-muted-foreground/50">
          {config.description}
        </p>
      )}
    </div>
  );
}
