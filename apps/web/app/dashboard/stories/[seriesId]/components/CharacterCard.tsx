"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { X, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  PortraitPanel,
  type FaceState,
  type BodyState,
} from "./PortraitPanel";
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

// Shape of /api/stories/characters/[id]/in-flight-state after the
// 20260510 v2 additions (body_invalidated_at, latest_face, latest_body).
interface InFlightState {
  character_id: string;
  body_invalidated_at: string | null;
  approved: {
    face_image_id: string | null;
    face_url: string | null;
    body_image_id: string | null;
    body_url: string | null;
  };
  latest_face: ImageSummary | null;
  latest_body: ImageSummary | null;
}

interface ImageSummary {
  image_id: string;
  url: string | null;
  created_at: string;
  prompt: string | null;
  job_id: string | null;
  status: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// Hydration: map /in-flight-state response → (FaceState, BodyState).
// ─────────────────────────────────────────────────────────────────────

function hydrateFace(
  resp: InFlightState,
  defaultPrompt: string,
  lockedPrompt: string | null
): FaceState {
  const approvedId = resp.approved.face_image_id;
  const approvedUrl = resp.approved.face_url;
  if (approvedId && approvedUrl) {
    return {
      kind: "approved",
      prompt: lockedPrompt ?? "",
      imageId: approvedId,
      url: approvedUrl,
    };
  }
  const lf = resp.latest_face;
  if (lf) {
    if (lf.status === "pending" && lf.job_id) {
      return {
        kind: "generating",
        prompt: lf.prompt ?? defaultPrompt,
        jobId: lf.job_id,
        imageId: lf.image_id,
      };
    }
    if (lf.url) {
      return {
        kind: "generated",
        prompt: lf.prompt ?? defaultPrompt,
        imageId: lf.image_id,
        url: lf.url,
      };
    }
  }
  return { kind: "empty", prompt: defaultPrompt };
}

function hydrateBody(
  resp: InFlightState,
  defaultPrompt: string,
  faceState: FaceState
): BodyState {
  if (faceState.kind !== "approved") {
    return { kind: "locked" };
  }
  const approvedId = resp.approved.body_image_id;
  const approvedUrl = resp.approved.body_url;
  const lb = resp.latest_body;

  if (approvedId && approvedUrl && lb) {
    return {
      kind: "approved",
      prompt: lb.prompt ?? defaultPrompt,
      imageId: approvedId,
      url: approvedUrl,
      createdAt: lb.created_at,
    };
  }
  if (lb) {
    if (lb.status === "pending" && lb.job_id) {
      return {
        kind: "generating",
        prompt: lb.prompt ?? defaultPrompt,
        jobId: lb.job_id,
        imageId: lb.image_id,
      };
    }
    if (lb.url) {
      // Effective-stale derivation: invalidated AND the latest body image
      // was created AT OR BEFORE the invalidation timestamp. Once the user
      // regenerates the body, the new image's created_at is past the
      // invalidation timestamp and the stale banner clears immediately.
      const invalidated = resp.body_invalidated_at;
      const stale =
        invalidated != null &&
        new Date(lb.created_at).getTime() <=
          new Date(invalidated).getTime();
      return {
        kind: stale ? "generated_stale" : "generated",
        prompt: lb.prompt ?? defaultPrompt,
        imageId: lb.image_id,
        url: lb.url,
        createdAt: lb.created_at,
      };
    }
  }
  return { kind: "empty", prompt: defaultPrompt };
}

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

export function CharacterCard({
  character,
  seriesId: _seriesId,
  imageModel,
  onUpdate,
}: Props) {
  void _seriesId;
  const bodyModelLabel = BODY_MODEL_LABELS[imageModel] ?? imageModel;

  const [face, setFace] = useState<FaceState>({ kind: "empty", prompt: "" });
  const [body, setBody] = useState<BodyState>({ kind: "locked" });
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // True between any client→server fetch dispatch and its response.
  // Combined with derived `isAnyJobInFlight` to gate every action button.
  const [isAwaitingApi, setIsAwaitingApi] = useState(false);

  // Lightbox + locked-prompt editor state.
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [isEditingLockedPrompt, setIsEditingLockedPrompt] = useState(false);
  const [pendingLockedPrompt, setPendingLockedPrompt] = useState("");
  const [isSavingLockedPrompt, setIsSavingLockedPrompt] = useState(false);

  // Confirmation modal state.
  const [confirmModal, setConfirmModal] = useState<
    null | "regenerate-face" | "revoke-face"
  >(null);

  const isMountedRef = useRef(true);
  const submittingRef = useRef(false);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const name = character.name ?? "(unnamed)";

  // ─────────────────────────────────────────────────────────────────
  // Polling — resolves when /api/status reports completed, rejects on
  // unmount or upstream error.
  // ─────────────────────────────────────────────────────────────────
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

  const errorMessage = (err: unknown) =>
    err instanceof Error ? err.message : "Unknown error";

  // ─────────────────────────────────────────────────────────────────
  // Hydration on mount — fetch /in-flight-state + default prompts.
  // ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [stateRes, faceDefRes, bodyDefRes] = await Promise.all([
          fetch(`/api/stories/characters/${character.id}/in-flight-state`),
          fetch(
            `/api/stories/characters/${character.id}/default-prompt?stage=face`
          ),
          fetch(
            `/api/stories/characters/${character.id}/default-prompt?stage=body`
          ),
        ]);
        if (cancelled) return;

        const stateJson = (await stateRes.json()) as InFlightState;
        const faceDefault =
          faceDefRes.ok
            ? ((await faceDefRes.json()) as { prompt: string }).prompt
            : "";
        const bodyDefault =
          bodyDefRes.ok
            ? ((await bodyDefRes.json()) as { prompt: string }).prompt
            : "";

        const nextFace = hydrateFace(
          stateJson,
          faceDefault,
          character.portrait_prompt_locked
        );
        const nextBody = hydrateBody(stateJson, bodyDefault, nextFace);
        if (!cancelled) {
          setFace(nextFace);
          setBody(nextBody);
          setHydrated(true);
        }

        // If we hydrated into `generating` for either panel, resume
        // polling in the background. The polling resolve transitions
        // the panel to `generated`.
        if (nextFace.kind === "generating") resumeFacePolling(nextFace.jobId);
        if (nextBody.kind === "generating") resumeBodyPolling(nextBody.jobId);
      } catch (e) {
        if (!cancelled) {
          setError(errorMessage(e));
          setHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character.id]);

  const resumeFacePolling = useCallback(
    (jobId: string) => {
      waitForCompletion(jobId)
        .then(({ url }) => {
          setFace((prev) => {
            if (prev.kind !== "generating") return prev;
            return {
              kind: "generated",
              prompt: prev.prompt,
              imageId: prev.imageId,
              url,
            };
          });
        })
        .catch((e) => {
          if (e instanceof Error && e.message === "unmounted") return;
          setError(errorMessage(e));
        });
    },
    [waitForCompletion]
  );

  const resumeBodyPolling = useCallback(
    (jobId: string) => {
      waitForCompletion(jobId)
        .then(({ url }) => {
          setBody((prev) => {
            if (prev.kind !== "generating") return prev;
            return {
              kind: "generated",
              prompt: prev.prompt,
              imageId: prev.imageId,
              url,
              createdAt: new Date().toISOString(),
            };
          });
        })
        .catch((e) => {
          if (e instanceof Error && e.message === "unmounted") return;
          setError(errorMessage(e));
        });
    },
    [waitForCompletion]
  );

  // ─────────────────────────────────────────────────────────────────
  // Derived gates.
  // ─────────────────────────────────────────────────────────────────
  const isAnyJobInFlight =
    face.kind === "generating" || body.kind === "generating";
  const isBusy = isAwaitingApi || isAnyJobInFlight;

  // ─────────────────────────────────────────────────────────────────
  // Face handlers
  // ─────────────────────────────────────────────────────────────────

  const startFaceGeneration = useCallback(
    async (promptText: string) => {
      const res = await fetch(
        `/api/stories/characters/${character.id}/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customPrompt: promptText }),
        }
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to start face generation");
      }
      const data = (await res.json()) as {
        jobId: string;
        imageId: string;
      };
      // Optimistic transition immediately so the panel doesn't briefly
      // re-enable after isAwaitingApi clears but before polling starts.
      setFace({
        kind: "generating",
        prompt: promptText,
        jobId: data.jobId,
        imageId: data.imageId,
      });
      // Background polling.
      resumeFacePolling(data.jobId);
    },
    [character.id, resumeFacePolling]
  );

  const handleFaceGenerate = useCallback(async () => {
    if (face.kind !== "empty" && face.kind !== "generated") return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setIsAwaitingApi(true);
    try {
      await startFaceGeneration(face.prompt);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIsAwaitingApi(false);
      submittingRef.current = false;
    }
    // Note: a "Regenerate" from `generated` doesn't need cascade
    // confirmation — body is still locked at this point (face hasn't
    // been approved yet). Cascade only kicks in from `approved`.
  }, [face, startFaceGeneration]);

  const handleFaceApprove = useCallback(async () => {
    if (face.kind !== "generated") return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setIsAwaitingApi(true);
    try {
      const res = await fetch(
        `/api/stories/characters/${character.id}/approve-face`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            face_image_id: face.imageId,
            prompt: face.prompt,
          }),
        }
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to approve face");
      }
      // Transition face → approved. Body unlocks to empty (or its
      // hydrated state if the user had a body image previously). For a
      // fresh approval we go to empty; existing body images would have
      // been wiped by /revoke-face cascade upstream.
      setFace({
        kind: "approved",
        prompt: face.prompt,
        imageId: face.imageId,
        url: face.url,
      });
      setBody((prev) =>
        prev.kind === "locked"
          ? { kind: "empty", prompt: "" }
          : prev
      );
      // Refresh defaults (parent reloads the character list, which gives us
      // the new portrait_prompt_locked + body default prompt).
      onUpdate();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIsAwaitingApi(false);
      submittingRef.current = false;
    }
  }, [character.id, face, onUpdate]);

  const requiresFaceCascadeConfirmation =
    body.kind === "generated" ||
    body.kind === "generated_stale" ||
    body.kind === "approved";

  const handleFaceRegenerateClick = useCallback(() => {
    if (face.kind === "approved" && requiresFaceCascadeConfirmation) {
      setConfirmModal("regenerate-face");
      return;
    }
    void handleFaceGenerate();
  }, [face.kind, requiresFaceCascadeConfirmation, handleFaceGenerate]);

  const handleFaceRevokeClick = useCallback(() => {
    if (face.kind !== "approved") return;
    if (requiresFaceCascadeConfirmation) {
      setConfirmModal("revoke-face");
      return;
    }
    void handleFaceRevokeNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [face.kind, requiresFaceCascadeConfirmation]);

  // The face panel uses onGenerate for both first-generate and regenerate.
  // From the `approved` state we re-route through the cascade-confirmation
  // path; from any other state we generate directly.
  const handleFacePanelGenerate = useCallback(() => {
    if (face.kind === "approved") {
      handleFaceRegenerateClick();
      return;
    }
    void handleFaceGenerate();
  }, [face.kind, handleFaceRegenerateClick, handleFaceGenerate]);

  const handleFaceRevokeNow = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setIsAwaitingApi(true);
    try {
      const res = await fetch(
        `/api/stories/characters/${character.id}/revoke-face`,
        { method: "POST" }
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to revoke face");
      }
      // Optimistic: face becomes empty, body either becomes stale (if a
      // body image existed) or becomes locked (if not). The next mount
      // hydration will refine; until then we mirror cascade semantics.
      const cascadeApplies =
        body.kind === "generated" ||
        body.kind === "generated_stale" ||
        body.kind === "approved";
      setFace({ kind: "empty", prompt: "" });
      setBody((prev) => {
        if (!cascadeApplies) return { kind: "locked" };
        if (
          prev.kind === "generated" ||
          prev.kind === "approved" ||
          prev.kind === "generated_stale"
        ) {
          return {
            kind: "locked",
          };
          // After face is gone, body is locked again per the state-machine
          // rules. The body image row is preserved server-side; on next
          // approval+hydration the user will see it as `generated_stale`.
        }
        return prev;
      });
      onUpdate();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIsAwaitingApi(false);
      submittingRef.current = false;
    }
  }, [character.id, body, onUpdate]);

  const handleFaceRegenerateNow = useCallback(async () => {
    // Two-call cascade: revoke-face then generate. isAwaitingApi stays true
    // for the entire sequence so buttons don't briefly re-enable.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setIsAwaitingApi(true);
    try {
      const revokeRes = await fetch(
        `/api/stories/characters/${character.id}/revoke-face`,
        { method: "POST" }
      );
      if (!revokeRes.ok) {
        const data = (await revokeRes.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to revoke face");
      }
      // Lock body now (cascade applied); the next /in-flight-state read
      // after generation completes will surface the stale body for
      // re-approval after the new face approves.
      setBody({ kind: "locked" });
      const promptText = face.kind === "approved" ? face.prompt : "";
      // Optimistic face-state hop to avoid a re-enable flash.
      setFace({ kind: "empty", prompt: promptText });
      await startFaceGeneration(promptText);
      onUpdate();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIsAwaitingApi(false);
      submittingRef.current = false;
    }
  }, [character.id, face, startFaceGeneration, onUpdate]);

  // ─────────────────────────────────────────────────────────────────
  // Body handlers
  // ─────────────────────────────────────────────────────────────────

  const handleBodyGenerate = useCallback(async () => {
    if (face.kind !== "approved") return;
    if (
      body.kind !== "empty" &&
      body.kind !== "generated" &&
      body.kind !== "generated_stale"
    )
      return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setIsAwaitingApi(true);
    try {
      const promptText = "prompt" in body ? body.prompt : "";
      const res = await fetch(
        `/api/stories/characters/${character.id}/generate-body`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            face_image_id: face.imageId,
            prompt: promptText,
          }),
        }
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to start body generation");
      }
      const data = (await res.json()) as {
        jobId: string;
        imageId: string;
      };
      setBody({
        kind: "generating",
        prompt: promptText,
        jobId: data.jobId,
        imageId: data.imageId,
      });
      resumeBodyPolling(data.jobId);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIsAwaitingApi(false);
      submittingRef.current = false;
    }
  }, [character.id, face, body, resumeBodyPolling]);

  const handleBodyApprove = useCallback(async () => {
    if (body.kind !== "generated") return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setIsAwaitingApi(true);
    try {
      const res = await fetch(
        `/api/stories/characters/${character.id}/approve-body`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body_image_id: body.imageId }),
        }
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to approve body");
      }
      setBody({
        kind: "approved",
        prompt: body.prompt,
        imageId: body.imageId,
        url: body.url,
        createdAt: body.createdAt,
      });
      onUpdate();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIsAwaitingApi(false);
      submittingRef.current = false;
    }
  }, [character.id, body, onUpdate]);

  const handleBodyRevoke = useCallback(async () => {
    if (body.kind !== "approved") return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setIsAwaitingApi(true);
    try {
      const res = await fetch(
        `/api/stories/characters/${character.id}/revoke-body`,
        { method: "POST" }
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to revoke body");
      }
      // Body returns to `generated` (still valid, just unapproved).
      setBody({
        kind: "generated",
        prompt: body.prompt,
        imageId: body.imageId,
        url: body.url,
        createdAt: body.createdAt,
      });
      onUpdate();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIsAwaitingApi(false);
      submittingRef.current = false;
    }
  }, [character.id, body, onUpdate]);

  // ─────────────────────────────────────────────────────────────────
  // Locked-portrait-prompt editor (in approved face state)
  // ─────────────────────────────────────────────────────────────────

  const lockedPromptText =
    face.kind === "approved" ? face.prompt : "";

  const handleEditLockedPrompt = () => {
    setPendingLockedPrompt(lockedPromptText);
    setIsEditingLockedPrompt(true);
  };

  const handleCancelEditLockedPrompt = () => {
    setIsEditingLockedPrompt(false);
    setPendingLockedPrompt("");
  };

  const handleSaveLockedPrompt = async () => {
    if (pendingLockedPrompt.trim().length === 0) return;
    setIsSavingLockedPrompt(true);
    try {
      const res = await fetch(
        `/api/stories/characters/${character.id}/patch-prompt`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            portrait_prompt_locked: pendingLockedPrompt.trim(),
          }),
        }
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to save prompt");
        return;
      }
      const data = (await res.json()) as {
        portrait_prompt_locked: string;
      };
      setFace((prev) =>
        prev.kind === "approved"
          ? { ...prev, prompt: data.portrait_prompt_locked }
          : prev
      );
      setIsEditingLockedPrompt(false);
      setPendingLockedPrompt("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIsSavingLockedPrompt(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────
  // Prompt-edit handlers (passed into PortraitPanel)
  // ─────────────────────────────────────────────────────────────────

  const handleFacePromptChange = useCallback((next: string) => {
    setFace((prev) => {
      if (prev.kind === "empty" || prev.kind === "generated") {
        return { ...prev, prompt: next };
      }
      return prev;
    });
  }, []);

  const handleBodyPromptChange = useCallback((next: string) => {
    setBody((prev) => {
      if (
        prev.kind === "empty" ||
        prev.kind === "generated" ||
        prev.kind === "generated_stale"
      ) {
        return { ...prev, prompt: next };
      }
      return prev;
    });
  }, []);

  // ─────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────

  const portraitApproved = face.kind === "approved";

  const headerStrip = useMemo(() => {
    const desc =
      (character.description as Record<string, string> | null) ?? {};
    return (
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
  }, [character.description, character.prose_description]);

  if (!hydrated) {
    return (
      <Card className="border-2 border-zinc-400 dark:border-zinc-500">
        <CardHeader>
          <CardTitle className="text-base">{name}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading…</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-zinc-400 dark:border-zinc-500">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base">{name}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {character.reused_from && (
              <Badge variant="outline" className="text-[10px]">
                Reused from {character.reused_from.series_title}
              </Badge>
            )}
            <Badge variant={portraitApproved ? "default" : "outline"}>
              {portraitApproved && body.kind === "approved"
                ? "✓ Approved"
                : portraitApproved
                  ? "Face approved"
                  : "Pending"}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {headerStrip}

        <PortraitPanel
          kind="face"
          state={face}
          isBusy={isBusy}
          stepLabel="Step 1 of 2 — Face portrait"
          modelBadge="Nano Banana 2"
          onPromptChange={handleFacePromptChange}
          onGenerate={handleFacePanelGenerate}
          onApprove={handleFaceApprove}
          onRevoke={handleFaceRevokeClick}
          onImageClick={(url) => setLightboxUrl(url)}
        />

        {/* Locked portrait prompt editor — only shown when face is approved.
            Edits portrait_prompt_locked (used downstream in scene + cover
            generation). Independent of the face panel's own prompt
            textarea (which is for the next regeneration). */}
        {face.kind === "approved" && (
          <div className="border rounded-md p-3 space-y-2 bg-muted/30">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">
                  Locked portrait prompt
                </span>
                <Badge variant="secondary" className="text-[10px]">
                  Used in scene & cover generation
                </Badge>
              </div>
              {!isEditingLockedPrompt && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={handleEditLockedPrompt}
                  disabled={isBusy}
                >
                  Edit
                </Button>
              )}
            </div>
            {isEditingLockedPrompt ? (
              <div className="space-y-2">
                <Textarea
                  value={pendingLockedPrompt}
                  onChange={(e) => setPendingLockedPrompt(e.target.value)}
                  rows={6}
                  className="text-xs font-mono resize-y"
                  disabled={isSavingLockedPrompt}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleSaveLockedPrompt}
                    disabled={
                      isSavingLockedPrompt ||
                      pendingLockedPrompt.trim().length === 0
                    }
                  >
                    {isSavingLockedPrompt ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        Saving…
                      </>
                    ) : (
                      "Save"
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCancelEditLockedPrompt}
                    disabled={isSavingLockedPrompt}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground font-mono leading-relaxed line-clamp-3">
                {lockedPromptText || (
                  <span className="italic">No prompt locked</span>
                )}
              </p>
            )}
          </div>
        )}

        <PortraitPanel
          kind="body"
          state={body}
          isBusy={isBusy}
          stepLabel="Step 2 of 2 — Body portrait"
          modelBadge={bodyModelLabel}
          onPromptChange={handleBodyPromptChange}
          onGenerate={handleBodyGenerate}
          onApprove={handleBodyApprove}
          onRevoke={handleBodyRevoke}
          onImageClick={(url) => setLightboxUrl(url)}
        />

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 dark:bg-red-950/30 dark:border-red-900/60">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => setError(null)}
            >
              Dismiss
            </Button>
          </div>
        )}
      </CardContent>

      {/* ── Cascade-regenerate confirmation ─────────────────────── */}
      <AlertDialog
        open={confirmModal === "regenerate-face"}
        onOpenChange={(open) => {
          if (!open && confirmModal === "regenerate-face")
            setConfirmModal(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate face portrait?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace the face portrait. Body approval will be
              revoked and the body will need to be regenerated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmModal(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmModal(null);
                void handleFaceRegenerateNow();
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Cascade-revoke confirmation ─────────────────────────── */}
      <AlertDialog
        open={confirmModal === "revoke-face"}
        onOpenChange={(open) => {
          if (!open && confirmModal === "revoke-face") setConfirmModal(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke face approval?</AlertDialogTitle>
            <AlertDialogDescription>
              This will also revoke body approval. The body image will
              remain visible but you&apos;ll need to regenerate it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmModal(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmModal(null);
                void handleFaceRevokeNow();
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Lightbox ────────────────────────────────────────────── */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            className="absolute top-4 right-4 text-white"
            onClick={(e) => {
              e.stopPropagation();
              setLightboxUrl(null);
            }}
            aria-label="Close lightbox"
          >
            <X className="h-6 w-6" />
          </button>
          <img
            src={lightboxUrl}
            alt={name}
            className="max-h-[90vh] max-w-[90vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </Card>
  );
}
