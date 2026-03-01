/**
 * Debug Page for Multi-Pass Image Generation
 *
 * Displays full diagnostic view of the image generation pipeline:
 * - Intermediate images from each pass (composition → identity → quality → person → face → cleanup)
 * - Prompts used at each pass (original vs AI-optimized)
 * - LoRAs and parameters (seed, CFG, denoise, dimensions)
 * - Decomposed prompt comparison (before/after optimization)
 * - Scene classification results
 *
 * Location: apps/web/app/dashboard/stories/[seriesId]/debug/[promptId]/page.tsx
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Bug,
  ChevronDown,
  ChevronRight,
  Loader2,
  Play,
  RefreshCw,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ── Types ───────────────────────────────────────────────────────

interface DebugPassInfo {
  pass: number;
  name: string;
  description: string;
  prompt: string;
  loras: string[];
  params: {
    seed: number;
    steps: number;
    cfg: number;
    denoise: number;
    width?: number;
    height?: number;
  };
  filenamePrefix: string;
}

interface DebugData {
  jobId: string;
  generatedAt: string;
  seed: number;
  dimensions: { width: number; height: number; name: string };
  mode: string;
  imageType: string;
  characters: Array<{ name: string; gender: string; role: string }>;
  prompts: {
    rawScene: string;
    assembled: string;
    optimizedFull: string;
    decomposed: {
      original: {
        scenePrompt: string;
        primaryIdentityPrompt: string;
        secondaryIdentityPrompt: string | null;
        fullPrompt: string;
      };
      optimized: {
        scenePrompt: string;
        primaryIdentityPrompt: string;
        secondaryIdentityPrompt: string | null;
        fullPrompt: string;
      };
    };
    facePrompts: {
      primary: string;
      secondary: string | null;
    };
    regional?: {
      shared: string | null;
      primaryRegion: string | null;
      secondaryRegion: string | null;
    };
  };
  optimization: {
    wasOptimized: boolean;
    notes: string[];
    durationMs: number;
  };
  classification: Record<string, any>;
  resources: {
    loras: string[];
    characterLoras?: string[];
    negativeAdditions: string;
  };
  passes: DebugPassInfo[];
  intermediateImages: Record<string, string>;
}

interface PromptData {
  id: string;
  prompt: string;
  image_type: string;
  position: number;
  character_name?: string;
  secondary_character_name?: string;
  debug_data: DebugData | null;
  status: string;
}

// ── Components ──────────────────────────────────────────────────

function CollapsibleSection({
  title,
  defaultOpen = false,
  badge,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  badge?: string;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-zinc-200 hover:bg-zinc-800/50 transition-colors"
      >
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-zinc-500" />
        ) : (
          <ChevronRight className="h-4 w-4 text-zinc-500" />
        )}
        {title}
        {badge && (
          <span className="ml-auto rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
            {badge}
          </span>
        )}
      </button>
      {isOpen && <div className="border-t border-zinc-800 px-4 py-3">{children}</div>}
    </div>
  );
}

function PromptDiff({
  label,
  original,
  optimized,
}: {
  label: string;
  original: string;
  optimized: string;
}) {
  const changed = original !== optimized;
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {label}
        {changed && (
          <span className="ml-2 rounded bg-amber-900/50 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
            MODIFIED
          </span>
        )}
      </h4>
      {changed ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="mb-1 block text-[10px] font-medium text-red-400/70">ORIGINAL</span>
            <pre className="whitespace-pre-wrap rounded bg-zinc-950 p-2 text-xs text-red-300/80 leading-relaxed">
              {original}
            </pre>
          </div>
          <div>
            <span className="mb-1 block text-[10px] font-medium text-green-400/70">OPTIMIZED</span>
            <pre className="whitespace-pre-wrap rounded bg-zinc-950 p-2 text-xs text-green-300/80 leading-relaxed">
              {optimized}
            </pre>
          </div>
        </div>
      ) : (
        <pre className="whitespace-pre-wrap rounded bg-zinc-950 p-2 text-xs text-zinc-400 leading-relaxed">
          {original}
        </pre>
      )}
    </div>
  );
}

function PassCard({
  passInfo,
  imageUrl,
  isLoading,
  onClickImage,
}: {
  passInfo: DebugPassInfo;
  imageUrl?: string;
  isLoading: boolean;
  onClickImage?: (url: string, label: string) => void;
}) {
  const [showPrompt, setShowPrompt] = useState(false);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      {/* Image area */}
      <div className="relative aspect-[3/4] bg-zinc-950 flex items-center justify-center">
        {isLoading ? (
          <div className="flex flex-col items-center gap-2 text-zinc-600">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-xs">Generating...</span>
          </div>
        ) : imageUrl ? (
          <img
            src={imageUrl}
            alt={`Pass ${passInfo.pass}: ${passInfo.name}`}
            className="h-full w-full object-contain cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => onClickImage?.(imageUrl, `Pass ${passInfo.pass}: ${passInfo.name}`)}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-zinc-700">
            <Bug className="h-6 w-6" />
            <span className="text-xs">No image yet</span>
          </div>
        )}

        {/* Pass number badge */}
        <div className="absolute left-2 top-2 rounded bg-zinc-900/90 px-2 py-1 text-xs font-bold text-zinc-300 backdrop-blur-sm">
          Pass {passInfo.pass % 1 === 0 ? passInfo.pass : passInfo.pass.toFixed(1)}
        </div>
      </div>

      {/* Info area */}
      <div className="p-3 space-y-2">
        <h3 className="text-sm font-semibold text-zinc-200">{passInfo.name}</h3>
        <p className="text-xs text-zinc-500 leading-relaxed">{passInfo.description}</p>

        {/* Parameters */}
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
            seed: {passInfo.params.seed}
          </span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
            CFG: {passInfo.params.cfg}
          </span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
            denoise: {passInfo.params.denoise}
          </span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
            steps: {passInfo.params.steps}
          </span>
          {passInfo.params.width && (
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
              {passInfo.params.width}x{passInfo.params.height}
            </span>
          )}
        </div>

        {/* LoRAs */}
        {passInfo.loras.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {passInfo.loras.map((lora, i) => (
              <span
                key={i}
                className="rounded bg-purple-900/30 px-1.5 py-0.5 text-[10px] text-purple-300"
              >
                {lora.replace(".safetensors", "")}
              </span>
            ))}
          </div>
        )}

        {/* Expandable prompt */}
        <button
          onClick={() => setShowPrompt(!showPrompt)}
          className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {showPrompt ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          View prompt
        </button>
        {showPrompt && (
          <pre className="whitespace-pre-wrap rounded bg-zinc-950 p-2 text-[10px] text-zinc-400 leading-relaxed max-h-32 overflow-y-auto">
            {passInfo.prompt}
          </pre>
        )}
      </div>
    </div>
  );
}

