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
  prompt: string;
  negativePrompt: string;
  promptEdited: boolean;
  error: string | null;
  jobId: string | null;
  pollStartTime: number | null;
  seed: number | null;
  lockSeed: boolean;
  runpodStatus: "IN_QUEUE" | "IN_PROGRESS" | null;
}

interface LoraTrainingState {
  status: "no_lora" | "pending" | "generating_dataset" | "evaluating" | "captioning" | "training" | "validating" | "deployed" | "failed";
  loraId: string | null;
  datasetGenerated: number;
  datasetApproved: number;
  trainingAttempt: number;
  validationScore: number | null;
  error: string | null;
  estimatedTimeRemaining: string | null;
  isTriggering: boolean;
}

interface CharState {
  portrait: ImageSlotState;
  fullBody: ImageSlotState;
  showDescription: boolean;
  lora: LoraTrainingState;
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
 */
function ensureCorrectAge(prompt: string, correctAge: string): string {
  if (!correctAge) return prompt;
  // Match the first standalone age number in the prompt (not inside emphasis weights like :1.3)
  return prompt.replace(
    /(?<=,\s)\d{1,3}(?=\s*(?:years?\s*old)?,)/,
    correctAge
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
  // Framing and face-detail tags go FIRST so CLIP gives them maximum weight
  const parts: string[] = [
    "masterpiece, best quality, highly detailed",
    "(close-up head and shoulders portrait:1.4), (face in focus:1.3), (detailed facial features:1.2)",
    "(skin pores:1.1), (natural skin texture:1.2), (matte skin:1.1)",
  ];

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

  parts.push("(professional portrait photography:1.2), soft diffused studio lighting, (seamless medium gray backdrop:1.3), plain uniform background");
  parts.push("looking at camera, neutral expression, photorealistic");

  return parts.filter(Boolean).join(", ");
}

/** Client-side prompt builder for full-body standing shots */
function buildFullBodyPrompt(desc: Record<string, unknown>): string {
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

  // Full body: include FULL bodyType (not simplified) — the whole point is body accuracy
  if (d.bodyType) {
    parts.push(`${d.bodyType} body`);
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
  if (d.skinTone) parts.push(`${d.skinTone} skin`);

  if (africanMale) {
    parts.push("full lips, strong jawline");
  }

  if (d.distinguishingFeatures) parts.push(d.distinguishingFeatures);
  if (d.clothing) parts.push(`wearing ${d.clothing}`);

  // Female characters always wear heels in full-body shots
  if (d.gender?.toLowerCase() !== "male") {
    parts.push("wearing high heels");
  }

  parts.push("full body standing pose, full body visible head to feet");
  parts.push("standing naturally, looking at camera");
  parts.push("soft diffused studio lighting, (seamless medium gray backdrop:1.3), plain uniform background");
  parts.push("fashion photography style, photorealistic");

  return parts.filter(Boolean).join(", ");
}

/** Client-side mirror of the server negative prompt builder for portraits */
function buildPortraitNegativePrompt(desc: Record<string, unknown>): string {
  const d = desc as Record<string, string>;
  let result =
    "(deformed, distorted, disfigured:1.3), poorly drawn, bad anatomy, wrong anatomy, extra limb, missing limb, floating limbs, mutated hands, extra fingers, missing fingers, (blurry:1.2), bad quality, watermark, text, signature, (cross-eyed:1.3), (strabismus:1.3), asymmetric eyes, different eye directions, (extra people:1.2), extra face, clone face, (3d render, cgi, illustration, cartoon, anime, painting, drawing:1.3), (bad teeth, deformed teeth:1.1)";

  // Portraits are always SFW
  result += ", (nsfw:1.5), (nude:1.5), (naked:1.5), (topless:1.5), (nipples:1.5), (breast:1.3), explicit, exposed skin";

  // Reinforce head-and-shoulders framing by penalising wide/full-body compositions
  result += ", (full body:1.4), (full length:1.4), (wide shot:1.3), (legs:1.2), (feet:1.2)";

  // Enforce uniform studio background — prevent outdoor, textured, or coloured backdrops
  result += ", (outdoor:1.3), (nature:1.2), (city:1.2), (room:1.2), (textured background:1.2), (patterned background:1.2), (colorful background:1.2)";

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

/** Gender-based model selection: Lustify for female, RealVisXL for male */
function getModelForGender(desc: Record<string, unknown>): string {
  const gender = (desc as Record<string, string>).gender?.toLowerCase();
  if (gender === "male") return "realvisxl-v5.safetensors";
  return "lustify-v5-endgame.safetensors"; // female and any other gender
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
  negativePrompt: string,
): ImageSlotState {
  return {
    imageUrl,
    imageId,
    isGenerating: false,
    approved,
    approvedUrl,
    prompt,
    negativePrompt,
    promptEdited: false,
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
  const [debugLevel, setDebugLevel] = useState("full");

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

      initial[ch.id] = {
        portrait: makeSlotState(
          portraitUrl,
          portraitId,
          ch.approved,
          ch.approved_image_url || null,
          ch.approved_seed ?? null,
          buildPortraitPrompt(desc),
          buildPortraitNegativePrompt(desc),
        ),
        fullBody: makeSlotState(
          fullBodyUrl,
          fullBodyId,
          ch.approved_fullbody ?? false,
          ch.approved_fullbody_image_url || null,
          ch.approved_fullbody_seed ?? null,
          buildFullBodyPrompt(desc),
          buildPortraitNegativePrompt(desc),
        ),
        showDescription: false,
        lora: {
          status: "no_lora",
          loraId: null,
          datasetGenerated: 0,
          datasetApproved: 0,
          trainingAttempt: 0,
          validationScore: null,
          error: null,
          estimatedTimeRemaining: null,
          isTriggering: false,
        },
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
    (id: string, updates: Partial<Pick<CharState, "showDescription">>) => {
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
      console.log(`[StoryPublisher] Generating ${type} for character ${storyCharId}, debugLevel: ${debugLevel}`);
      updateSlot(storyCharId, type, { isGenerating: true, error: null });

      try {
        const state = charStates[storyCharId]?.[type];
        const character = characters.find((c) => c.id === storyCharId);
        const genderModel = character ? getModelForGender(character.characters.description) : "lustify-v5-endgame.safetensors";
        const body: Record<string, string | number> = { type };
        if (modelUrn) body.model_urn = modelUrn;
        if (debugLevel !== "full") body.debugLevel = debugLevel;
        body.forceModel = genderModel;
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
          const detail = err.details ? ` — ${err.details}` : "";
          throw new Error((err.error || "Generation failed") + detail);
        }
        const data = await res.json();
        console.log(`[StoryPublisher] Generation started - jobId: ${data.jobId}, imageId: ${data.imageId}, type: ${type}`);
        startPolling(storyCharId, type, data.jobId, data.imageId);
      } catch (err) {
        console.error(`[StoryPublisher] Error in handleGenerate:`, err);
        updateSlot(storyCharId, type, {
          isGenerating: false,
          error: err instanceof Error ? err.message : "Generation failed",
        });
      }
    },
    [charStates, characters, updateSlot, startPolling, modelUrn, debugLevel]
  );

  const handleRegenerate = useCallback(
    async (storyCharId: string, type: ImageType) => {
      const state = charStates[storyCharId]?.[type];
      if (!state) return;

      updateSlot(storyCharId, type, {
        isGenerating: true,
        error: null,
        approved: false,
        approvedUrl: null,
      });

      try {
        const character = characters.find((c) => c.id === storyCharId);
        const genderModel = character ? getModelForGender(character.characters.description) : "lustify-v5-endgame.safetensors";
        const body: Record<string, string | number> = { type };
        if (state.promptEdited) body.prompt = state.prompt;
        if (state.promptEdited) body.negativePrompt = state.negativePrompt;
        if (modelUrn) body.model_urn = modelUrn;
        if (debugLevel !== "full") body.debugLevel = debugLevel;
        body.forceModel = genderModel;
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
        startPolling(storyCharId, type, data.jobId, data.imageId);
      } catch (err) {
        updateSlot(storyCharId, type, {
          isGenerating: false,
          error: err instanceof Error ? err.message : "Regeneration failed",
        });
      }
    },
    [charStates, characters, updateSlot, startPolling, modelUrn, debugLevel]
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
          updateSlot(storyCharId, type, { prompt: validatedPrompt });
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
    const toGenerate: { ch: CharacterFromAPI; type: ImageType }[] = [];
    for (const ch of characters) {
      const s = charStates[ch.id];
      if (!s) continue;
      if (!s.portrait.imageUrl && !s.portrait.isGenerating && !s.portrait.approved) {
        toGenerate.push({ ch, type: "portrait" });
      }
      if (!s.fullBody.imageUrl && !s.fullBody.isGenerating && !s.fullBody.approved) {
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
        const genderModel = getModelForGender(ch.characters.description);
        const body: Record<string, string | number> = { type };
        if (modelUrn) body.model_urn = modelUrn;
        if (debugLevel !== "full") body.debugLevel = debugLevel;
        body.forceModel = genderModel;
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
        startPolling(ch.id, type, data.jobId, data.imageId);

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
  }, [characters, charStates, updateSlot, startPolling, modelUrn, debugLevel]);

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
        const res = await fetch(
          `/api/stories/characters/${storyCharId}/train-lora`,
          { method: "POST", headers: { "Content-Type": "application/json" } }
        );

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to start LoRA training");
        }

        const data = await res.json();
        updateLoraState(storyCharId, {
          isTriggering: false,
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
    [updateLoraState]
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
            trainingAttempt: data.progress?.trainingAttempt || 0,
            validationScore: data.progress?.validationScore || null,
            error: data.error,
            estimatedTimeRemaining: data.estimatedTimeRemaining,
          });

          // Stop polling when terminal state reached
          if (["deployed", "failed", "archived"].includes(data.status)) {
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

  // On mount: check LoRA progress for already-approved characters
  useEffect(() => {
    for (const ch of characters) {
      if (ch.approved && ch.approved_fullbody) {
        // Check if there's an existing LoRA training
        fetch(`/api/stories/characters/${ch.id}/lora-progress`)
          .then((r) => r.json())
          .then((data) => {
            if (data && data.status && data.status !== "no_lora") {
              updateLoraState(ch.id, {
                status: data.status,
                loraId: data.loraId,
                datasetGenerated: data.progress?.datasetGenerated || 0,
                datasetApproved: data.progress?.datasetApproved || 0,
                trainingAttempt: data.progress?.trainingAttempt || 0,
                validationScore: data.progress?.validationScore || null,
                error: data.error,
                estimatedTimeRemaining: data.estimatedTimeRemaining,
              });

              // If still in progress, start polling
              if (!["deployed", "failed", "archived", "no_lora"].includes(data.status)) {
                startLoraPolling(ch.id);
              }
            }
          })
          .catch(() => {/* ignore */});
      }
    }

    return () => {
      Object.values(loraPollingTimers.current).forEach(clearInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------- Derived state -------

  // A character is "fully approved" when BOTH portrait AND fullBody are approved
  const approvedCount = Object.values(charStates).filter(
    (s) => s.portrait?.approved && s.fullBody?.approved
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
          <span className="text-xs text-muted-foreground">
            Auto: Lustify V5 (female) / RealVisXL V5 (male)
          </span>
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

                {/* Dual image slots: Portrait + Full Body */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(["portrait", "fullBody"] as const).map((type) => {
                    const slot = state[type];
                    const hasImage = !!slot.imageUrl;
                    const displayUrl = slot.approved
                      ? slot.approvedUrl || slot.imageUrl
                      : slot.imageUrl;
                    const label = type === "portrait" ? "Portrait" : "Full Body";
                    const aspectClass = type === "portrait" ? "aspect-[3/4]" : "aspect-[5/8]";

                    return (
                      <div key={type} className="space-y-3">
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
                                    ? `Rendering ${label.toLowerCase()}...`
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
                            <div className="relative overflow-hidden rounded-lg">
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

                        {/* Editable prompt */}
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            {label} Prompt
                          </label>
                          <Textarea
                            value={slot.prompt}
                            onChange={(e) =>
                              updateSlot(ch.id, type, { prompt: e.target.value, promptEdited: true })
                            }
                            rows={3}
                            className="text-xs leading-relaxed resize-y bg-muted/30"
                            disabled={slot.isGenerating}
                          />
                        </div>

                        {/* Negative prompt */}
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-red-400/70 uppercase tracking-wider">
                            Negative Prompt
                          </label>
                          <Textarea
                            value={slot.negativePrompt}
                            onChange={(e) =>
                              updateSlot(ch.id, type, { negativePrompt: e.target.value, promptEdited: true })
                            }
                            rows={2}
                            className="text-xs leading-relaxed resize-y bg-red-500/5 border-red-500/20"
                            disabled={slot.isGenerating}
                          />
                        </div>

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
                              disabled={generatingAll}
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
                                disabled={generatingAll}
                                size="sm"
                                variant="outline"
                              >
                                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                                Check Status
                              </Button>
                              <Button
                                onClick={() => handleGenerate(ch.id, type)}
                                disabled={generatingAll}
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
                              disabled={generatingAll}
                              size="sm"
                            >
                              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                              Generate {label}
                            </Button>
                          )}

                          {hasImage && !slot.isGenerating && (
                            <Button
                              onClick={() => handleRegenerate(ch.id, type)}
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
                              size="sm"
                              className="bg-green-600 hover:bg-green-700"
                            >
                              <Check className="mr-1.5 h-3.5 w-3.5" />
                              Approve
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
                    Portrait: {state.portrait.approved ? (
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

                {/* LoRA Training Section — shows after both images approved */}
                {fullyApproved && (
                  <LoraTrainingSection
                    storyCharId={ch.id}
                    characterName={ch.characters.name}
                    loraState={state.lora}
                    onTrain={() => handleTrainLora(ch.id)}
                  />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LoRA Training Section Component
// ---------------------------------------------------------------------------

const LORA_STATUS_CONFIG: Record<string, { label: string; color: string; description: string }> = {
  no_lora: { label: "Not Started", color: "text-muted-foreground/50", description: "Train a character LoRA for consistent identity across all scenes" },
  pending: { label: "Starting...", color: "text-blue-400", description: "Initializing pipeline" },
  generating_dataset: { label: "Generating Dataset", color: "text-blue-400", description: "Creating training images (Nano Banana Pro + ComfyUI)" },
  evaluating: { label: "Evaluating Quality", color: "text-blue-400", description: "Claude Vision is checking face & body consistency" },
  captioning: { label: "Captioning", color: "text-blue-400", description: "Generating training captions" },
  training: { label: "Training LoRA", color: "text-purple-400", description: "SDXL LoRA training on Replicate" },
  validating: { label: "Validating", color: "text-purple-400", description: "Testing LoRA with sample generations" },
  deployed: { label: "Active", color: "text-green-400", description: "Character LoRA is deployed and will be used in scene generation" },
  failed: { label: "Failed", color: "text-red-400", description: "Training failed — click Retry to try again" },
};

function LoraTrainingSection({
  storyCharId,
  characterName,
  loraState,
  onTrain,
}: {
  storyCharId: string;
  characterName: string;
  loraState: LoraTrainingState;
  onTrain: () => void;
}) {
  const config = LORA_STATUS_CONFIG[loraState.status] || LORA_STATUS_CONFIG.no_lora;
  const isInProgress = !["no_lora", "deployed", "failed", "archived"].includes(loraState.status);
  const isDeployed = loraState.status === "deployed";
  const isFailed = loraState.status === "failed";

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
        {loraState.status === "no_lora" && (
          <Button
            onClick={onTrain}
            disabled={loraState.isTriggering}
            size="sm"
            variant="outline"
            className="border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
          >
            {loraState.isTriggering ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Dna className="mr-1.5 h-3.5 w-3.5" />
            )}
            Train Character LoRA
          </Button>
        )}

        {isFailed && (
          <Button
            onClick={onTrain}
            disabled={loraState.isTriggering}
            size="sm"
            variant="outline"
            className="border-red-500/30 text-red-400 hover:bg-red-500/10"
          >
            {loraState.isTriggering ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Retry
          </Button>
        )}

        {isDeployed && (
          <span className="flex items-center gap-1 text-xs text-green-400">
            <Check className="h-3 w-3" />
            LoRA Active
          </span>
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

      {/* Error display */}
      {isFailed && loraState.error && (
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
      {loraState.status === "no_lora" && (
        <p className="text-xs text-muted-foreground/50">
          {config.description}
        </p>
      )}
    </div>
  );
}
