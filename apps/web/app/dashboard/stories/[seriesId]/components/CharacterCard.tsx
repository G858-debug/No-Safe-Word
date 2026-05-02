"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { X } from "lucide-react";
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

// Simple character approval card: generate portrait → preview → approve.
// The approval persists to the base `characters` row so the face is reused in
// every story that features this character. Polling handles async flux2_dev
// jobs; hunyuan3 returns synchronously.
export function CharacterCard({ character, seriesId, onUpdate }: Props) {
  void seriesId;
  const [customPrompt, setCustomPrompt] = useState("");
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingImageId, setPendingImageId] = useState<string | null>(null);
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const desc = (character.description as Record<string, string>) || {};
  const name = character.name ?? "(unnamed)";

  const portraitApproved = character.approved;

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Pre-load the default generation prompt on mount. The textarea is the
  // single edit surface — no separate override block, no "Load default
  // prompt" button to click first.
  useEffect(() => {
    if (portraitApproved) return; // form is hidden, no need to fetch
    let cancelled = false;
    setIsLoadingPrompt(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/stories/characters/${character.id}/default-prompt`
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
  }, [character.id, portraitApproved]);

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
          imageUrl?: string | null;
          error?: string;
        };
        if (data.completed && data.imageUrl) {
          stopPolling();
          setIsGenerating(false);
          setPendingImageId(imageId);
          setPendingImageUrl(data.imageUrl);
        } else if (data.error) {
          // Surface failures regardless of `completed` — both the RunPod and
          // Siray handlers return { completed: false, error } on terminal
          // failure, and an infinite spinner is worse than a clear error.
          stopPolling();
          setIsGenerating(false);
          setError(data.error);
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
  }, [character.id, customPrompt, pollJob, stopPolling]);

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
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Approval failed");

      // Clear in-flight state. The form hides itself once portraitApproved
      // flips to true on the next data refresh.
      setPendingImageId(null);
      setPendingImageUrl(null);
      setPendingJobId(null);
      setPendingPrompt(null);
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setIsApproving(false);
    }
  }, [character.id, onUpdate, pendingImageId, pendingPrompt]);

  const handleReset = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(
        `/api/stories/characters/${character.id}/reset-portrait`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Reset failed");
      }
      setPendingImageId(null);
      setPendingImageUrl(null);
      setPendingJobId(null);
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    }
  }, [character.id, onUpdate]);

  return (
    <Card className="border-2 border-zinc-400 dark:border-zinc-500">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg">{name}</CardTitle>
          <div className="flex items-center gap-1">
            <Badge variant={portraitApproved ? "default" : "outline"}>
              {portraitApproved ? "✓ Approved" : "Pending"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-[auto_1fr] gap-4">
          <div className="flex flex-col gap-2">
            {character.approved_image_url && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Portrait</p>
                <img
                  src={character.approved_image_url}
                  alt={`${name} — portrait`}
                  className="w-24 h-32 object-cover rounded-md border cursor-zoom-in"
                  onClick={() => setLightboxUrl(character.approved_image_url ?? null)}
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

        {!portraitApproved && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Generate a portrait</p>
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
                {isGenerating ? "Generating…" : "Generate portrait"}
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
                  className="max-w-xs rounded-md border cursor-zoom-in"
                  onClick={() => setLightboxUrl(pendingImageUrl)}
                />
              </div>
            )}
          </div>
        )}

        {portraitApproved && (
          <p className="text-sm text-green-600">
            Character ready for story images.
          </p>
        )}

        {portraitApproved && (
          <div className="flex gap-2 text-xs">
            <button
              onClick={handleReset}
              className="underline text-muted-foreground hover:text-foreground"
            >
              Reset portrait
            </button>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
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
