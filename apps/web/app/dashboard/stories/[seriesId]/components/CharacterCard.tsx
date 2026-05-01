"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import type { CharacterFromAPI } from "./CharacterApproval";

interface Props {
  character: CharacterFromAPI;
  seriesId: string;
  onUpdate: () => void;
}

type Stage = "face" | "body";

// Simple character approval card:
//   1. Generate portrait → preview → approve   (stage = "face")
//   2. Generate full-body → preview → approve  (stage = "body")
//
// Both approvals persist to the base `characters` row so the face reused in
// any story that features this character. Polling handles async flux2_dev
// jobs; hunyuan3 returns synchronously.
export function CharacterCard({ character, seriesId, onUpdate }: Props) {
  void seriesId;
  const [stage, setStage] = useState<Stage>(
    character.approved ? "body" : "face"
  );
  const [customPrompt, setCustomPrompt] = useState("");
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingImageId, setPendingImageId] = useState<string | null>(null);
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const desc = (character.description as Record<string, string>) || {};
  const name = character.name ?? "(unnamed)";

  const portraitApproved = character.approved;
  const fullbodyApproved = character.approved_fullbody;
  const fullyApproved = portraitApproved && fullbodyApproved;

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Pre-load the default generation prompt for the current stage on mount
  // and whenever the stage transitions (face → body after face approval).
  // The textarea then becomes the single edit surface — no separate
  // override block, no "Load default prompt" button to click first.
  useEffect(() => {
    if (fullyApproved) return; // form is hidden, no need to fetch
    let cancelled = false;
    setIsLoadingPrompt(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/stories/characters/${character.id}/default-prompt?stage=${stage}`
        );
        if (cancelled) return;
        const data = (await res.json()) as { prompt?: string };
        if (data.prompt && !cancelled) setCustomPrompt(data.prompt);
      } catch {
        // silent — user can still type manually
      } finally {
        if (!cancelled) setIsLoadingPrompt(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [character.id, stage, fullyApproved]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollJob = useCallback(
    async (jobId: string, imageId: string) => {
      try {
        const res = await fetch(`/api/status/${jobId}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          completed: boolean;
          imageUrl: string | null;
          error?: string;
        };
        if (data.completed) {
          stopPolling();
          setIsGenerating(false);
          if (data.imageUrl) {
            setPendingImageId(imageId);
            setPendingImageUrl(data.imageUrl);
          } else if (data.error) {
            setError(data.error);
          }
        }
      } catch {
        // transient — keep polling
      }
    },
    [stopPolling]
  );

  const handleGenerate = useCallback(async () => {
    setError(null);
    setIsGenerating(true);
    setPendingImageId(null);
    setPendingImageUrl(null);
    setPendingJobId(null);
    stopPolling();

    try {
      const res = await fetch(
        `/api/stories/characters/${character.id}/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: stage === "face" ? "portrait" : "fullBody",
            stage,
            customPrompt: customPrompt.trim() || undefined,
          }),
        }
      );

      const data = (await res.json()) as {
        jobId?: string;
        imageId?: string;
        imageUrl?: string;
        promptUsed?: string;
        error?: string;
      };

      if (!res.ok || !data.imageId) {
        throw new Error(data.error || "Generation failed");
      }

      if (data.promptUsed) {
        setPendingPrompt(data.promptUsed);
        // Reflect the prompt that was actually sent in the textarea so the
        // user can see/iterate on it (matters when they cleared the field
        // and the server fell back to the default).
        setCustomPrompt(data.promptUsed);
      }

      if (data.imageUrl) {
        // Synchronous (hunyuan3)
        setPendingImageId(data.imageId);
        setPendingImageUrl(data.imageUrl);
        setIsGenerating(false);
      } else if (data.jobId) {
        // Async (flux2_dev) — poll
        setPendingJobId(data.jobId);
        pollRef.current = setInterval(
          () => pollJob(data.jobId!, data.imageId!),
          3000
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
      setIsGenerating(false);
    }
  }, [character.id, customPrompt, pollJob, stage, stopPolling]);

  const handleApprove = useCallback(async () => {
    if (!pendingImageId) return;
    setIsApproving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/stories/characters/${character.id}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_id: pendingImageId,
            prompt: pendingPrompt,
            type: stage === "face" ? "portrait" : "fullBody",
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Approval failed");

      // Clear in-flight state and advance the stage. customPrompt is
      // re-populated by the default-prompt effect when stage flips —
      // no need to blank it manually here.
      setPendingImageId(null);
      setPendingImageUrl(null);
      setPendingJobId(null);
      setPendingPrompt(null);
      if (stage === "face") setStage("body");
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setIsApproving(false);
    }
  }, [character.id, onUpdate, pendingImageId, pendingPrompt, stage]);

  const handleReset = useCallback(
    async (resetFace: boolean) => {
      setError(null);
      try {
        const res = await fetch(
          `/api/stories/characters/${character.id}/reset-portrait`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resetFace }),
          }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Reset failed");
        }
        setPendingImageId(null);
        setPendingImageUrl(null);
        setPendingJobId(null);
        setStage(resetFace ? "face" : "body");
        onUpdate();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Reset failed");
      }
    },
    [character.id, onUpdate]
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg">{name}</CardTitle>
          <div className="flex items-center gap-1">
            <Badge variant={portraitApproved ? "default" : "outline"}>
              {portraitApproved ? "✓ Face" : "Face"}
            </Badge>
            <Badge variant={fullbodyApproved ? "default" : "outline"}>
              {fullbodyApproved ? "✓ Body" : "Body"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-[auto_1fr] gap-4">
          <div className="flex flex-col gap-2">
            {character.approved_image_url && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Face</p>
                <img
                  src={character.approved_image_url}
                  alt={`${name} — portrait`}
                  className="w-24 h-32 object-cover rounded-md border"
                />
              </div>
            )}
            {character.approved_fullbody_image_url && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Body</p>
                <img
                  src={character.approved_fullbody_image_url}
                  alt={`${name} — full body`}
                  className="w-24 h-32 object-cover rounded-md border"
                />
              </div>
            )}
          </div>
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
        </div>

        {!fullyApproved && (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {stage === "face"
                ? "Generate a portrait"
                : "Generate a full-body shot"}
            </p>
            <Textarea
              placeholder={
                isLoadingPrompt
                  ? "Loading default prompt…"
                  : "Generation prompt — edit freely. Clear to fall back to the auto-built default."
              }
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              disabled={isLoadingPrompt}
              className="text-sm font-mono"
              rows={6}
            />
            <p className="text-[11px] text-muted-foreground">
              Loaded from the structured character description. Edits are sent
              to the model on Generate and persisted to the character row on
              Approve.
            </p>
            <div className="flex gap-2">
              <Button
                onClick={handleGenerate}
                disabled={isGenerating || isApproving}
                size="sm"
              >
                {isGenerating ? "Generating…" : `Generate ${stage === "face" ? "portrait" : "full body"}`}
              </Button>
              {pendingImageUrl && (
                <Button
                  onClick={handleApprove}
                  disabled={isApproving}
                  variant="default"
                  size="sm"
                >
                  {isApproving ? "Approving…" : "Approve"}
                </Button>
              )}
            </div>
            {pendingJobId && isGenerating && (
              <p className="text-xs text-muted-foreground">
                Job {pendingJobId} — waiting for RunPod…
              </p>
            )}
            {pendingImageUrl && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Preview</p>
                <img
                  src={pendingImageUrl}
                  alt="Preview"
                  className="max-w-xs rounded-md border"
                />
              </div>
            )}
          </div>
        )}

        {fullyApproved && (
          <p className="text-sm text-green-600">
            Character ready for story images.
          </p>
        )}

        {(portraitApproved || fullbodyApproved) && (
          <div className="flex gap-2 text-xs">
            {fullbodyApproved && (
              <button
                onClick={() => handleReset(false)}
                className="underline text-muted-foreground hover:text-foreground"
              >
                Reset body only
              </button>
            )}
            {portraitApproved && (
              <button
                onClick={() => handleReset(true)}
                className="underline text-muted-foreground hover:text-foreground"
              >
                Reset face + body
              </button>
            )}
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}
