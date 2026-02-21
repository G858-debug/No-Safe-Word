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
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CharacterFromAPI {
  id: string; // story_character id
  role: string;
  prose_description: string | null;
  approved: boolean;
  approved_image_id: string | null;
  approved_seed: number | null;
  characters: {
    id: string;
    name: string;
    description: Record<string, unknown>;
  };
  approved_image_url: string | null;
  pending_image_id: string | null;
  pending_image_url: string | null;
}

interface CharacterApprovalProps {
  seriesId: string;
  characters: CharacterFromAPI[];
  modelUrn?: string;
  onProceedToImages?: () => void;
  onCharacterApproved?: (storyCharId: string, imageUrl: string, imageId: string) => void;
}

interface CharState {
  imageUrl: string | null;
  imageId: string | null;
  isGenerating: boolean;
  approved: boolean;
  approvedUrl: string | null;
  prompt: string;
  negativePrompt: string;
  promptEdited: boolean;
  error: string | null;
  showDescription: boolean;
  jobId: string | null;
  pollStartTime: number | null;
  seed: number | null;
  lockSeed: boolean;
  runpodStatus: "IN_QUEUE" | "IN_PROGRESS" | null;
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
 * Ensure the age in a portrait prompt matches the canonical age from character data.
 * If the prompt contains a different age (e.g. manually edited), replace it.
 */
function ensureCorrectAge(prompt: string, correctAge: string): string {
  if (!correctAge) return prompt;
  // Age appears right after the quality prefix as a standalone number token
  return prompt.replace(
    /(masterpiece,\s*best quality,\s*highly detailed,\s*)\d{1,3}(\s*years?\s*old)?/,
    `$1${correctAge}`
  );
}

/** Simplify long bodyType descriptions to prevent SDXL bodybuilder exaggeration */
function simplifyBodyType(raw: string): string {
  if (!raw.includes(",")) return raw;
  const buildKw = [
    "slim", "slender", "petite", "lean", "thin",
    "athletic", "toned", "fit", "gym-fit",
    "muscular", "naturally muscular", "well-built",
    "curvy", "curvaceous", "voluptuous", "full-figured",
    "stocky", "heavyset", "broad", "tall", "short",
  ];
  const lower = raw.toLowerCase();
  const matched: string[] = [];
  for (const kw of buildKw) {
    if (lower.includes(kw)) {
      if (kw === "muscular" && matched.some((m) => m.includes("muscular"))) continue;
      matched.push(kw);
    }
  }
  return matched.length > 0 ? matched.slice(0, 3).join(", ") : raw.split(",")[0].trim();
}

/** Strip full-body framing cues that cause NSFW issues in head-and-shoulders portraits */
function stripFullBodyCues(text: string): string {
  return text.replace(/\b(?:full[- ]?body|full[- ]?length|from head to toe)\b/gi, "").replace(/\s{2,}/g, " ").trim();
}

/** Detect African male character from description fields (client-side mirror) */
function isAfricanMaleDesc(d: Record<string, string>): boolean {
  return (
    d.gender === "male" &&
    /\b(?:Black|African|Zulu|Xhosa|Ndebele|Sotho|Tswana|Venda|Tsonga)\b/i.test(d.ethnicity || "")
  );
}

/** Client-side mirror of the server prompt builder for portrait shots */
function buildPortraitPrompt(desc: Record<string, unknown>): string {
  const d = desc as Record<string, string>;
  const africanMale = isAfricanMaleDesc(d);
  const parts: string[] = ["masterpiece, best quality, highly detailed, (skin pores:1.1), (natural skin texture:1.2), (matte skin:1.1)"];

  if (d.age) parts.push(d.age);
  if (d.gender) parts.push(d.gender);

  if (d.ethnicity) {
    if (africanMale) {
      parts.push("(African male:1.3)");
      const specific = (d.ethnicity || "").replace(/^Black\s+/i, "").trim();
      if (specific && specific.toLowerCase() !== "african") {
        parts.push(specific);
      }
    } else {
      parts.push(d.ethnicity);
    }
  }

  if (d.bodyType) {
    const sanitized = stripFullBodyCues(simplifyBodyType(d.bodyType));
    if (sanitized) {
      parts.push(/\bbody\b|build\b|figure\b|frame\b|physique\b/i.test(sanitized)
        ? sanitized
        : `${sanitized} body`);
    }
  }

  if (d.hairColor && d.hairStyle) {
    const needsSuffix = !/\bhair\b/i.test(d.hairStyle);
    parts.push(`${d.hairColor} ${d.hairStyle}${needsSuffix ? " hair" : ""}`);
  } else if (d.hairColor) {
    parts.push(`${d.hairColor} hair`);
  } else if (d.hairStyle) {
    parts.push(/\bhair\b/i.test(d.hairStyle) ? d.hairStyle : `${d.hairStyle} hair`);
  }

  if (d.eyeColor) parts.push(`${d.eyeColor} eyes`);

  if (d.skinTone) {
    parts.push(`${d.skinTone} skin`);
  }

  if (africanMale) {
    parts.push("full lips, strong jawline");
  }

  if (d.expression) parts.push(`${d.expression} expression`);
  if (d.clothing) parts.push(`wearing ${d.clothing}`);
  if (d.pose) parts.push(d.pose);
  if (d.distinguishingFeatures) parts.push(d.distinguishingFeatures);

  parts.push("studio portrait, clean neutral background");
  parts.push("soft studio lighting");
  parts.push("professional portrait mood");
  parts.push(
    "head and shoulders portrait, looking at camera, neutral expression, photorealistic"
  );

  return parts.filter(Boolean).join(", ");
}

/** Client-side mirror of the server negative prompt builder for portraits */
function buildPortraitNegativePrompt(desc: Record<string, unknown>): string {
  const d = desc as Record<string, string>;
  let result =
    "(deformed, distorted, disfigured:1.3), poorly drawn, bad anatomy, wrong anatomy, extra limb, missing limb, floating limbs, mutated hands, extra fingers, missing fingers, (blurry:1.2), bad quality, watermark, text, signature, (cross-eyed:1.3), (strabismus:1.3), asymmetric eyes, different eye directions, (extra people:1.2), extra face, clone face, (3d render, cgi, illustration, cartoon, anime, painting, drawing:1.3), (bad teeth, deformed teeth:1.1)";

  // Portraits are always SFW
  result += ", (nsfw:1.5), (nude:1.5), (naked:1.5), (topless:1.5), (nipples:1.5), (breast:1.3), explicit, exposed skin";

  // African feature correction for male characters
  if (isAfricanMaleDesc(d)) {
    result += ", European facial features, caucasian features";
  }

  return result;
}

/** Debug levels for systematic resource testing */
const DEBUG_LEVELS = [
  { value: "full", label: "Full Pipeline", description: "Normal — all resources active" },
  { value: "bare", label: "Bare", description: "No LoRAs, minimal negative, no FaceDetailer" },
  { value: "model", label: "+ Model Selection", description: "Auto-selected model, no LoRAs, minimal negative, no FaceDetailer" },
  { value: "loras", label: "+ LoRAs", description: "Model + LoRAs, minimal negative, no FaceDetailer" },
  { value: "negative", label: "+ Full Negative", description: "Model + LoRAs + full negative prompt, no FaceDetailer" },
] as const;

/** Available checkpoint models */
const MODEL_OPTIONS = [
  { value: "auto", label: "Auto (pipeline default)" },
  { value: "juggernaut-x-v10.safetensors", label: "Juggernaut XL v10" },
  { value: "realvisxl-v5.safetensors", label: "RealVisXL V5.0" },
  { value: "lustify-v5-endgame.safetensors", label: "Lustify V5 Endgame" },
] as const;

const POLL_INTERVAL = 3000;
const MAX_POLL_ATTEMPTS = 360; // 18 minutes (cold starts with premium model downloads take ~14 min)

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
  const [debugLevel, setDebugLevel] = useState("full");
  const [forceModel, setForceModel] = useState("auto");

