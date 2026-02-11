"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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
} from "lucide-react";

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
  prompt: string;
  image_id: string | null;
  status: string;
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
}

interface PromptState {
  status: string;
  imageUrl: string | null;
  promptText: string;
  showPrompt: boolean;
  error: string | null;
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
}: ImageGenerationProps) {
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

  // Build a lookup: promptId → position (for pairing indicators)
  const promptPositionMap = useRef<Record<string, number>>({});

  // ---- Initialize state from props ----
  useEffect(() => {
    const initial: Record<string, PromptState> = {};
    const posMap: Record<string, number> = {};

    for (const post of posts) {
      for (const ip of post.story_image_prompts) {
        posMap[ip.id] = ip.position;

        // Determine image URL: stored/approved first, then blob
        const url = ip.image_id ? imageUrls[ip.image_id] || null : null;

        initial[ip.id] = {
          status: ip.status,
          imageUrl: url,
          promptText: ip.prompt,
          showPrompt: false,
          error: null,
        };

        // If status is generating, add to polling set
        if (ip.status === "generating") {
          pollingIdsRef.current.add(ip.id);
        }
      }
    }

    promptPositionMap.current = posMap;
    setPromptStates(initial);

    // Start polling if any were already generating
    if (pollingIdsRef.current.size > 0) {
      setIsPolling(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          // Job completed successfully
          pollingIdsRef.current.delete(promptId);
          promptToJobIdRef.current.delete(promptId);
          updatePrompt(promptId, {
            status: "generated",
            imageUrl: data.imageUrl || null,
            error: null,
          });
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

  const handleBatchGenerate = useCallback(
    async (postId?: string) => {
      setBatchGenerating(true);

      try {
        const body: Record<string, string> = {};
        if (postId) body.post_id = postId;

        const res = await fetch(
          `/api/stories/${seriesId}/generate-images`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Batch generation failed");
        }

        const data = await res.json();

        // Update state for all queued prompts
        for (const job of data.jobs || []) {
          if (job.jobId) {
            promptToJobIdRef.current.set(job.promptId, job.jobId);
          }
          updatePrompt(job.promptId, {
            status: "generating",
            error: null,
          });
          pollingIdsRef.current.add(job.promptId);
        }

        // Mark any failures
        for (const fail of data.errors || []) {
          updatePrompt(fail.promptId, {
            status: "failed",
            error: fail.error,
          });
        }

        if (pollingIdsRef.current.size > 0) {
          setIsPolling(true);
        }
      } catch (err) {
        console.error("Batch generate error:", err);
      } finally {
        setBatchGenerating(false);
      }
    },
    [seriesId, updatePrompt]
  );

  const handleRegenerate = useCallback(
    async (promptId: string) => {
      const state = promptStates[promptId];
      if (!state) return;

      // Save the edited prompt first
      try {
        await fetch(`/api/stories/images/${promptId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: state.promptText }),
        });
      } catch {
        // Non-critical — regenerate will use the stored prompt
      }

      updatePrompt(promptId, {
        status: "generating",
        error: null,
      });

      try {
        const res = await fetch(
          `/api/stories/images/${promptId}/regenerate`,
          { method: "POST" }
        );

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Regeneration failed");
        }

        const data = await res.json();
        if (data.jobId) {
          promptToJobIdRef.current.set(promptId, data.jobId);
        }

        pollingIdsRef.current.add(promptId);
        setIsPolling(true);
      } catch (err) {
        updatePrompt(promptId, {
          status: "failed",
          error: err instanceof Error ? err.message : "Regeneration failed",
        });
      }
    },
    [promptStates, updatePrompt]
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
            disabled={batchGenerating || counts.pending === 0}
          >
            {batchGenerating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            {batchGenerating
              ? "Submitting..."
              : `Generate All Images (${counts.pending})`}
          </Button>

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
                            promptPositionMap={promptPositionMap.current}
                            onUpdatePrompt={updatePrompt}
                            onRegenerate={handleRegenerate}
                            onApprove={handleApprove}
                            onGenerate={async () => {
                              updatePrompt(ip.id, {
                                status: "generating",
                                error: null,
                              });
                              try {
                                const res = await fetch(
                                  `/api/stories/images/${ip.id}/regenerate`,
                                  { method: "POST" }
                                );
                                if (!res.ok) {
                                  const err = await res.json();
                                  throw new Error(
                                    err.error || "Generation failed"
                                  );
                                }
                                const data = await res.json();
                                if (data.jobId) {
                                  promptToJobIdRef.current.set(ip.id, data.jobId);
                                }
                                pollingIdsRef.current.add(ip.id);
                                setIsPolling(true);
                              } catch (err) {
                                updatePrompt(ip.id, {
                                  status: "failed",
                                  error:
                                    err instanceof Error
                                      ? err.message
                                      : "Generation failed",
                                });
                              }
                            }}
                            onImageClick={setLightboxUrl}
                            batchGenerating={batchGenerating}
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// ImageCard sub-component
// ---------------------------------------------------------------------------

interface ImageCardProps {
  prompt: ImagePromptData;
  state: PromptState | undefined;
  imageType: string;
  promptPositionMap: Record<string, number>;
  onUpdatePrompt: (id: string, updates: Partial<PromptState>) => void;
  onRegenerate: (id: string) => void;
  onApprove: (id: string) => void;
  onGenerate: () => void;
  onImageClick: (url: string) => void;
  batchGenerating: boolean;
}

function ImageCard({
  prompt: ip,
  state,
  imageType,
  promptPositionMap,
  onUpdatePrompt,
  onRegenerate,
  onApprove,
  onGenerate,
  onImageClick,
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

  return (
    <Card
      className={`overflow-hidden transition-colors ${
        isApproved
          ? "border-green-500/30"
          : isGenerated
            ? "border-amber-500/30"
            : isFailed
              ? "border-red-500/30"
              : ""
      }`}
    >
      {/* Image area */}
      <div className="relative aspect-[2/3] bg-muted/30">
        {isGenerating ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
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
              className="h-full w-full object-contain"
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
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="mb-2 h-10 w-10 rounded-lg bg-muted/50 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-muted-foreground/50" />
            </div>
            <p className="text-xs text-muted-foreground">Not generated</p>
          </div>
        )}
      </div>

      <CardContent className="space-y-2.5 p-3">
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
        </div>

        {/* Error */}
        {state.error && (
          <div className="flex items-start gap-1.5 rounded bg-red-500/10 p-2 text-[11px] text-red-400">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            {state.error}
          </div>
        )}

        {/* Collapsible prompt */}
        <div>
          <button
            onClick={() =>
              onUpdatePrompt(ip.id, { showPrompt: !state.showPrompt })
            }
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {state.showPrompt ? "Hide prompt" : truncatedPrompt}
          </button>
          {state.showPrompt && (
            <Textarea
              value={state.promptText}
              onChange={(e) =>
                onUpdatePrompt(ip.id, { promptText: e.target.value })
              }
              rows={4}
              className="mt-1.5 text-[11px] leading-relaxed resize-y bg-muted/30"
              disabled={isGenerating || isApproved}
            />
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          {isPending && (
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={onGenerate}
              disabled={batchGenerating}
            >
              <Sparkles className="mr-1 h-3 w-3" />
              Generate
            </Button>
          )}
          {(isGenerated || isFailed) && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onRegenerate(ip.id)}
            >
              <RefreshCw className="mr-1 h-3 w-3" />
              Regenerate
            </Button>
          )}
          {isGenerated && (
            <Button
              size="sm"
              className="h-7 text-xs bg-green-600 hover:bg-green-700"
              onClick={() => onApprove(ip.id)}
            >
              <Check className="mr-1 h-3 w-3" />
              Approve
            </Button>
          )}
          {isApproved && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs text-green-400 border-green-500/30"
              disabled
            >
              <Check className="mr-1 h-3 w-3" />
              Approved
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
