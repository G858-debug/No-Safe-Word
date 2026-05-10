"use client";

import {
  useState,
  useEffect,
  useRef,
  useReducer,
  useCallback,
} from "react";
import { X, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import type { CharacterFromAPI } from "./CharacterApproval";
import type { ImageModel } from "@no-safe-word/shared";

interface Props {
  character: CharacterFromAPI;
  seriesId: string;
  imageModel: ImageModel;
  onUpdate: () => void;
}

const BODY_MODEL_LABELS: Record<ImageModel, string> = {
  flux2_dev: "Flux 2 Dev",
  hunyuan3: "Hunyuan 3.0",
};

// ─────────────────────────────────────────────────────────────
// State machine
//
// The card lifecycle for a Pass 3 dual-image (face + body) flow.
// The reducer is pure; all fetches + cleanup live in handlers.
//
// Three small deviations from the original spec, signed off:
//   1. generating_body has optional bodyJobId/bodyImageId — the
//      transient gap between FACE_COMPLETED dispatching and
//      BODY_STARTED dispatching (during the /generate-body POST)
//      needs a valid kind. React 18 batches dispatches so the gap
//      state is computed but not rendered.
//   2. regenerating_full_body has the same optional candidate-body
//      fields for the same reason.
//   3. resetting carries the approved fields it came from, so an
//      /reset-portrait failure can recover to approved without a
//      refetch.
// ─────────────────────────────────────────────────────────────

type CardState =
  | { kind: "loading_default_prompt" }
  | { kind: "idle"; prompt: string; bodyPrompt: string; error?: string }
  | {
      kind: "generating_face";
      prompt: string;
      bodyPrompt: string;
      faceJobId: string;
      faceImageId: string;
    }
  | {
      kind: "generating_body";
      prompt: string;
      bodyPrompt: string;
      faceImageId: string;
      faceUrl: string;
      bodyJobId?: string;
      bodyImageId?: string;
    }
  | {
      kind: "face_ready";
      prompt: string;
      bodyPrompt: string;
      faceImageId: string;
      faceUrl: string;
    }
  | {
      kind: "body_prompt_editing";
      prompt: string;
      bodyPrompt: string;
      faceImageId: string;
      faceUrl: string;
    }
  | {
      kind: "body_ready";
      prompt: string;
      bodyPrompt: string;
      faceImageId: string;
      faceUrl: string;
      bodyImageId: string;
      bodyUrl: string;
    }
  | {
      kind: "approving";
      prompt: string;
      bodyPrompt: string;
      faceImageId: string;
      faceUrl: string;
      bodyImageId: string;
      bodyUrl: string;
    }
  | {
      kind: "approved";
      prompt: string;
      approvedFaceImageId: string;
      approvedFaceUrl: string;
      approvedBodyImageId: string;
      approvedBodyUrl: string;
    }
  | {
      kind: "regenerating_full_face";
      approvedFaceImageId: string;
      approvedFaceUrl: string;
      approvedBodyImageId: string;
      approvedBodyUrl: string;
      prompt: string;
      candidateFaceJobId: string;
      candidateFaceImageId: string;
    }
  | {
      kind: "regenerating_full_body";
      approvedFaceImageId: string;
      approvedFaceUrl: string;
      approvedBodyImageId: string;
      approvedBodyUrl: string;
      prompt: string;
      candidateFaceImageId: string;
      candidateFaceUrl: string;
      candidateBodyJobId?: string;
      candidateBodyImageId?: string;
    }
  | {
      kind: "regenerating_body_only";
      approvedFaceImageId: string;
      approvedFaceUrl: string;
      approvedBodyImageId: string;
      approvedBodyUrl: string;
      prompt: string;
      candidateBodyJobId: string;
      candidateBodyImageId: string;
    }
  | {
      kind: "candidate_ready";
      approvedFaceImageId: string;
      approvedFaceUrl: string;
      approvedBodyImageId: string;
      approvedBodyUrl: string;
      candidateFaceImageId: string | null;
      candidateFaceUrl: string | null;
      candidateBodyImageId: string;
      candidateBodyUrl: string;
      candidateGeneratedAt: string;
      candidatePrompt: string;
    }
  | {
      kind: "replacing";
      approvedFaceImageId: string;
      approvedFaceUrl: string;
      approvedBodyImageId: string;
      approvedBodyUrl: string;
      candidateFaceImageId: string | null;
      candidateFaceUrl: string | null;
      candidateBodyImageId: string;
      candidateBodyUrl: string;
      candidateGeneratedAt: string;
      candidatePrompt: string;
    }
  | {
      kind: "discarding";
      approvedFaceImageId: string;
      approvedFaceUrl: string;
      approvedBodyImageId: string;
      approvedBodyUrl: string;
      candidateFaceImageId: string | null;
      candidateFaceUrl: string | null;
      candidateBodyImageId: string;
      candidateBodyUrl: string;
      candidateGeneratedAt: string;
      candidatePrompt: string;
    }
  | {
      kind: "resetting";
      prompt: string;
      approvedFaceImageId: string;
      approvedFaceUrl: string;
      approvedBodyImageId: string;
      approvedBodyUrl: string;
    }
  | {
      kind: "error";
      message: string;
      previousKind: CardState["kind"];
      recoveryState: CardState;
    };

type HydrationPayload = { state: CardState };

type Action =
  | { type: "DEFAULT_PROMPT_LOADED"; prompt: string; bodyPrompt: string }
  | { type: "PROMPT_EDITED"; prompt: string }
  | { type: "BODY_PROMPT_EDITED"; bodyPrompt: string }
  | { type: "GENERATE_CLICKED" }
  | { type: "FACE_STARTED"; faceJobId: string; faceImageId: string }
  | { type: "FACE_COMPLETED"; faceUrl: string }
  | { type: "BODY_STARTED"; bodyJobId: string; bodyImageId: string }
  | { type: "BODY_COMPLETED"; bodyUrl: string }
  | { type: "APPROVE_CLICKED" }
  | { type: "APPROVED" }
  | { type: "CANCEL_CLICKED" }
  | { type: "CANCELLED" }
  | { type: "REGEN_FULL_CLICKED" }
  | { type: "REGEN_BODY_ONLY_CLICKED" }
  | { type: "PROCEED_TO_BODY" }
  | { type: "GENERATE_BODY_CLICKED" }
  | { type: "REGEN_FACE_CLICKED" }
  | { type: "REGEN_BODY_CLICKED" }
  | { type: "CANDIDATE_FACE_STARTED"; jobId: string; imageId: string }
  | { type: "CANDIDATE_FACE_COMPLETED"; url: string }
  | { type: "CANDIDATE_BODY_STARTED"; jobId: string; imageId: string }
  | {
      type: "CANDIDATE_BODY_COMPLETED";
      url: string;
      generatedAt: string;
      candidatePrompt: string;
    }
  | { type: "REPLACE_CLICKED" }
  | { type: "REPLACED" }
  | { type: "DISCARD_CLICKED" }
  | { type: "DISCARDED" }
  | { type: "RESET_CLICKED" }
  | { type: "RESET_COMPLETED" }
  | { type: "LOCKED_PROMPT_SAVED"; prompt: string }
  | { type: "HYDRATED"; payload: HydrationPayload }
  | { type: "ERROR"; message: string }
  | { type: "ERROR_DISMISSED" };

// ─────────────────────────────────────────────────────────────
// Reducer (pure — no fetches, no async, no setTimeout)
// ─────────────────────────────────────────────────────────────

function computeRecoveryState(state: CardState): CardState {
  switch (state.kind) {
    case "loading_default_prompt":
      return { kind: "idle", prompt: "", bodyPrompt: "" };
    case "idle":
      return state;
    case "approved":
      return state;
    case "face_ready":
      return { kind: "idle", prompt: state.prompt, bodyPrompt: state.bodyPrompt };
    case "body_prompt_editing":
      return { kind: "idle", prompt: state.prompt, bodyPrompt: state.bodyPrompt };
    case "body_ready":
      return { kind: "body_prompt_editing", prompt: state.prompt, bodyPrompt: state.bodyPrompt, faceImageId: state.faceImageId, faceUrl: state.faceUrl };
    case "generating_face":
    case "generating_body":
    case "approving":
      return {
        kind: "idle",
        prompt: state.prompt,
        bodyPrompt: state.bodyPrompt,
      };
    case "regenerating_full_face":
    case "regenerating_full_body":
    case "regenerating_body_only":
    case "resetting":
      return {
        kind: "approved",
        prompt: state.prompt,
        approvedFaceImageId: state.approvedFaceImageId,
        approvedFaceUrl: state.approvedFaceUrl,
        approvedBodyImageId: state.approvedBodyImageId,
        approvedBodyUrl: state.approvedBodyUrl,
      };
    case "candidate_ready":
      return state;
    case "replacing":
    case "discarding":
      return {
        kind: "candidate_ready",
        approvedFaceImageId: state.approvedFaceImageId,
        approvedFaceUrl: state.approvedFaceUrl,
        approvedBodyImageId: state.approvedBodyImageId,
        approvedBodyUrl: state.approvedBodyUrl,
        candidateFaceImageId: state.candidateFaceImageId,
        candidateFaceUrl: state.candidateFaceUrl,
        candidateBodyImageId: state.candidateBodyImageId,
        candidateBodyUrl: state.candidateBodyUrl,
        candidateGeneratedAt: state.candidateGeneratedAt,
        candidatePrompt: state.candidatePrompt,
      };
    case "error":
      return state.recoveryState;
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function reducer(state: CardState, action: Action): CardState {
  switch (action.type) {
    case "HYDRATED":
      return action.payload.state;

    case "DEFAULT_PROMPT_LOADED":
      if (state.kind !== "loading_default_prompt") return state;
      return {
        kind: "idle",
        prompt: action.prompt,
        bodyPrompt: action.bodyPrompt,
      };

    case "PROMPT_EDITED":
      if (state.kind !== "idle" && state.kind !== "face_ready") return state;
      return { ...state, prompt: action.prompt };

    case "BODY_PROMPT_EDITED":
      if (state.kind !== "idle" && state.kind !== "body_prompt_editing" && state.kind !== "body_ready") return state;
      return { ...state, bodyPrompt: action.bodyPrompt };

    case "GENERATE_CLICKED":
      // Marker — clears any inline error on idle. The real transition
      // to generating_face is FACE_STARTED.
      if (state.kind !== "idle") return state;
      return { ...state, error: undefined };

    case "FACE_STARTED":
      if (state.kind !== "idle") return state;
      return {
        kind: "generating_face",
        prompt: state.prompt,
        bodyPrompt: state.bodyPrompt,
        faceJobId: action.faceJobId,
        faceImageId: action.faceImageId,
      };

    case "FACE_COMPLETED":
      if (state.kind !== "generating_face") return state;
      return {
        kind: "face_ready",
        prompt: state.prompt,
        bodyPrompt: state.bodyPrompt,
        faceImageId: state.faceImageId,
        faceUrl: action.faceUrl,
      };

    case "BODY_STARTED":
      if (state.kind !== "generating_body") return state;
      return {
        ...state,
        bodyJobId: action.bodyJobId,
        bodyImageId: action.bodyImageId,
      };

    case "BODY_COMPLETED":
      if (state.kind !== "generating_body") return state;
      if (!state.bodyImageId) return state;
      return {
        kind: "body_ready",
        prompt: state.prompt,
        bodyPrompt: state.bodyPrompt,
        faceImageId: state.faceImageId,
        faceUrl: state.faceUrl,
        bodyImageId: state.bodyImageId,
        bodyUrl: action.bodyUrl,
      };

    case "APPROVE_CLICKED":
      if (state.kind !== "body_ready") return state;
      return { ...state, kind: "approving" };

    case "APPROVED":
      if (state.kind !== "approving") return state;
      return {
        kind: "approved",
        prompt: state.prompt,
        approvedFaceImageId: state.faceImageId,
        approvedFaceUrl: state.faceUrl,
        approvedBodyImageId: state.bodyImageId,
        approvedBodyUrl: state.bodyUrl,
      };

    case "CANCEL_CLICKED":
      // Marker — cleanup happens in handler, then CANCELLED dispatches.
      return state;

    case "CANCELLED":
      if (state.kind !== "body_ready") return state;
      return {
        kind: "body_prompt_editing",
        prompt: state.prompt,
        bodyPrompt: state.bodyPrompt,
        faceImageId: state.faceImageId,
        faceUrl: state.faceUrl,
      };

    case "REGEN_FULL_CLICKED":
    case "REGEN_BODY_ONLY_CLICKED":
      // Markers — handler kicks off the appropriate fetch and dispatches
      // CANDIDATE_*_STARTED on response.
      return state;

    case "REGEN_FACE_CLICKED":
      if (state.kind !== "face_ready") return state;
      return { kind: "idle", prompt: state.prompt, bodyPrompt: state.bodyPrompt };

    case "PROCEED_TO_BODY":
      if (state.kind !== "face_ready") return state;
      return { kind: "body_prompt_editing", prompt: state.prompt, bodyPrompt: state.bodyPrompt, faceImageId: state.faceImageId, faceUrl: state.faceUrl };

    case "GENERATE_BODY_CLICKED":
      if (state.kind !== "body_prompt_editing") return state;
      return { kind: "generating_body", prompt: state.prompt, bodyPrompt: state.bodyPrompt, faceImageId: state.faceImageId, faceUrl: state.faceUrl };

    case "REGEN_BODY_CLICKED":
      if (state.kind !== "body_ready") return state;
      return { kind: "body_prompt_editing", prompt: state.prompt, bodyPrompt: state.bodyPrompt, faceImageId: state.faceImageId, faceUrl: state.faceUrl };

    case "CANDIDATE_FACE_STARTED":
      if (state.kind !== "approved") return state;
      return {
        kind: "regenerating_full_face",
        prompt: state.prompt,
        approvedFaceImageId: state.approvedFaceImageId,
        approvedFaceUrl: state.approvedFaceUrl,
        approvedBodyImageId: state.approvedBodyImageId,
        approvedBodyUrl: state.approvedBodyUrl,
        candidateFaceJobId: action.jobId,
        candidateFaceImageId: action.imageId,
      };

    case "CANDIDATE_FACE_COMPLETED":
      if (state.kind !== "regenerating_full_face") return state;
      return {
        kind: "regenerating_full_body",
        prompt: state.prompt,
        approvedFaceImageId: state.approvedFaceImageId,
        approvedFaceUrl: state.approvedFaceUrl,
        approvedBodyImageId: state.approvedBodyImageId,
        approvedBodyUrl: state.approvedBodyUrl,
        candidateFaceImageId: state.candidateFaceImageId,
        candidateFaceUrl: action.url,
      };

    case "CANDIDATE_BODY_STARTED":
      if (state.kind === "regenerating_full_body" && !state.candidateBodyJobId) {
        return {
          ...state,
          candidateBodyJobId: action.jobId,
          candidateBodyImageId: action.imageId,
        };
      }
      if (state.kind === "approved") {
        return {
          kind: "regenerating_body_only",
          prompt: state.prompt,
          approvedFaceImageId: state.approvedFaceImageId,
          approvedFaceUrl: state.approvedFaceUrl,
          approvedBodyImageId: state.approvedBodyImageId,
          approvedBodyUrl: state.approvedBodyUrl,
          candidateBodyJobId: action.jobId,
          candidateBodyImageId: action.imageId,
        };
      }
      return state;

    case "CANDIDATE_BODY_COMPLETED":
      if (state.kind === "regenerating_full_body") {
        if (!state.candidateBodyImageId) return state;
        return {
          kind: "candidate_ready",
          approvedFaceImageId: state.approvedFaceImageId,
          approvedFaceUrl: state.approvedFaceUrl,
          approvedBodyImageId: state.approvedBodyImageId,
          approvedBodyUrl: state.approvedBodyUrl,
          candidateFaceImageId: state.candidateFaceImageId,
          candidateFaceUrl: state.candidateFaceUrl,
          candidateBodyImageId: state.candidateBodyImageId,
          candidateBodyUrl: action.url,
          candidateGeneratedAt: action.generatedAt,
          candidatePrompt: action.candidatePrompt,
        };
      }
      if (state.kind === "regenerating_body_only") {
        return {
          kind: "candidate_ready",
          approvedFaceImageId: state.approvedFaceImageId,
          approvedFaceUrl: state.approvedFaceUrl,
          approvedBodyImageId: state.approvedBodyImageId,
          approvedBodyUrl: state.approvedBodyUrl,
          candidateFaceImageId: null,
          candidateFaceUrl: null,
          candidateBodyImageId: state.candidateBodyImageId,
          candidateBodyUrl: action.url,
          candidateGeneratedAt: action.generatedAt,
          candidatePrompt: action.candidatePrompt,
        };
      }
      return state;

    case "REPLACE_CLICKED":
      if (state.kind !== "candidate_ready") return state;
      return { ...state, kind: "replacing" };

    case "REPLACED":
      if (state.kind !== "replacing") return state;
      return {
        kind: "approved",
        prompt: state.candidatePrompt,
        approvedFaceImageId:
          state.candidateFaceImageId ?? state.approvedFaceImageId,
        approvedFaceUrl: state.candidateFaceUrl ?? state.approvedFaceUrl,
        approvedBodyImageId: state.candidateBodyImageId,
        approvedBodyUrl: state.candidateBodyUrl,
      };

    case "DISCARD_CLICKED":
      if (state.kind !== "candidate_ready") return state;
      return { ...state, kind: "discarding" };

    case "DISCARDED":
      if (state.kind !== "discarding") return state;
      return {
        kind: "approved",
        prompt: state.candidatePrompt,
        approvedFaceImageId: state.approvedFaceImageId,
        approvedFaceUrl: state.approvedFaceUrl,
        approvedBodyImageId: state.approvedBodyImageId,
        approvedBodyUrl: state.approvedBodyUrl,
      };

    case "RESET_CLICKED":
      if (state.kind !== "approved") return state;
      return {
        kind: "resetting",
        prompt: state.prompt,
        approvedFaceImageId: state.approvedFaceImageId,
        approvedFaceUrl: state.approvedFaceUrl,
        approvedBodyImageId: state.approvedBodyImageId,
        approvedBodyUrl: state.approvedBodyUrl,
      };

    case "RESET_COMPLETED":
      if (state.kind !== "resetting") return state;
      return { kind: "loading_default_prompt" };

    case "LOCKED_PROMPT_SAVED":
      if (
        state.kind !== "approved" &&
        state.kind !== "regenerating_full_face" &&
        state.kind !== "regenerating_full_body" &&
        state.kind !== "regenerating_body_only"
      )
        return state;
      return { ...state, prompt: action.prompt };

    case "ERROR": {
      const recovery = computeRecoveryState(state);
      return {
        kind: "error",
        message: action.message,
        previousKind: recovery.kind,
        recoveryState: recovery,
      };
    }

    case "ERROR_DISMISSED":
      if (state.kind !== "error") return state;
      return state.recoveryState;
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

const FULL_THUMB =
  "w-24 h-32 object-cover rounded-md border cursor-zoom-in";
const GREYED_THUMB =
  "w-24 h-32 object-cover rounded-md border cursor-zoom-in opacity-50 transition-opacity hover:opacity-75";
const SLOT_PLACEHOLDER =
  "w-24 h-32 rounded-md border border-dashed flex items-center justify-center text-xs text-muted-foreground";

export function CharacterCard({ character, seriesId, imageModel, onUpdate }: Props) {
  void seriesId;
  const bodyModelLabel = BODY_MODEL_LABELS[imageModel] ?? imageModel;

  const [state, dispatch] = useReducer(reducer, {
    kind: "loading_default_prompt",
  } as CardState);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState("");
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);

  const isMountedRef = useRef(true);
  const stateRef = useRef(state);
  stateRef.current = state;
  // Per-handler double-click guard for handlers that have a click→fetch→
  // dispatch gap (where the reducer hasn't yet transitioned away).
  const submittingRef = useRef(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const desc = (character.description as Record<string, string>) || {};
  const name = character.name ?? "(unnamed)";

  // ───────────────────────────────────────────────────────────
  // Polling — encapsulated. Each handler awaits this between
  // dispatches. Rejects on unmount so handlers silently bail
  // rather than dispatching ERROR onto a dead component.
  // ───────────────────────────────────────────────────────────
  const waitForCompletion = useCallback(
    (jobId: string): Promise<{ url: string }> => {
      return new Promise((resolve, reject) => {
        const interval = setInterval(async () => {
          if (!isMountedRef.current) {
            clearInterval(interval);
            reject(new Error("unmounted"));
            return;
          }
          try {
            const res = await fetch(`/api/status/${jobId}`);
            if (!res.ok) return;
            const data = (await res.json()) as {
              completed: boolean;
              imageUrl?: string | null;
              error?: string;
            };
            if (data.completed && data.imageUrl) {
              clearInterval(interval);
              resolve({ url: data.imageUrl });
            } else if (data.error) {
              clearInterval(interval);
              reject(new Error(data.error));
            }
          } catch {
            // transient — keep polling
          }
        }, 3000);
      });
    },
    []
  );

  const cleanupImage = useCallback(
    async (imageId: string) => {
      try {
        await fetch(
          `/api/stories/characters/${character.id}/cleanup-image`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image_id: imageId }),
          }
        );
      } catch (e) {
        console.warn(`[cleanup] failed for ${imageId}:`, e);
      }
    },
    [character.id]
  );

  const isUnmounted = (err: unknown) =>
    err instanceof Error && err.message === "unmounted";

  const errorMessage = (err: unknown) =>
    err instanceof Error ? err.message : "Unknown error";

  // ───────────────────────────────────────────────────────────
  // Drive flows — consume a starting state, walk through the
  // remaining dispatches + fetches. Used by both fresh handlers
  // (handleGenerate from idle) and hydration resume.
  // ───────────────────────────────────────────────────────────

  // Drives face-only generation. Stops at face_ready — body is separate.
  // Handles both fresh generation (initial.kind === "idle") and hydration
  // resume (initial.kind === "generating_face").
  const driveGenerateFaceFlow = useCallback(
    async (initial: CardState) => {
      const ids: { faceImageId?: string } = {};
      try {
        let faceImageId: string;
        let faceJobId: string;

        if (initial.kind === "idle") {
          const res = await fetch(
            `/api/stories/characters/${character.id}/generate`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                customPrompt: initial.prompt.trim() || undefined,
              }),
            }
          );
          const data = (await res.json()) as {
            jobId?: string;
            imageId?: string;
            error?: string;
          };
          if (!res.ok || !data.jobId || !data.imageId) {
            throw new Error(data.error || "Generate failed");
          }
          faceImageId = data.imageId;
          faceJobId = data.jobId;
          ids.faceImageId = faceImageId;
          dispatch({ type: "FACE_STARTED", faceJobId, faceImageId });
        } else if (initial.kind === "generating_face") {
          faceImageId = initial.faceImageId;
          faceJobId = initial.faceJobId;
          ids.faceImageId = faceImageId;
        } else {
          return;
        }

        const faceResult = await waitForCompletion(faceJobId);
        dispatch({ type: "FACE_COMPLETED", faceUrl: faceResult.url });
      } catch (err) {
        if (isUnmounted(err)) return;
        if (ids.faceImageId) await cleanupImage(ids.faceImageId);
        dispatch({ type: "ERROR", message: errorMessage(err) });
      }
    },
    [character.id, cleanupImage, waitForCompletion]
  );

  // Drives body-only generation from an explicit face + body prompt.
  // Called from handleGenerateBody and handleRegenBody.
  const driveGenerateBodyFlow = useCallback(
    async (input: { faceImageId: string; bodyPrompt: string }) => {
      const ids: { bodyImageId?: string } = {};
      try {
        const res = await fetch(
          `/api/stories/characters/${character.id}/generate-body`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              face_image_id: input.faceImageId,
              prompt: input.bodyPrompt.trim() || undefined,
            }),
          }
        );
        const data = (await res.json()) as {
          jobId?: string;
          imageId?: string;
          error?: string;
        };
        if (!res.ok || !data.jobId || !data.imageId) {
          throw new Error(data.error || "Body generate failed");
        }
        ids.bodyImageId = data.imageId;
        dispatch({ type: "BODY_STARTED", bodyJobId: data.jobId, bodyImageId: data.imageId });
        const bodyResult = await waitForCompletion(data.jobId);
        dispatch({ type: "BODY_COMPLETED", bodyUrl: bodyResult.url });
      } catch (err) {
        if (isUnmounted(err)) return;
        if (ids.bodyImageId) await cleanupImage(ids.bodyImageId);
        dispatch({ type: "ERROR", message: errorMessage(err) });
      }
    },
    [character.id, cleanupImage, waitForCompletion]
  );

  const driveRegenFullFlow = useCallback(
    async (initial: CardState) => {
      const ids: {
        candidateFaceImageId?: string;
        candidateBodyImageId?: string;
      } = {};
      try {
        let candidateFaceImageId: string;
        let candidateFaceJobId: string;
        let candidatePromptUsed: string;

        if (initial.kind === "approved") {
          const res = await fetch(
            `/api/stories/characters/${character.id}/generate`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                customPrompt: initial.prompt.trim() || undefined,
              }),
            }
          );
          const data = (await res.json()) as {
            jobId?: string;
            imageId?: string;
            promptUsed?: string;
            error?: string;
          };
          if (!res.ok || !data.jobId || !data.imageId) {
            throw new Error(data.error || "Generate failed");
          }
          candidateFaceImageId = data.imageId;
          candidateFaceJobId = data.jobId;
          candidatePromptUsed = data.promptUsed ?? initial.prompt;
          ids.candidateFaceImageId = candidateFaceImageId;
          dispatch({
            type: "CANDIDATE_FACE_STARTED",
            jobId: candidateFaceJobId,
            imageId: candidateFaceImageId,
          });
        } else if (initial.kind === "regenerating_full_face") {
          candidateFaceImageId = initial.candidateFaceImageId;
          candidateFaceJobId = initial.candidateFaceJobId;
          candidatePromptUsed = initial.prompt;
          ids.candidateFaceImageId = candidateFaceImageId;
        } else if (initial.kind === "regenerating_full_body") {
          ids.candidateFaceImageId = initial.candidateFaceImageId;
          ids.candidateBodyImageId = initial.candidateBodyImageId;
          if (!initial.candidateBodyJobId) {
            throw new Error(
              "hydration: regenerating_full_body without candidateBodyJobId"
            );
          }
          const bodyResult = await waitForCompletion(
            initial.candidateBodyJobId
          );
          dispatch({
            type: "CANDIDATE_BODY_COMPLETED",
            url: bodyResult.url,
            generatedAt: new Date().toISOString(),
            candidatePrompt: initial.prompt,
          });
          return;
        } else {
          return;
        }

        const faceResult = await waitForCompletion(candidateFaceJobId);
        dispatch({
          type: "CANDIDATE_FACE_COMPLETED",
          url: faceResult.url,
        });

        const bodyRes = await fetch(
          `/api/stories/characters/${character.id}/generate-body`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              face_image_id: candidateFaceImageId,
            }),
          }
        );
        const bodyData = (await bodyRes.json()) as {
          jobId?: string;
          imageId?: string;
          error?: string;
        };
        if (!bodyRes.ok || !bodyData.jobId || !bodyData.imageId) {
          throw new Error(bodyData.error || "Body generate failed");
        }
        ids.candidateBodyImageId = bodyData.imageId;
        dispatch({
          type: "CANDIDATE_BODY_STARTED",
          jobId: bodyData.jobId,
          imageId: bodyData.imageId,
        });

        const bodyResult = await waitForCompletion(bodyData.jobId);
        dispatch({
          type: "CANDIDATE_BODY_COMPLETED",
          url: bodyResult.url,
          generatedAt: new Date().toISOString(),
          candidatePrompt: candidatePromptUsed,
        });
      } catch (err) {
        if (isUnmounted(err)) return;
        if (ids.candidateFaceImageId)
          await cleanupImage(ids.candidateFaceImageId);
        if (ids.candidateBodyImageId)
          await cleanupImage(ids.candidateBodyImageId);
        dispatch({ type: "ERROR", message: errorMessage(err) });
      }
    },
    [character.id, cleanupImage, waitForCompletion]
  );

  const driveRegenBodyOnlyFlow = useCallback(
    async (initial: CardState) => {
      const ids: { candidateBodyImageId?: string } = {};
      try {
        if (initial.kind === "approved") {
          const res = await fetch(
            `/api/stories/characters/${character.id}/generate-body`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                face_image_id: initial.approvedFaceImageId,
              }),
            }
          );
          const data = (await res.json()) as {
            jobId?: string;
            imageId?: string;
            error?: string;
          };
          if (!res.ok || !data.jobId || !data.imageId) {
            throw new Error(data.error || "Body generate failed");
          }
          ids.candidateBodyImageId = data.imageId;
          dispatch({
            type: "CANDIDATE_BODY_STARTED",
            jobId: data.jobId,
            imageId: data.imageId,
          });

          const bodyResult = await waitForCompletion(data.jobId);
          dispatch({
            type: "CANDIDATE_BODY_COMPLETED",
            url: bodyResult.url,
            generatedAt: new Date().toISOString(),
            candidatePrompt: initial.prompt,
          });
        } else if (initial.kind === "regenerating_body_only") {
          ids.candidateBodyImageId = initial.candidateBodyImageId;
          const bodyResult = await waitForCompletion(
            initial.candidateBodyJobId
          );
          dispatch({
            type: "CANDIDATE_BODY_COMPLETED",
            url: bodyResult.url,
            generatedAt: new Date().toISOString(),
            candidatePrompt: initial.prompt,
          });
        }
      } catch (err) {
        if (isUnmounted(err)) return;
        if (ids.candidateBodyImageId)
          await cleanupImage(ids.candidateBodyImageId);
        dispatch({ type: "ERROR", message: errorMessage(err) });
      }
    },
    [character.id, cleanupImage, waitForCompletion]
  );

  // ───────────────────────────────────────────────────────────
  // Click handlers
  // ───────────────────────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    const current = stateRef.current;
    if (current.kind !== "idle" || submittingRef.current) return;
    submittingRef.current = true;
    try {
      dispatch({ type: "GENERATE_CLICKED" });
      await driveGenerateFaceFlow(current);
    } finally {
      submittingRef.current = false;
    }
  }, [driveGenerateFaceFlow]);

  const handleApprove = useCallback(async () => {
    const current = stateRef.current;
    if (current.kind !== "body_ready") return;
    dispatch({ type: "APPROVE_CLICKED" });
    try {
      const res = await fetch(
        `/api/stories/characters/${character.id}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            face_image_id: current.faceImageId,
            body_image_id: current.bodyImageId,
            prompt: current.prompt,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Approval failed");
      dispatch({ type: "APPROVED" });
      onUpdate();
    } catch (err) {
      dispatch({ type: "ERROR", message: errorMessage(err) });
    }
  }, [character.id, onUpdate]);

  const handleCancel = useCallback(async () => {
    const current = stateRef.current;
    if (current.kind !== "body_ready") return;
    const { bodyImageId } = current;
    dispatch({ type: "CANCEL_CLICKED" });
    try {
      await cleanupImage(bodyImageId);
    } catch (e) {
      console.warn("[cancel] cleanup partial failure:", e);
    }
    dispatch({ type: "CANCELLED" });
  }, [cleanupImage]);

  const handleRegenFull = useCallback(async () => {
    const current = stateRef.current;
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      if (current.kind === "approved") {
        dispatch({ type: "REGEN_FULL_CLICKED" });
        await driveRegenFullFlow(current);
      }
    } finally {
      submittingRef.current = false;
    }
  }, [driveRegenFullFlow]);

  const handleRegenBodyOnly = useCallback(async () => {
    const current = stateRef.current;
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      if (current.kind === "approved") {
        dispatch({ type: "REGEN_BODY_ONLY_CLICKED" });
        await driveRegenBodyOnlyFlow(current);
      }
    } finally {
      submittingRef.current = false;
    }
  }, [driveRegenBodyOnlyFlow]);

  const handleRegenFace = useCallback(async () => {
    const current = stateRef.current;
    if (current.kind !== "face_ready" || submittingRef.current) return;
    submittingRef.current = true;
    const { faceImageId, prompt, bodyPrompt } = current;
    try {
      dispatch({ type: "REGEN_FACE_CLICKED" }); // → idle
      await cleanupImage(faceImageId);
      await driveGenerateFaceFlow({ kind: "idle", prompt, bodyPrompt });
    } finally {
      submittingRef.current = false;
    }
  }, [cleanupImage, driveGenerateFaceFlow]);

  const handleProceedToBody = useCallback(() => {
    dispatch({ type: "PROCEED_TO_BODY" });
  }, []);

  const handleGenerateBody = useCallback(async () => {
    const current = stateRef.current;
    if (current.kind !== "body_prompt_editing" || submittingRef.current) return;
    submittingRef.current = true;
    const { faceImageId, bodyPrompt } = current;
    try {
      dispatch({ type: "GENERATE_BODY_CLICKED" }); // → generating_body
      await driveGenerateBodyFlow({ faceImageId, bodyPrompt });
    } finally {
      submittingRef.current = false;
    }
  }, [driveGenerateBodyFlow]);

  const handleRegenBody = useCallback(async () => {
    const current = stateRef.current;
    if (current.kind !== "body_ready" || submittingRef.current) return;
    const { bodyImageId } = current;
    dispatch({ type: "REGEN_BODY_CLICKED" }); // → body_prompt_editing
    try {
      await cleanupImage(bodyImageId);
    } catch (e) {
      console.warn("[regen-body] cleanup failed:", e);
    }
  }, [cleanupImage]);

  const handleReplace = useCallback(async () => {
    const current = stateRef.current;
    if (current.kind !== "candidate_ready") return;
    dispatch({ type: "REPLACE_CLICKED" });
    try {
      const res = await fetch(
        `/api/stories/characters/${character.id}/replace-pair`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            new_face_image_id:
              current.candidateFaceImageId ?? current.approvedFaceImageId,
            new_body_image_id: current.candidateBodyImageId,
            new_prompt: current.candidatePrompt,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Replace failed");
      dispatch({ type: "REPLACED" });
      onUpdate();
    } catch (err) {
      dispatch({ type: "ERROR", message: errorMessage(err) });
    }
  }, [character.id, onUpdate]);

  const handleDiscard = useCallback(async () => {
    const current = stateRef.current;
    if (current.kind !== "candidate_ready") return;
    dispatch({ type: "DISCARD_CLICKED" });
    try {
      await fetch(
        `/api/stories/characters/${character.id}/discard-candidate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidate_face_image_id: current.candidateFaceImageId,
            candidate_body_image_id: current.candidateBodyImageId,
          }),
        }
      );
    } catch (e) {
      console.warn("[discard] server cleanup failed:", e);
    }
    dispatch({ type: "DISCARDED" });
  }, [character.id]);

  const handleReset = useCallback(async () => {
    const current = stateRef.current;
    if (current.kind !== "approved") return;
    dispatch({ type: "RESET_CLICKED" });
    try {
      const res = await fetch(
        `/api/stories/characters/${character.id}/reset-portrait`,
        { method: "POST" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Reset failed");
      }
      dispatch({ type: "RESET_COMPLETED" });
      onUpdate();
      // Without this follow-up fetch the card would sit on the
      // loading_default_prompt spinner indefinitely — mount-time
      // hydration is gated by hydratedRef and only runs once.
      try {
        const [faceRes, bodyRes] = await Promise.all([
          fetch(
            `/api/stories/characters/${character.id}/default-prompt?stage=face`
          ),
          fetch(
            `/api/stories/characters/${character.id}/default-prompt?stage=body`
          ),
        ]);
        const faceData = (await faceRes.json()) as { prompt?: string };
        const bodyData = (await bodyRes.json()) as { prompt?: string };
        if (isMountedRef.current) {
          dispatch({
            type: "DEFAULT_PROMPT_LOADED",
            prompt: faceData.prompt ?? "",
            bodyPrompt: bodyData.prompt ?? "",
          });
        }
      } catch {
        if (isMountedRef.current) {
          dispatch({
            type: "DEFAULT_PROMPT_LOADED",
            prompt: "",
            bodyPrompt: "",
          });
        }
      }
    } catch (err) {
      dispatch({ type: "ERROR", message: errorMessage(err) });
    }
  }, [character.id, onUpdate]);

  const handleErrorDismiss = useCallback(() => {
    dispatch({ type: "ERROR_DISMISSED" });
  }, []);

  const handlePromptEdit = useCallback((prompt: string) => {
    dispatch({ type: "PROMPT_EDITED", prompt });
  }, []);

  const handleBodyPromptEdit = useCallback((bodyPrompt: string) => {
    dispatch({ type: "BODY_PROMPT_EDITED", bodyPrompt });
  }, []);

  // ───────────────────────────────────────────────────────────
  // Hydration on mount
  // ───────────────────────────────────────────────────────────

  type InFlightResponse = {
    character_id: string;
    approved: {
      face_image_id: string | null;
      face_url: string | null;
      body_image_id: string | null;
      body_url: string | null;
    };
    pending: {
      face_image_id: string | null;
      face_url: string | null;
      face_job_id: string | null;
      face_status: string | null;
      face_prompt: string | null;
      body_image_id: string | null;
      body_url: string | null;
      body_job_id: string | null;
      body_status: string | null;
      body_prompt: string | null;
      body_created_at: string | null;
    } | null;
  };

  const buildHydratedState = useCallback(
    async (resp: InFlightResponse): Promise<CardState> => {
      const a = resp.approved;
      const p = resp.pending;
      const lockedPrompt = character.portrait_prompt_locked ?? "";

      const fetchDefault = async (
        stage: "face" | "body" = "face"
      ): Promise<string> => {
        try {
          const r = await fetch(
            `/api/stories/characters/${character.id}/default-prompt?stage=${stage}`
          );
          const d = (await r.json()) as { prompt?: string };
          return d.prompt ?? "";
        } catch {
          return "";
        }
      };

      // Approved + no pending
      if (a.face_url && a.body_url && !p) {
        const prompt = lockedPrompt || (await fetchDefault());
        return {
          kind: "approved",
          prompt,
          approvedFaceImageId: a.face_image_id!,
          approvedFaceUrl: a.face_url,
          approvedBodyImageId: a.body_image_id!,
          approvedBodyUrl: a.body_url,
        };
      }

      // Approved + pending
      if (a.face_url && a.body_url && p) {
        const prompt = lockedPrompt || (await fetchDefault());
        const approvedFields = {
          approvedFaceImageId: a.face_image_id!,
          approvedFaceUrl: a.face_url,
          approvedBodyImageId: a.body_image_id!,
          approvedBodyUrl: a.body_url,
        };

        const bodyDone = p.body_status === "completed" && p.body_url;
        const bodyInFlight =
          p.body_status === "pending" || p.body_status === "processing";
        const faceInFlight =
          p.face_status === "pending" || p.face_status === "processing";

        if (bodyDone) {
          return {
            kind: "candidate_ready",
            ...approvedFields,
            candidateFaceImageId:
              p.face_image_id && p.face_image_id !== a.face_image_id
                ? p.face_image_id
                : null,
            candidateFaceUrl:
              p.face_image_id && p.face_image_id !== a.face_image_id
                ? p.face_url
                : null,
            candidateBodyImageId: p.body_image_id!,
            candidateBodyUrl: p.body_url!,
            candidateGeneratedAt:
              p.body_created_at ?? new Date().toISOString(),
            candidatePrompt: p.face_prompt ?? prompt,
          };
        }

        if (faceInFlight && p.face_job_id && p.face_image_id) {
          return {
            kind: "regenerating_full_face",
            ...approvedFields,
            prompt,
            candidateFaceJobId: p.face_job_id,
            candidateFaceImageId: p.face_image_id,
          };
        }

        if (bodyInFlight && p.body_job_id && p.body_image_id) {
          if (!p.face_image_id || p.face_image_id === a.face_image_id) {
            return {
              kind: "regenerating_body_only",
              ...approvedFields,
              prompt,
              candidateBodyJobId: p.body_job_id,
              candidateBodyImageId: p.body_image_id,
            };
          }
          return {
            kind: "regenerating_full_body",
            ...approvedFields,
            prompt,
            candidateFaceImageId: p.face_image_id,
            candidateFaceUrl: p.face_url ?? "",
            candidateBodyJobId: p.body_job_id,
            candidateBodyImageId: p.body_image_id,
          };
        }

        console.warn(
          "[hydrate] ambiguous post-approval pending — falling back to approved",
          p
        );
        return { kind: "approved", prompt, ...approvedFields };
      }

      // Not approved + pending
      if (!a.face_url && p) {
        const prompt = p.face_prompt ?? "";
        // The body prompt that was actually submitted is on the body image
        // row (or its in-flight twin). Falls back to the auto-built body
        // default for hydration paths where body hasn't started yet.
        const bodyPrompt =
          p.body_prompt ?? (await fetchDefault("body"));
        const faceDone = p.face_status === "completed" && p.face_url;
        const bodyDone = p.body_status === "completed" && p.body_url;
        const faceInFlight =
          p.face_status === "pending" || p.face_status === "processing";
        const bodyInFlight =
          p.body_status === "pending" || p.body_status === "processing";

        if (faceDone && bodyDone) {
          return {
            kind: "body_ready",
            prompt,
            bodyPrompt,
            faceImageId: p.face_image_id!,
            faceUrl: p.face_url!,
            bodyImageId: p.body_image_id!,
            bodyUrl: p.body_url!,
          };
        }
        if (faceDone && !bodyInFlight && !bodyDone) {
          return {
            kind: "body_prompt_editing",
            prompt,
            bodyPrompt,
            faceImageId: p.face_image_id!,
            faceUrl: p.face_url!,
          };
        }
        if (faceDone && bodyInFlight && p.body_job_id && p.body_image_id) {
          return {
            kind: "generating_body",
            prompt,
            bodyPrompt,
            faceImageId: p.face_image_id!,
            faceUrl: p.face_url!,
            bodyJobId: p.body_job_id,
            bodyImageId: p.body_image_id,
          };
        }
        if (faceInFlight && p.face_job_id && p.face_image_id) {
          return {
            kind: "generating_face",
            prompt,
            bodyPrompt,
            faceJobId: p.face_job_id,
            faceImageId: p.face_image_id,
          };
        }

        console.warn(
          "[hydrate] ambiguous pre-approval pending — falling back to idle",
          p
        );
        return {
          kind: "idle",
          prompt: prompt || (await fetchDefault("face")),
          bodyPrompt,
        };
      }

      // Not approved + no pending
      const [facePromptDefault, bodyPromptDefault] = await Promise.all([
        fetchDefault("face"),
        fetchDefault("body"),
      ]);
      return {
        kind: "idle",
        prompt: facePromptDefault,
        bodyPrompt: bodyPromptDefault,
      };
    },
    [character.id, character.portrait_prompt_locked]
  );

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    (async () => {
      try {
        const res = await fetch(
          `/api/stories/characters/${character.id}/in-flight-state`
        );
        if (!res.ok) {
          const [faceRes, bodyRes] = await Promise.all([
            fetch(
              `/api/stories/characters/${character.id}/default-prompt?stage=face`
            ),
            fetch(
              `/api/stories/characters/${character.id}/default-prompt?stage=body`
            ),
          ]);
          const faceData = (await faceRes.json()) as { prompt?: string };
          const bodyData = (await bodyRes.json()) as { prompt?: string };
          if (!isMountedRef.current) return;
          dispatch({
            type: "DEFAULT_PROMPT_LOADED",
            prompt: faceData.prompt ?? "",
            bodyPrompt: bodyData.prompt ?? "",
          });
          return;
        }
        const data = (await res.json()) as InFlightResponse;
        if (!isMountedRef.current) return;
        const hydrated = await buildHydratedState(data);
        if (!isMountedRef.current) return;
        dispatch({ type: "HYDRATED", payload: { state: hydrated } });

        if (hydrated.kind === "generating_face") {
          await driveGenerateFaceFlow(hydrated);
        } else if (hydrated.kind === "generating_body") {
          // Resume body polling — face already done, just wait for body job.
          const { bodyJobId, bodyImageId } = hydrated;
          if (!bodyJobId) {
            dispatch({ type: "ERROR", message: "hydration: generating_body without bodyJobId" });
          } else {
            try {
              const bodyResult = await waitForCompletion(bodyJobId);
              if (isMountedRef.current) dispatch({ type: "BODY_COMPLETED", bodyUrl: bodyResult.url });
            } catch (err) {
              if (isUnmounted(err)) return;
              if (bodyImageId) await cleanupImage(bodyImageId);
              if (isMountedRef.current) dispatch({ type: "ERROR", message: errorMessage(err) });
            }
          }
        } else if (
          hydrated.kind === "regenerating_full_face" ||
          hydrated.kind === "regenerating_full_body"
        ) {
          await driveRegenFullFlow(hydrated);
        } else if (hydrated.kind === "regenerating_body_only") {
          await driveRegenBodyOnlyFlow(hydrated);
        }
      } catch (err) {
        if (isUnmounted(err)) return;
        console.error("[hydrate] failed:", err);
        if (isMountedRef.current) {
          dispatch({
            type: "DEFAULT_PROMPT_LOADED",
            prompt: "",
            bodyPrompt: "",
          });
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character.id]);

  // ───────────────────────────────────────────────────────────
  // Prompt editing (approved state)
  // ───────────────────────────────────────────────────────────

  const handleEditPrompt = () => {
    if (state.kind !== "approved") return;
    setPendingPrompt(state.prompt);
    setIsEditingPrompt(true);
  };

  const handleCancelEditPrompt = () => {
    setIsEditingPrompt(false);
    setPendingPrompt("");
  };

  const handleSavePrompt = async () => {
    if (pendingPrompt.trim().length === 0) return;
    setIsSavingPrompt(true);
    try {
      const res = await fetch(
        `/api/stories/characters/${character.id}/patch-prompt`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ portrait_prompt_locked: pendingPrompt.trim() }),
        }
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        dispatch({ type: "ERROR", message: data.error ?? "Failed to save prompt" });
        return;
      }
      const data = (await res.json()) as { portrait_prompt_locked: string };
      dispatch({ type: "LOCKED_PROMPT_SAVED", prompt: data.portrait_prompt_locked });
      setIsEditingPrompt(false);
      setPendingPrompt("");
    } catch (e) {
      dispatch({ type: "ERROR", message: errorMessage(e) });
    } finally {
      setIsSavingPrompt(false);
    }
  };

  // ───────────────────────────────────────────────────────────
  // Render helpers
  // ───────────────────────────────────────────────────────────

  const portraitApproved =
    state.kind === "approved" ||
    state.kind === "regenerating_full_face" ||
    state.kind === "regenerating_full_body" ||
    state.kind === "regenerating_body_only" ||
    state.kind === "candidate_ready" ||
    state.kind === "replacing" ||
    state.kind === "discarding" ||
    state.kind === "resetting" ||
    (state.kind === "error" &&
      (state.previousKind === "approved" ||
        state.previousKind === "regenerating_full_face" ||
        state.previousKind === "regenerating_full_body" ||
        state.previousKind === "regenerating_body_only" ||
        state.previousKind === "candidate_ready" ||
        state.previousKind === "replacing" ||
        state.previousKind === "discarding" ||
        state.previousKind === "resetting"));

  const formatTimestamp = (iso: string): string => {
    return new Date(iso).toLocaleString("en-ZA", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const renderHeaderStrip = () => (
    <div className="text-sm text-muted-foreground space-y-1">
      {desc.gender && <p>{desc.gender}</p>}
      {desc.ethnicity && <p>{desc.ethnicity}</p>}
      {desc.age && <p>{desc.age} years old</p>}
      {desc.skinTone && <p>{desc.skinTone} skin</p>}
      {desc.hairColor && desc.hairStyle && (
        <p>
          {desc.hairColor} {desc.hairStyle} hair
        </p>
      )}
      {character.prose_description && (
        <p className="pt-2 text-xs italic">{character.prose_description}</p>
      )}
    </div>
  );

  const Spinner = ({ label }: { label: string }) => (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>{label}</span>
    </div>
  );

  const SpinnerSlot = ({ label }: { label: string }) => (
    <div className="flex flex-col gap-1">
      <div className={SLOT_PLACEHOLDER}>
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );

  const Thumb = ({
    url,
    greyed,
    label,
    dimensions,
  }: {
    url: string;
    greyed?: boolean;
    label?: string;
    dimensions?: {
      requested_width: number | null;
      requested_height: number | null;
      actual_width: number | null;
      actual_height: number | null;
      fallback_reason: string | null;
    } | null;
  }) => {
    const fellBack =
      dimensions?.actual_width != null &&
      dimensions?.requested_width != null &&
      dimensions.actual_width !== dimensions.requested_width;
    return (
      <div className="flex flex-col gap-1">
        <div className="relative">
          <img
            src={url}
            alt={label ?? `${name}`}
            className={greyed ? GREYED_THUMB : FULL_THUMB}
            onClick={() => setLightboxUrl(url)}
          />
          {fellBack && (
            <div
              className="absolute bottom-1 right-1 max-w-[90%] truncate rounded bg-amber-500/95 px-1.5 py-0.5 text-[10px] font-medium text-black shadow"
              title={
                dimensions?.fallback_reason
                  ? `Siray rejected ${dimensions.requested_width}×${dimensions.requested_height} — fell back to ${dimensions.actual_width}×${dimensions.actual_height}.\n\nUpstream: ${dimensions.fallback_reason}`
                  : `Generated at ${dimensions?.actual_width}×${dimensions?.actual_height} (requested ${dimensions?.requested_width}×${dimensions?.requested_height})`
              }
            >
              {dimensions?.actual_width}×{dimensions?.actual_height} (Siray rejected{" "}
              {dimensions?.requested_width}×{dimensions?.requested_height})
            </div>
          )}
        </div>
        {label && <p className="text-[11px] text-muted-foreground">{label}</p>}
      </div>
    );
  };

  // Dimensions for the APPROVED face/body images, used to surface the
  // visible-fallback badge on Hunyuan stories where Siray rejected the
  // requested portrait size and we retried at the documented cap.
  const approvedFaceDims = character.face_image_dimensions;
  const approvedBodyDims = character.body_image_dimensions;

  const renderStateBody = (s: CardState, disabled = false) => {
    switch (s.kind) {
      case "loading_default_prompt":
        return <Spinner label="Loading…" />;

      case "idle":
        return (
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">Face prompt</p>
              <Textarea
                value={s.prompt}
                onChange={(e) => handlePromptEdit(e.target.value)}
                className="text-sm font-mono"
                rows={6}
                placeholder="Face prompt — sent verbatim to /generate. Clear to fall back to the default."
                disabled={disabled}
              />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Body prompt</p>
              <Textarea
                value={s.bodyPrompt}
                onChange={(e) => handleBodyPromptEdit(e.target.value)}
                className="text-sm font-mono"
                rows={6}
                placeholder="Body prompt — sent to /generate-body. Clear to fall back to the default body framing."
                disabled={disabled}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Both prompts are sent on Generate. The face prompt is locked
              onto the character row at Approve; the body prompt is not
              persisted.
            </p>
            <div className="flex gap-2">
              <Button
                onClick={handleGenerate}
                size="sm"
                disabled={disabled || !s.prompt.trim()}
              >
                Generate face
              </Button>
            </div>
            {s.error && <p className="text-xs text-red-600">{s.error}</p>}
          </div>
        );

      case "generating_face":
        return (
          <div className="space-y-2">
            <SpinnerSlot label="Generating face…" />
          </div>
        );

      case "face_ready":
        return (
          <div className="space-y-3">
            <div className="flex gap-3">
              <Thumb url={s.faceUrl} label="Face" />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Face prompt — edit and regenerate, or proceed to body</p>
              <Textarea
                value={s.prompt}
                onChange={(e) => handlePromptEdit(e.target.value)}
                className="text-xs font-mono"
                rows={5}
                disabled={disabled}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={handleRegenFace} disabled={disabled || !s.prompt.trim()}>
                Regenerate face
              </Button>
              <Button size="sm" onClick={handleProceedToBody} disabled={disabled}>
                Looks good → Generate body
              </Button>
            </div>
          </div>
        );

      case "body_prompt_editing":
        return (
          <div className="space-y-3">
            <div className="flex gap-3">
              <Thumb url={s.faceUrl} greyed label="Face (locked)" />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Body prompt — edit before generating</p>
              <Textarea
                value={s.bodyPrompt}
                onChange={(e) => handleBodyPromptEdit(e.target.value)}
                className="text-xs font-mono"
                rows={5}
                disabled={disabled}
              />
            </div>
            <Button size="sm" onClick={handleGenerateBody} disabled={disabled || !s.bodyPrompt.trim()}>
              Generate body
            </Button>
          </div>
        );

      case "generating_body":
        return (
          <div className="space-y-2">
            <div className="flex gap-3">
              <Thumb url={s.faceUrl} greyed label="Face (locked)" />
              <SpinnerSlot label="Generating body…" />
            </div>
          </div>
        );

      case "body_ready":
        return (
          <div className="space-y-3">
            <div className="flex gap-3">
              <Thumb url={s.faceUrl} label="Face" />
              <Thumb url={s.bodyUrl} label="Body" />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Body prompt — edit and regenerate, or approve</p>
              <Textarea
                value={s.bodyPrompt}
                onChange={(e) => handleBodyPromptEdit(e.target.value)}
                className="text-xs font-mono"
                rows={4}
                disabled={disabled}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleApprove} size="sm" disabled={disabled}>
                Approve
              </Button>
              <Button variant="outline" size="sm" onClick={handleRegenBody} disabled={disabled}>
                Regenerate body
              </Button>
              <Button variant="ghost" size="sm" onClick={handleCancel} disabled={disabled}>
                Cancel
              </Button>
            </div>
          </div>
        );

      case "approving":
        return (
          <div className="space-y-3">
            <div className="flex gap-3">
              <Thumb url={s.faceUrl} label="Face" />
              <Thumb url={s.bodyUrl} label="Body" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled>Approve</Button>
              <Button variant="outline" size="sm" disabled>Regenerate body</Button>
              <Button variant="ghost" size="sm" disabled>Cancel</Button>
              <Spinner label="Approving…" />
            </div>
          </div>
        );

      case "approved":
        return (
          <div className="space-y-3">
            <div className="flex gap-3">
              <Thumb url={s.approvedFaceUrl} label="Face" dimensions={approvedFaceDims} />
              <Thumb url={s.approvedBodyUrl} label="Body" dimensions={approvedBodyDims} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleReset}
                disabled={disabled}
                className="text-xs underline text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Reset portrait
              </button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRegenFull}
                disabled={disabled}
              >
                Regenerate full character
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRegenBodyOnly}
                disabled={disabled}
              >
                Regenerate body only
              </Button>
            </div>
            <div className="border rounded-md p-3 space-y-2 bg-muted/30">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">Portrait prompt</span>
                  <Badge variant="secondary" className="text-xs">Used in scene &amp; cover generation</Badge>
                </div>
                {!isEditingPrompt && (
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs"
                      onClick={handleEditPrompt}
                      disabled={disabled}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs"
                      onClick={handleRegenFull}
                      disabled={disabled}
                    >
                      Regenerate face →
                    </Button>
                  </div>
                )}
              </div>
              {isEditingPrompt ? (
                <div className="space-y-2">
                  <Textarea
                    value={pendingPrompt}
                    onChange={(e) => setPendingPrompt(e.target.value)}
                    rows={6}
                    className="text-xs font-mono resize-y"
                    disabled={isSavingPrompt}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleSavePrompt}
                      disabled={isSavingPrompt || pendingPrompt.trim().length === 0}
                    >
                      {isSavingPrompt ? (
                        <><Loader2 className="h-3 w-3 animate-spin mr-1" />Saving…</>
                      ) : (
                        "Save"
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCancelEditPrompt}
                      disabled={isSavingPrompt}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground font-mono leading-relaxed line-clamp-3">
                  {s.prompt || <span className="italic">No prompt locked</span>}
                </p>
              )}
            </div>
          </div>
        );

      case "regenerating_full_face":
        return (
          <div className="space-y-2">
            <div className="flex gap-3">
              <Thumb url={s.approvedFaceUrl} greyed label="Approved face" dimensions={approvedFaceDims} />
              <Thumb url={s.approvedBodyUrl} greyed label="Approved body" dimensions={approvedBodyDims} />
            </div>
            <SpinnerSlot label="Generating new face…" />
          </div>
        );

      case "regenerating_full_body":
        return (
          <div className="space-y-2">
            <div className="flex gap-3">
              <Thumb url={s.approvedFaceUrl} greyed label="Approved face" dimensions={approvedFaceDims} />
              <Thumb url={s.approvedBodyUrl} greyed label="Approved body" dimensions={approvedBodyDims} />
            </div>
            <div className="flex gap-3">
              <Thumb url={s.candidateFaceUrl} label="New face" />
              <SpinnerSlot label="Generating new body…" />
            </div>
          </div>
        );

      case "regenerating_body_only":
        return (
          <div className="space-y-2">
            <div className="flex gap-3">
              <Thumb url={s.approvedFaceUrl} label="Approved face" dimensions={approvedFaceDims} />
              <Thumb url={s.approvedBodyUrl} greyed label="Approved body" dimensions={approvedBodyDims} />
            </div>
            <div className="flex gap-3">
              <Thumb url={s.approvedFaceUrl} label="Face (unchanged)" dimensions={approvedFaceDims} />
              <SpinnerSlot label="Generating new body…" />
            </div>
          </div>
        );

      case "candidate_ready":
      case "replacing":
      case "discarding": {
        const busy = s.kind !== "candidate_ready";
        const busyLabel =
          s.kind === "replacing" ? "Replacing…" : "Discarding…";
        return (
          <div className="space-y-2">
            <div className="flex gap-3">
              <Thumb url={s.approvedFaceUrl} greyed label="Approved face" dimensions={approvedFaceDims} />
              <Thumb url={s.approvedBodyUrl} greyed label="Approved body" dimensions={approvedBodyDims} />
            </div>
            <p className="text-xs text-muted-foreground italic">
              Candidate generated {formatTimestamp(s.candidateGeneratedAt)}
            </p>
            <div className="flex gap-3">
              {s.candidateFaceUrl ? (
                <>
                  <Thumb url={s.candidateFaceUrl} label="Candidate face" />
                  <Thumb url={s.candidateBodyUrl} label="Candidate body" />
                </>
              ) : (
                <>
                  <Thumb url={s.approvedFaceUrl} label="Face (unchanged)" dimensions={approvedFaceDims} />
                  <Thumb url={s.candidateBodyUrl} label="Candidate body" />
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={handleReplace}
                disabled={busy || disabled}
              >
                Replace with candidate
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDiscard}
                disabled={busy || disabled}
              >
                Discard candidate
              </Button>
              {busy && <Spinner label={busyLabel} />}
            </div>
          </div>
        );
      }

      case "resetting":
        return (
          <div className="space-y-2">
            <div className="flex gap-3">
              <Thumb url={s.approvedFaceUrl} greyed label="Approved face" dimensions={approvedFaceDims} />
              <Thumb url={s.approvedBodyUrl} greyed label="Approved body" dimensions={approvedBodyDims} />
            </div>
            <Spinner label="Resetting…" />
          </div>
        );

      case "error":
        return (
          <div className="space-y-3">
            {renderStateBody(s.recoveryState, true)}
            <div className="rounded-md border border-red-300 bg-red-50 p-3 dark:bg-red-950/30">
              <p className="text-sm text-red-700 dark:text-red-400">
                {s.message}
              </p>
              <div className="mt-2">
                <Button size="sm" onClick={handleErrorDismiss}>
                  Dismiss
                </Button>
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <Card className="border-2 border-zinc-400 dark:border-zinc-500">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg">{name}</CardTitle>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1">
              {character.reused_from && (
                <Badge
                  variant="secondary"
                  className="text-xs"
                  title={`Approved portrait inherited from "${character.reused_from.series_title}"`}
                >
                  Reused from {character.reused_from.series_title}
                </Badge>
              )}
              <Badge variant={portraitApproved ? "default" : "outline"}>
                {portraitApproved ? "✓ Approved" : "Pending"}
              </Badge>
            </div>
            <div className="flex items-center gap-1">
              <Badge
                variant="outline"
                className="text-xs"
                title="Face is always generated by Nano Banana 2 (Siray). Body and scenes use this story's image model."
              >
                Face: Nano Banana 2
              </Badge>
              <Badge variant="outline" className="text-xs">
                Body: {bodyModelLabel}
              </Badge>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {renderHeaderStrip()}
        {renderStateBody(state)}
      </CardContent>

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
          <img
            src={lightboxUrl}
            alt="Full size preview"
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </Card>
  );
}
