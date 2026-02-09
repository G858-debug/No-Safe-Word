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
import ImageViewer from "@/components/ImageViewer";
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
}

interface CharacterApprovalProps {
  seriesId: string;
  characters: CharacterFromAPI[];
  onProceedToImages?: () => void;
}

interface CharState {
  imageUrl: string | null;
  imageId: string | null;
  isGenerating: boolean;
  approved: boolean;
  approvedUrl: string | null;
  prompt: string;
  error: string | null;
  showDescription: boolean;
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

/** Client-side mirror of the server prompt builder for portrait shots */
function buildPortraitPrompt(desc: Record<string, unknown>): string {
  const d = desc as Record<string, string>;
  const parts: string[] = ["masterpiece, best quality, highly detailed"];

  if (d.age) parts.push(d.age);
  if (d.gender) parts.push(d.gender);
  if (d.ethnicity) parts.push(d.ethnicity);
  if (d.bodyType) parts.push(`${d.bodyType} body`);

  if (d.hairColor && d.hairStyle) {
    parts.push(`${d.hairColor} ${d.hairStyle} hair`);
  } else if (d.hairColor) {
    parts.push(`${d.hairColor} hair`);
  } else if (d.hairStyle) {
    parts.push(`${d.hairStyle} hair`);
  }

  if (d.eyeColor) parts.push(`${d.eyeColor} eyes`);
  if (d.skinTone) parts.push(`${d.skinTone} skin`);
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

const POLL_INTERVAL = 3000;
const MAX_POLL_ATTEMPTS = 60; // 3 minutes

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CharacterApproval({
  seriesId,
  characters,
  onProceedToImages,
}: CharacterApprovalProps) {
  // Per-character state keyed by story_character id
  const [charStates, setCharStates] = useState<Record<string, CharState>>({});
  const pollTimers = useRef<Record<string, NodeJS.Timeout>>({});
  const pollCounts = useRef<Record<string, number>>({});
  const [generatingAll, setGeneratingAll] = useState(false);
  const [generateAllProgress, setGenerateAllProgress] = useState<string | null>(null);

  // Initialize state from props (runs once)
  useEffect(() => {
    const initial: Record<string, CharState> = {};
    for (const ch of characters) {
      initial[ch.id] = {
        imageUrl: ch.approved_image_url || null,
        imageId: ch.approved_image_id || null,
        isGenerating: false,
        approved: ch.approved,
        approvedUrl: ch.approved_image_url || null,
        prompt: buildPortraitPrompt(ch.characters.description || {}),
        error: null,
        showDescription: false,
      };
    }
    setCharStates(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      Object.values(pollTimers.current).forEach(clearInterval);
    };
  }, []);

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
      // Clear existing poll if any
      if (pollTimers.current[storyCharId]) {
        clearInterval(pollTimers.current[storyCharId]);
      }
      pollCounts.current[storyCharId] = 0;

      pollTimers.current[storyCharId] = setInterval(async () => {
        pollCounts.current[storyCharId]++;

        if (pollCounts.current[storyCharId] >= MAX_POLL_ATTEMPTS) {
          clearInterval(pollTimers.current[storyCharId]);
          delete pollTimers.current[storyCharId];
          updateChar(storyCharId, {
            isGenerating: false,
            error: "Generation timed out. Please try again.",
          });
          return;
        }

        try {
          const res = await fetch(`/api/status/${jobId}`);
          if (!res.ok) throw new Error("Status check failed");
          const data = await res.json();

          if (data.completed && data.imageUrl) {
            clearInterval(pollTimers.current[storyCharId]);
            delete pollTimers.current[storyCharId];

            // Immediately store the image to Supabase Storage to preserve it
            try {
              const character = characters.find((c) => c.id === storyCharId);
              const characterName = character?.characters.name || "character";
              const timestamp = Date.now();
              const filename = `characters/${characterName.replace(/\s+/g, "-").toLowerCase()}-${timestamp}.jpeg`;

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
                // Use the permanent stored URL instead of the temporary blob URL
                updateChar(storyCharId, {
                  isGenerating: false,
                  imageUrl: storeData.stored_url,
                  imageId: imageId,
                  error: null,
                });
              } else {
                // Fallback to blob URL if storage fails
                updateChar(storyCharId, {
                  isGenerating: false,
                  imageUrl: data.imageUrl,
                  imageId: imageId,
                  error: null,
                });
              }
            } catch {
              // Fallback to blob URL if storage fails
              updateChar(storyCharId, {
                isGenerating: false,
                imageUrl: data.imageUrl,
                imageId: imageId,
                error: null,
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
      updateChar(storyCharId, { isGenerating: true, error: null });

      try {
        const res = await fetch(
          `/api/stories/characters/${storyCharId}/generate`,
          { method: "POST" }
        );
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Generation failed");
        }
        const data = await res.json();
        startPolling(storyCharId, data.jobId, data.imageId);
      } catch (err) {
        updateChar(storyCharId, {
          isGenerating: false,
          error: err instanceof Error ? err.message : "Generation failed",
        });
      }
    },
    [updateChar, startPolling]
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
        const res = await fetch(
          `/api/stories/characters/${storyCharId}/regenerate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: state.prompt }),
          }
        );
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Regeneration failed");
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
    [charStates, updateChar, startPolling]
  );

  const handleApprove = useCallback(
    async (storyCharId: string) => {
      const state = charStates[storyCharId];
      if (!state?.imageId) return;

      updateChar(storyCharId, { error: null });

      try {
        const res = await fetch(
          `/api/stories/characters/${storyCharId}/approve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image_id: state.imageId }),
          }
        );
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Approval failed");
        }
        const data = await res.json();
        updateChar(storyCharId, {
          approved: true,
          approvedUrl: data.stored_url || state.imageUrl,
        });
      } catch (err) {
        updateChar(storyCharId, {
          error: err instanceof Error ? err.message : "Approval failed",
        });
      }
    },
    [charStates, updateChar]
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

        const res = await fetch(
          `/api/stories/characters/${ch.id}/generate`,
          { method: "POST" }
        );

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Generation failed");
        }

        const data = await res.json();
        startPolling(ch.id, data.jobId, data.imageId);

        // Wait 2 seconds before starting the next one to avoid rate limits
        if (i < toGenerate.length - 1) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      } catch (err) {
        // On error, mark this character as failed but continue with the next
        updateChar(ch.id, {
          isGenerating: false,
          error: err instanceof Error ? err.message : "Generation failed",
        });

        // Still wait before next attempt to avoid hammering the API
        if (i < toGenerate.length - 1) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }

    setGeneratingAll(false);
    setGenerateAllProgress(null);
  }, [characters, charStates, updateChar, startPolling]);

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
                        Generating portrait...
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        This may take up to a minute
                      </p>
                    </div>
                  ) : displayUrl ? (
                    <div className="relative overflow-hidden rounded-lg">
                      <ImageViewer
                        src={displayUrl}
                        alt={`Portrait of ${ch.characters.name}`}
                        aspectRatio="3/4"
                        containerClassName="rounded-lg"
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
                      updateChar(ch.id, { prompt: e.target.value })
                    }
                    rows={4}
                    className="text-xs leading-relaxed resize-y bg-muted/30"
                    disabled={state.isGenerating}
                  />
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2">
                  {!hasImage && !state.isGenerating && (
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