  // Initialize state from props (runs once)
  useEffect(() => {
    console.log(`[StoryPublisher] CharacterApproval mounted with ${characters.length} characters:`,
      characters.map(ch => ({
        id: ch.id,
        name: ch.characters.name,
        approved: ch.approved,
        approved_image_id: ch.approved_image_id,
        approved_image_url: ch.approved_image_url
      }))
    );

    const initial: Record<string, CharState> = {};
    for (const ch of characters) {
      // Use approved image if available, otherwise use pending image
      const imageUrl = ch.approved_image_url || ch.pending_image_url || null;
      const imageId = ch.approved_image_id || ch.pending_image_id || null;

      initial[ch.id] = {
        imageUrl,
        imageId,
        isGenerating: false,
        approved: ch.approved,
        approvedUrl: ch.approved_image_url || null,
        prompt: buildPortraitPrompt(ch.characters.description || {}),
        negativePrompt: buildPortraitNegativePrompt(ch.characters.description || {}),
        promptEdited: false,
        error: null,
        showDescription: false,
        jobId: null,
        pollStartTime: null,
        seed: ch.approved_seed ?? null,
        lockSeed: true,
        runpodStatus: null,
      };
    }
    setCharStates(initial);
    console.log(`[StoryPublisher] Initial character states:`, initial);
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
    const anyGenerating = Object.values(charStates).some((s) => s.isGenerating);
    if (!anyGenerating) return;

    const interval = setInterval(() => {
      setTick((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [charStates]);

  // ------- Helpers -------

  const updateChar = useCallback(
    (id: string, updates: Partial<CharState>) => {
      setCharStates((prev) => ({
        ...prev,
        [id]: { ...prev[id], ...updates },
      }));
    },
    []
  );

  const startPolling = useCallback(
    (storyCharId: string, jobId: string, imageId: string) => {
      console.log(`[StoryPublisher] Starting polling for character ${storyCharId}, jobId: ${jobId}, imageId: ${imageId}`);

      // Clear existing poll if any
      if (pollTimers.current[storyCharId]) {
        clearInterval(pollTimers.current[storyCharId]);
      }
      pollCounts.current[storyCharId] = 0;
      const startTime = Date.now();

      // Store jobId and start time in state
      updateChar(storyCharId, {
        jobId,
        pollStartTime: startTime,
      });

      pollTimers.current[storyCharId] = setInterval(async () => {
        pollCounts.current[storyCharId]++;
        const elapsed = Math.floor((Date.now() - startTime) / 1000);

        if (pollCounts.current[storyCharId] >= MAX_POLL_ATTEMPTS) {
          console.error(`[StoryPublisher] Generation timed out for character ${storyCharId} after ${elapsed}s`);
          clearInterval(pollTimers.current[storyCharId]);
          delete pollTimers.current[storyCharId];
          updateChar(storyCharId, {
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
          console.log(`[StoryPublisher] Poll attempt ${pollCounts.current[storyCharId]} for ${storyCharId}:`, {
            completed: data.completed,
            hasImageUrl: !!data.imageUrl
          });

          // Track RunPod status for phase-aware progress messages
          if (data.status && !data.completed) {
            updateChar(storyCharId, { runpodStatus: data.status });
          }

          if (data.error && !data.completed) {
            console.error(`[StoryPublisher] Generation failed for ${storyCharId}:`, data.error);
            clearInterval(pollTimers.current[storyCharId]);
            delete pollTimers.current[storyCharId];
            updateChar(storyCharId, {
              isGenerating: false,
              error: data.error,
              pollStartTime: null,
              runpodStatus: null,
            });
            return;
          }

          if (data.completed && data.imageUrl) {
            console.log(`[StoryPublisher] Generation completed for ${storyCharId}, imageUrl: ${data.imageUrl}, seed: ${data.seed}`);
            clearInterval(pollTimers.current[storyCharId]);
            delete pollTimers.current[storyCharId];
            const completedSeed: number | null = data.seed ?? null;

            // Immediately store the image to Supabase Storage to preserve it
            try {
              const character = characters.find((c) => c.id === storyCharId);
              const characterName = character?.characters.name || "character";
              const timestamp = Date.now();
              const filename = `characters/${characterName.replace(/\s+/g, "-").toLowerCase()}-${timestamp}.jpeg`;

              console.log(`[StoryPublisher] Storing image to Supabase Storage for ${characterName}`);
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
                    }),
                  });
                  console.log(`[StoryPublisher] Pending image persisted to database`);
                } catch (persistErr) {
                  console.warn(`[StoryPublisher] Failed to persist pending image:`, persistErr);
                }

                // Use the permanent stored URL instead of the temporary blob URL
                updateChar(storyCharId, {
                  isGenerating: false,
                  imageUrl: storeData.stored_url,
                  imageId: imageId,
                  error: null,
                  jobId: null,
                  pollStartTime: null,
                  seed: completedSeed,
                  runpodStatus: null,
                });
              } else {
                console.warn(`[StoryPublisher] Storage failed, using blob URL as fallback`);
                // Fallback to blob URL if storage fails
                updateChar(storyCharId, {
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
              // Fallback to blob URL if storage fails
              updateChar(storyCharId, {
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
    [updateChar, characters]
  );

  // ------- Actions -------

  const handleGenerate = useCallback(
    async (storyCharId: string) => {
      console.log(`[StoryPublisher] Generating portrait for character ${storyCharId}, debugLevel: ${debugLevel}`);
      updateChar(storyCharId, { isGenerating: true, error: null });

      try {
        const state = charStates[storyCharId];
        const body: Record<string, string | number> = {};
        if (modelUrn) body.model_urn = modelUrn;
        if (debugLevel !== "full") body.debugLevel = debugLevel;
        if (forceModel !== "auto") body.forceModel = forceModel;
        if (state?.promptEdited) body.negativePrompt = state.negativePrompt;
        if (state?.lockSeed && state.seed) body.seed = state.seed;

        const res = await fetch(
          `/api/stories/characters/${storyCharId}/generate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        if (!res.ok) {
          const err = await res.json();
          console.error(`[StoryPublisher] Generation failed for ${storyCharId}:`, err);
          const detail = err.details ? ` — ${err.details}` : "";
          throw new Error((err.error || "Generation failed") + detail);
        }
        const data = await res.json();
        console.log(`[StoryPublisher] Generation started - jobId: ${data.jobId}, imageId: ${data.imageId}, debugLevel: ${data.debugLevel}`);
        startPolling(storyCharId, data.jobId, data.imageId);
      } catch (err) {
        console.error(`[StoryPublisher] Error in handleGenerate:`, err);
        updateChar(storyCharId, {
          isGenerating: false,
          error: err instanceof Error ? err.message : "Generation failed",
        });
      }
    },
    [charStates, updateChar, startPolling, modelUrn, debugLevel, forceModel]
  );

  const handleRegenerate = useCallback(
    async (storyCharId: string) => {
      const state = charStates[storyCharId];
      if (!state) return;

      updateChar(storyCharId, {
        isGenerating: true,
        error: null,
        approved: false,
        approvedUrl: null,
      });

      try {
        const body: Record<string, string | number> = {};
        if (state.promptEdited) body.prompt = state.prompt;
        if (state.promptEdited) body.negativePrompt = state.negativePrompt;
        if (modelUrn) body.model_urn = modelUrn;
        if (debugLevel !== "full") body.debugLevel = debugLevel;
        if (forceModel !== "auto") body.forceModel = forceModel;
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
          const err = await res.json();
          const detail = err.details ? ` — ${err.details}` : "";
          throw new Error((err.error || "Regeneration failed") + detail);
        }
        const data = await res.json();
        startPolling(storyCharId, data.jobId, data.imageId);
      } catch (err) {
        updateChar(storyCharId, {
          isGenerating: false,
          error: err instanceof Error ? err.message : "Regeneration failed",
        });
      }
    },
    [charStates, updateChar, startPolling, modelUrn, debugLevel, forceModel]
  );

  const handleApprove = useCallback(
    async (storyCharId: string) => {
      const state = charStates[storyCharId];
      if (!state?.imageId) {
        console.error(`[StoryPublisher] Cannot approve - no imageId for character ${storyCharId}`);
        return;
      }

      console.log(`[StoryPublisher] Approving character ${storyCharId}, imageId: ${state.imageId}`);
      updateChar(storyCharId, { error: null });

      try {
        // Validate prompt age against character data before sending
        const character = characters.find((c) => c.id === storyCharId);
        const correctAge = (character?.characters.description as Record<string, string>)?.age;
        const validatedPrompt = correctAge
          ? ensureCorrectAge(state.prompt, correctAge)
          : state.prompt;

        if (validatedPrompt !== state.prompt) {
          console.warn(
            `[StoryPublisher] Age mismatch detected in prompt for ${storyCharId}. ` +
            `Corrected to "${correctAge}" from character data.`
          );
          updateChar(storyCharId, { prompt: validatedPrompt });
        }

        const res = await fetch(
          `/api/stories/characters/${storyCharId}/approve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              image_id: state.imageId,
              seed: state.seed,
              prompt: validatedPrompt,
            }),
          }
        );
        if (!res.ok) {
          const err = await res.json();
          console.error(`[StoryPublisher] Approval failed for ${storyCharId}:`, err);
          throw new Error(err.error || "Approval failed");
        }
        const data = await res.json();
        console.log(`[StoryPublisher] Approval successful for ${storyCharId}, stored_url: ${data.stored_url}`);
        const finalUrl = data.stored_url || state.imageUrl;
        updateChar(storyCharId, {
          approved: true,
          approvedUrl: finalUrl,
        });
        onCharacterApproved?.(storyCharId, finalUrl!, state.imageId!);
      } catch (err) {
        console.error(`[StoryPublisher] Error in handleApprove:`, err);
        updateChar(storyCharId, {
          error: err instanceof Error ? err.message : "Approval failed",
        });
      }
    },
    [charStates, updateChar, onCharacterApproved]
  );

  const handleCheckStatus = useCallback(
    async (storyCharId: string) => {
      const state = charStates[storyCharId];
      if (!state?.jobId || !state?.imageId) {
        updateChar(storyCharId, {
          error: "No job ID found. Please regenerate.",
        });
        return;
      }

      updateChar(storyCharId, {
        isGenerating: true,
        error: null,
      });

      // Re-start polling with the existing jobId and imageId
      startPolling(storyCharId, state.jobId, state.imageId);
    },
    [charStates, updateChar, startPolling]
  );

  const handleGenerateAll = useCallback(async () => {
    setGeneratingAll(true);
    setGenerateAllProgress(null);

    const toGenerate = characters.filter((ch) => {
      const s = charStates[ch.id];
      return s && !s.imageUrl && !s.isGenerating && !s.approved;
    });

    for (let i = 0; i < toGenerate.length; i++) {
      const ch = toGenerate[i];
      const charName = ch.characters.name;

      setGenerateAllProgress(`Generating ${i + 1} of ${toGenerate.length}: ${charName}...`);

      try {
        // Start generation for this character
        updateChar(ch.id, { isGenerating: true, error: null });

        const chState = charStates[ch.id];
        const body: Record<string, string | number> = {};
        if (modelUrn) body.model_urn = modelUrn;
        if (debugLevel !== "full") body.debugLevel = debugLevel;
        if (forceModel !== "auto") body.forceModel = forceModel;
        if (chState?.promptEdited) body.negativePrompt = chState.negativePrompt;

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
        startPolling(ch.id, data.jobId, data.imageId);

        // Wait 4 seconds before starting the next one to avoid rate limits
        if (i < toGenerate.length - 1) {
          await new Promise((r) => setTimeout(r, 4000));
        }
      } catch (err) {
        // On error, mark this character as failed but continue with the next
        updateChar(ch.id, {
          isGenerating: false,
          error: err instanceof Error ? err.message : "Generation failed",
        });

        // Still wait before next attempt to avoid hammering the API
        if (i < toGenerate.length - 1) {
          await new Promise((r) => setTimeout(r, 4000));
        }
      }
    }

    setGeneratingAll(false);
    setGenerateAllProgress(null);
  }, [characters, charStates, updateChar, startPolling, modelUrn, debugLevel, forceModel]);

  // ------- Derived state -------

  const approvedCount = Object.values(charStates).filter(
    (s) => s.approved
  ).length;
  const totalCount = characters.length;
  const allApproved = totalCount > 0 && approvedCount === totalCount;
  const anyGenerating = Object.values(charStates).some((s) => s.isGenerating);
  const ungeneratedCount = characters.filter((ch) => {
    const s = charStates[ch.id];
    return s && !s.imageUrl && !s.isGenerating && !s.approved;
  }).length;

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
              {approvedCount} of {totalCount} characters approved
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

      {/* Debug resource level selector */}
      <div className="flex flex-col gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3">
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-yellow-400 uppercase tracking-wider whitespace-nowrap">
            Debug Level
          </label>
          <select
            value={debugLevel}
            onChange={(e) => setDebugLevel(e.target.value)}
            className="flex-1 rounded-md border border-yellow-500/30 bg-background px-3 py-1.5 text-sm"
            disabled={anyGenerating}
          >
            {DEBUG_LEVELS.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {DEBUG_LEVELS.find((l) => l.value === debugLevel)?.description}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-yellow-400 uppercase tracking-wider whitespace-nowrap">
            Model
          </label>
          <select
            value={forceModel}
            onChange={(e) => setForceModel(e.target.value)}
            className="flex-1 rounded-md border border-yellow-500/30 bg-background px-3 py-1.5 text-sm"
            disabled={anyGenerating}
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          {forceModel !== "auto" && (
            <span className="text-xs text-yellow-400/70 hidden sm:inline">
              Overrides debug level model selection
            </span>
          )}
        </div>
      </div>

      {/* All approved banner */}
      {allApproved && (
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
      )}

      {/* Character cards */}
      <div className="grid gap-6 lg:grid-cols-2">
        {characters.map((ch) => {
          const state = charStates[ch.id];
          if (!state) return null;

          const role = ROLE_STYLES[ch.role] || ROLE_STYLES.supporting;
          const hasImage = !!state.imageUrl;
          const displayUrl = state.approved
            ? state.approvedUrl || state.imageUrl
            : state.imageUrl;

          return (
            <Card
              key={ch.id}
              className={`transition-colors ${
                state.approved
                  ? "border-green-500/30"
                  : hasImage
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
                    {state.approved && (
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
                {/* Collapsible prose description */}
                {ch.prose_description && (
                  <div>
                    <button
                      onClick={() =>
                        updateChar(ch.id, {
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

                {/* Image display area */}
                <div className="relative">
                  {state.isGenerating ? (
                    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 py-16">
                      <Loader2 className="mb-3 h-8 w-8 animate-spin text-blue-400" />
                      <p className="text-sm font-medium text-blue-400">
                        {state.runpodStatus === "IN_QUEUE"
                          ? "Waiting for GPU worker..."
                          : state.runpodStatus === "IN_PROGRESS"
                            ? "Rendering portrait..."
                            : "Submitting to GPU..."}
                      </p>
                      {state.pollStartTime && (() => {
                        const elapsed = Math.floor((Date.now() - state.pollStartTime) / 1000);
                        return (
                          <>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {elapsed < 60
                                ? `${elapsed}s elapsed`
                                : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s elapsed`}
                            </p>
                            {elapsed > 60 && state.runpodStatus === "IN_QUEUE" && (
                              <p className="mt-1 text-xs text-muted-foreground/70">
                                GPU worker is starting up — this can take a few minutes on first run
                              </p>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  ) : displayUrl ? (
                    <div className="relative overflow-hidden rounded-lg">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={displayUrl}
                        alt={`Portrait of ${ch.characters.name}`}
                        className="h-full w-full object-cover rounded-lg"
                        style={{ aspectRatio: "3/4" }}
                      />
                      {state.approved && (
                        <div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-green-600/90 px-3 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur-sm">
                          <Check className="h-3.5 w-3.5" />
                          Approved
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 py-16">
                      <User className="mb-3 h-10 w-10 text-muted-foreground/50" />
                      <p className="text-sm text-muted-foreground">
                        No portrait generated yet
                      </p>
                    </div>
                  )}
                </div>

                {/* Error display */}
                {state.error && (
                  <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    {state.error}
                  </div>
                )}

                {/* Editable prompt */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Portrait Prompt
                  </label>
                  <Textarea
                    value={state.prompt}
                    onChange={(e) =>
                      updateChar(ch.id, { prompt: e.target.value, promptEdited: true })
                    }
                    rows={4}
                    className="text-xs leading-relaxed resize-y bg-muted/30"
                    disabled={state.isGenerating}
                  />
                </div>

                {/* Negative prompt (read-only) */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-red-400/70 uppercase tracking-wider">
                    Negative Prompt
                  </label>
                  <Textarea
                    value={state.negativePrompt}
                    onChange={(e) =>
                      updateChar(ch.id, { negativePrompt: e.target.value, promptEdited: true })
                    }
                    rows={3}
                    className="text-xs leading-relaxed resize-y bg-red-500/5 border-red-500/20"
                    disabled={state.isGenerating}
                  />
                </div>

                {/* Lock Seed option */}
                <div className="flex items-center gap-3">
                  <label
                    className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer"
                    title={state.lockSeed
                      ? "When locked, regeneration keeps the same base appearance. Unlock for a completely new look."
                      : "Unlocked — regeneration will produce a completely different look."}
                  >
                    <input
                      type="checkbox"
                      checked={state.lockSeed}
                      onChange={(e) =>
                        updateChar(ch.id, { lockSeed: e.target.checked })
                      }
                      disabled={state.isGenerating}
                      className="rounded border-muted-foreground/30"
                    />
                    {state.lockSeed ? (
                      <span>
                        🔒 Lock Seed{" "}
                        <span className="text-muted-foreground/50">
                          {state.isGenerating
                            ? "(Generating...)"
                            : state.seed != null
                              ? `(${state.seed})`
                              : "(no seed yet)"}
                        </span>
                      </span>
                    ) : (
                      <span>🔓 Random Seed</span>
                    )}
                  </label>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2">
                  {!hasImage && !state.isGenerating && !state.error && (
                    <Button
                      onClick={() => handleGenerate(ch.id)}
                      disabled={generatingAll}
                      size="sm"
                    >
                      <Sparkles className="mr-2 h-4 w-4" />
                      Generate Portrait
                    </Button>
                  )}

                  {!state.isGenerating && state.error && state.jobId && (
                    <>
                      <Button
                        onClick={() => handleCheckStatus(ch.id)}
                        disabled={generatingAll}
                        size="sm"
                        variant="outline"
                      >
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Check Status
                      </Button>
                      <Button
                        onClick={() => handleGenerate(ch.id)}
                        disabled={generatingAll}
                        size="sm"
                      >
                        <Sparkles className="mr-2 h-4 w-4" />
                        Generate New
                      </Button>
                    </>
                  )}

                  {!hasImage && !state.isGenerating && state.error && !state.jobId && (
                    <Button
                      onClick={() => handleGenerate(ch.id)}
                      disabled={generatingAll}
                      size="sm"
                    >
                      <Sparkles className="mr-2 h-4 w-4" />
                      Generate Portrait
                    </Button>
                  )}

                  {hasImage && !state.isGenerating && (
                    <Button
                      onClick={() => handleRegenerate(ch.id)}
                      variant="outline"
                      size="sm"
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Regenerate
                    </Button>
                  )}

                  {hasImage && !state.approved && !state.isGenerating && (
                    <Button
                      onClick={() => handleApprove(ch.id)}
                      size="sm"
                      className="bg-green-600 hover:bg-green-700"
                    >
                      <Check className="mr-2 h-4 w-4" />
                      Approve
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