// ── Main Page Component ─────────────────────────────────────────

export default function DebugPage() {
  const params = useParams();
  const seriesId = params.seriesId as string;
  const promptId = params.promptId as string;

  const [promptData, setPromptData] = useState<PromptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [pollInterval, setPollInterval] = useState<ReturnType<typeof setInterval> | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Store images from polling response directly (avoids DB round-trip for large base64 data)
  const [polledImages, setPolledImages] = useState<Record<string, string>>({});
  // Lightbox state for enlarged image view
  const [lightbox, setLightbox] = useState<{ url: string; label: string } | null>(null);

  // Fetch prompt data (including debug_data if available)
  const fetchPromptData = useCallback(async () => {
    try {
      const res = await fetch(`/api/stories/images/${promptId}/status`);
      if (!res.ok) throw new Error("Failed to fetch prompt");
      const statusData = await res.json();

      // Also fetch the full prompt record for debug_data
      const detailRes = await fetch(`/api/stories/images/${promptId}`);
      if (detailRes.ok) {
        const detailData = await detailRes.json();
        setPromptData({
          id: promptId,
          prompt: detailData.prompt || "",
          image_type: detailData.image_type || "unknown",
          position: detailData.position || 0,
          character_name: detailData.character_name,
          secondary_character_name: detailData.secondary_character_name,
          debug_data: detailData.debug_data || null,
          status: statusData.status || detailData.status,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [promptId]);

  useEffect(() => {
    fetchPromptData();
  }, [fetchPromptData]);

  // Start debug generation
  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);

    try {
      const res = await fetch(`/api/stories/images/${promptId}/debug-generate`, {
        method: "POST",
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Generation failed");
      }

      const data = await res.json();

      // Start polling for results
      const interval = setInterval(async () => {
        try {
          const statusRes = await fetch(
            `/api/stories/images/${promptId}/debug-status?jobId=${data.jobId}`,
          );
          if (!statusRes.ok) return;
          const statusData = await statusRes.json();

          if (statusData.status === "completed") {
            clearInterval(interval);
            setPollInterval(null);
            setGenerating(false);
            // Use images directly from polling response
            if (statusData.intermediateImages) {
              setPolledImages(statusData.intermediateImages);
            }
            fetchPromptData();
          } else if (statusData.status === "failed") {
            clearInterval(interval);
            setPollInterval(null);
            setGenerating(false);
            setError(statusData.error || "Generation failed on RunPod");
          }
        } catch {
          // Keep polling on transient errors
        }
      }, 3000);

      setPollInterval(interval);
    } catch (err) {
      setGenerating(false);
      setError(err instanceof Error ? err.message : "Generation failed");
    }
  }, [promptId, fetchPromptData]);

  // Auto-resume polling: if debug_data has a jobId but no intermediate images,
  // the job may have completed while we weren't polling. Try to fetch results.
  useEffect(() => {
    const dd = promptData?.debug_data;
    if (!dd || !dd.jobId) return;
    // Already have images or already polling
    if (Object.keys(dd.intermediateImages || {}).length > 0 || Object.keys(polledImages).length > 0 || pollInterval || generating) return;

    // Check if job is completed and fetch images
    const checkAndFetch = async () => {
      try {
        const statusRes = await fetch(
          `/api/stories/images/${promptId}/debug-status?jobId=${dd.jobId}`,
        );
        if (!statusRes.ok) return;
        const statusData = await statusRes.json();

        if (statusData.status === "completed" && Object.keys(statusData.intermediateImages || {}).length > 0) {
          setPolledImages(statusData.intermediateImages);
          fetchPromptData();
        } else if (statusData.status === "generating" || statusData.status === "queued") {
          // Job still running — start polling
          setGenerating(true);
          const interval = setInterval(async () => {
            try {
              const res = await fetch(
                `/api/stories/images/${promptId}/debug-status?jobId=${dd.jobId}`,
              );
              if (!res.ok) return;
              const data = await res.json();
              if (data.status === "completed") {
                clearInterval(interval);
                setPollInterval(null);
                setGenerating(false);
                if (data.intermediateImages) {
                  setPolledImages(data.intermediateImages);
                }
                fetchPromptData();
              } else if (data.status === "failed") {
                clearInterval(interval);
                setPollInterval(null);
                setGenerating(false);
                setError(data.error || "Generation failed on RunPod");
              }
            } catch {
              // Keep polling on transient errors
            }
          }, 3000);
          setPollInterval(interval);
        }
      } catch {
        // Silently fail — user can retry manually
      }
    };

    checkAndFetch();
  }, [promptData?.debug_data, pollInterval, generating, promptId, fetchPromptData, polledImages]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [pollInterval]);

  // Close lightbox on Escape
  useEffect(() => {
    if (!lightbox) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [lightbox]);

  const debugData = promptData?.debug_data;

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={`/dashboard/stories/${seriesId}`}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
              <Bug className="h-5 w-5 text-amber-400" />
              Debug: Multi-Pass Generation
            </h2>
            <p className="text-sm text-zinc-500">
              Image prompt: {promptId.slice(0, 8)}... &middot;{" "}
              {promptData?.image_type || "unknown"} &middot; Position{" "}
              {promptData?.position}
            </p>
          </div>
        </div>

        <Button
          onClick={handleGenerate}
          disabled={generating}
          variant="default"
          className="bg-amber-600 hover:bg-amber-500"
        >
          {generating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating...
            </>
          ) : debugData ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Regenerate Debug
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              Generate Debug
            </>
          )}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/20 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Raw prompt */}
      <CollapsibleSection title="Raw Scene Prompt (from Story JSON)" defaultOpen={!debugData}>
        <pre className="whitespace-pre-wrap rounded bg-zinc-950 p-3 text-xs text-zinc-400 leading-relaxed">
          {promptData?.prompt || "No prompt"}
        </pre>
      </CollapsibleSection>

      {debugData ? (
        <>
          {/* Characters */}
          <CollapsibleSection
            title="Characters"
            badge={`${debugData.characters.length} character${debugData.characters.length !== 1 ? "s" : ""}`}
          >
            <div className="flex gap-3">
              {debugData.characters.map((c, i) => (
                <div
                  key={i}
                  className="rounded-lg bg-zinc-800/50 px-3 py-2 text-sm"
                >
                  <span className="font-medium text-zinc-200">{c.name}</span>
                  <span className="ml-2 text-zinc-500">
                    {c.gender} &middot; {c.role}
                  </span>
                </div>
              ))}
            </div>
          </CollapsibleSection>

          {/* AI Optimization Results */}
          <CollapsibleSection
            title="AI Prompt Optimization"
            defaultOpen
            badge={
              debugData.optimization.wasOptimized
                ? `Applied (${debugData.optimization.durationMs}ms)`
                : "Skipped"
            }
          >
            <div className="space-y-3">
              {/* Optimization notes */}
              <div className="flex flex-wrap gap-1.5">
                {debugData.optimization.notes.map((note, i) => (
                  <span
                    key={i}
                    className={`rounded px-2 py-0.5 text-xs ${
                      note.includes("applied")
                        ? "bg-green-900/30 text-green-400"
                        : note.includes("WARNING")
                          ? "bg-amber-900/30 text-amber-400"
                          : note.includes("error") || note.includes("failed")
                            ? "bg-red-900/30 text-red-400"
                            : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {note}
                  </span>
                ))}
              </div>

              {/* Full prompt comparison */}
              <PromptDiff
                label="Full Prompt"
                original={debugData.prompts.assembled}
                optimized={debugData.prompts.optimizedFull}
              />

              {/* Decomposed prompt comparisons */}
              <PromptDiff
                label="Scene Prompt (Pass 1)"
                original={debugData.prompts.decomposed.original.scenePrompt}
                optimized={debugData.prompts.decomposed.optimized.scenePrompt}
              />
              <PromptDiff
                label="Primary Identity (Pass 2)"
                original={debugData.prompts.decomposed.original.primaryIdentityPrompt}
                optimized={debugData.prompts.decomposed.optimized.primaryIdentityPrompt}
              />
              {debugData.prompts.decomposed.original.secondaryIdentityPrompt && (
                <PromptDiff
                  label="Secondary Identity (Pass 2)"
                  original={debugData.prompts.decomposed.original.secondaryIdentityPrompt}
                  optimized={
                    debugData.prompts.decomposed.optimized.secondaryIdentityPrompt || ""
                  }
                />
              )}

              {/* Regional Prompts (Attention Couple) */}
              {debugData.prompts.regional?.shared && (
                <div className="mt-4 rounded-lg border border-amber-900/30 bg-amber-950/10 p-3 space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                    <Zap className="h-3 w-3" />
                    Attention Couple — Regional Prompts
                  </h4>
                  <div className="space-y-2">
                    <div>
                      <span className="mb-1 block text-[10px] font-medium text-zinc-500">SHARED BACKGROUND (full canvas)</span>
                      <pre className="whitespace-pre-wrap rounded bg-zinc-950 p-2 text-xs text-zinc-400 leading-relaxed">
                        {debugData.prompts.regional.shared}
                      </pre>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="mb-1 block text-[10px] font-medium text-blue-400/70">PRIMARY REGION (left ~55%)</span>
                        <pre className="whitespace-pre-wrap rounded bg-zinc-950 p-2 text-xs text-blue-300/70 leading-relaxed">
                          {debugData.prompts.regional.primaryRegion}
                        </pre>
                      </div>
                      <div>
                        <span className="mb-1 block text-[10px] font-medium text-pink-400/70">SECONDARY REGION (right ~55%)</span>
                        <pre className="whitespace-pre-wrap rounded bg-zinc-950 p-2 text-xs text-pink-300/70 leading-relaxed">
                          {debugData.prompts.regional.secondaryRegion}
                        </pre>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* Pass-by-Pass Images */}
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-300">
              <Zap className="h-4 w-4 text-amber-400" />
              Pass-by-Pass Progression
              <span className="text-zinc-600">({debugData.passes.length} passes)</span>
            </h3>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {debugData.passes.map((passInfo) => (
                <PassCard
                  key={passInfo.filenamePrefix}
                  passInfo={passInfo}
                  imageUrl={polledImages[passInfo.filenamePrefix] || debugData.intermediateImages[passInfo.filenamePrefix]}
                  isLoading={generating}
                  onClickImage={(url, label) => setLightbox({ url, label })}
                />
              ))}
            </div>
          </div>

          {/* Scene Classification */}
          <CollapsibleSection title="Scene Classification">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
              {Object.entries(debugData.classification).map(([key, value]) => (
                <div key={key} className="rounded bg-zinc-800/50 px-2 py-1.5">
                  <span className="text-[10px] text-zinc-500 block">{key}</span>
                  <span className="text-xs text-zinc-300">
                    {typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)}
                  </span>
                </div>
              ))}
            </div>
          </CollapsibleSection>

          {/* Resources */}
          <CollapsibleSection
            title="LoRAs & Resources"
            badge={`${debugData.resources.loras.length} LoRAs`}
          >
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {debugData.resources.loras.map((lora, i) => (
                  <span
                    key={i}
                    className="rounded bg-purple-900/30 px-2 py-1 text-xs text-purple-300"
                  >
                    {lora}
                  </span>
                ))}
              </div>
              {debugData.resources.characterLoras && debugData.resources.characterLoras.length > 0 && (
                <div>
                  <span className="text-[10px] text-zinc-500 block mb-1">Character LoRAs</span>
                  <div className="flex flex-wrap gap-1.5">
                    {debugData.resources.characterLoras.map((lora, i) => (
                      <span
                        key={i}
                        className="rounded bg-blue-900/30 px-2 py-1 text-xs text-blue-300"
                      >
                        {lora}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {debugData.resources.negativeAdditions && (
                <div>
                  <span className="text-[10px] text-zinc-500 block mb-1">
                    Negative Prompt Additions
                  </span>
                  <pre className="whitespace-pre-wrap rounded bg-zinc-950 p-2 text-[10px] text-zinc-500 leading-relaxed">
                    {debugData.resources.negativeAdditions}
                  </pre>
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* Face Prompts */}
          <CollapsibleSection title="Face Prompts (FaceDetailer)">
            <div className="space-y-2">
              <div>
                <span className="text-[10px] text-zinc-500 block mb-1">Primary Face Prompt</span>
                <pre className="whitespace-pre-wrap rounded bg-zinc-950 p-2 text-xs text-zinc-400 leading-relaxed">
                  {debugData.prompts.facePrompts.primary}
                </pre>
              </div>
              {debugData.prompts.facePrompts.secondary && (
                <div>
                  <span className="text-[10px] text-zinc-500 block mb-1">Secondary Face Prompt</span>
                  <pre className="whitespace-pre-wrap rounded bg-zinc-950 p-2 text-xs text-zinc-400 leading-relaxed">
                    {debugData.prompts.facePrompts.secondary}
                  </pre>
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* Generation Metadata */}
          <CollapsibleSection title="Generation Metadata">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <div className="rounded bg-zinc-800/50 px-2 py-1.5">
                <span className="text-[10px] text-zinc-500 block">Seed</span>
                <span className="text-xs text-zinc-300 font-mono">{debugData.seed}</span>
              </div>
              <div className="rounded bg-zinc-800/50 px-2 py-1.5">
                <span className="text-[10px] text-zinc-500 block">Dimensions</span>
                <span className="text-xs text-zinc-300">
                  {debugData.dimensions.width}x{debugData.dimensions.height} ({debugData.dimensions.name})
                </span>
              </div>
              <div className="rounded bg-zinc-800/50 px-2 py-1.5">
                <span className="text-[10px] text-zinc-500 block">Mode</span>
                <span className="text-xs text-zinc-300 uppercase">{debugData.mode}</span>
              </div>
              <div className="rounded bg-zinc-800/50 px-2 py-1.5">
                <span className="text-[10px] text-zinc-500 block">Job ID</span>
                <span className="text-xs text-zinc-300 font-mono">{debugData.jobId}</span>
              </div>
              <div className="rounded bg-zinc-800/50 px-2 py-1.5">
                <span className="text-[10px] text-zinc-500 block">Generated At</span>
                <span className="text-xs text-zinc-300">
                  {new Date(debugData.generatedAt).toLocaleString()}
                </span>
              </div>
            </div>
          </CollapsibleSection>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 py-16 text-center">
          <Bug className="mb-3 h-10 w-10 text-zinc-700" />
          <h3 className="text-sm font-medium text-zinc-400">No debug data yet</h3>
          <p className="mt-1 text-xs text-zinc-600">
            Click &quot;Generate Debug&quot; to run the multi-pass workflow with intermediate image captures.
          </p>
        </div>
      )}

      {/* Lightbox overlay */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
        >
          <button
            onClick={() => setLightbox(null)}
            className="absolute right-4 top-4 rounded-full bg-zinc-800/80 p-2 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-zinc-900/80 px-4 py-1.5 text-sm text-zinc-300 backdrop-blur-sm">
            {lightbox.label}
          </div>
          <img
            src={lightbox.url}
            alt={lightbox.label}
            className="max-h-[90vh] max-w-[90vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
