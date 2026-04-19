"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  X,
  Search,
  Check,
  RefreshCw,
  Palette,
  AlertCircle,
  ArrowRight,
  Star,
  Zap,
} from "lucide-react";

// ── Types ──

interface Reference {
  id: number;
  url: string;
  rank: number;
  relevanceScore: number;
  explanation: string;
  whatMatches: string;
  whatDoesnt: string;
  recipe: {
    model: string | null;
    prompt: string;
    steps: number;
    cfgScale: number;
    sampler: string;
    dimensions: { width: number; height: number };
  };
}

interface Iteration {
  attempt: number;
  status: string;
  imageUrl: string | null;
  score: number | null;
  feedback: string | null;
  scores: Record<string, number> | null;
  error?: string;
}

interface JobStatus {
  id: string;
  status: string;
  intentAnalysis: Record<string, unknown> | null;
  referenceImages: Reference[];
  selectedReferenceId: number | null;
  currentIteration: number;
  bestIteration: number | null;
  bestScore: number | null;
  currentStatus: string | null;
  currentScore: number | null;
  currentFeedback: string | null;
  currentImageUrl: string | null;
  finalImageUrl: string | null;
  error: string | null;
  iterations: Iteration[];
}

type ModalStep =
  | "idle"
  | "analyzing"
  | "awaiting_selection"
  | "generating"
  | "completed"
  | "failed";

interface ArtDirectorModalProps {
  promptId: string;
  promptText: string;
  imageType: string;
  characterNames: string[];
  seriesId: string;
  /** When in batch mode, shows progress indicator */
  batchProgress?: { current: number; total: number };
  onClose: () => void;
  onComplete: (imageUrl: string) => void;
}

const POLL_INTERVAL = 4000;

const SCORE_DIMENSIONS: Array<{
  key: string;
  label: string;
  weight: string;
}> = [
  { key: "positionPose", label: "Position/Pose", weight: "30%" },
  { key: "characterCount", label: "Character Count", weight: "20%" },
  { key: "settingEnvironment", label: "Setting", weight: "15%" },
  { key: "characterAppearance", label: "Appearance", weight: "15%" },
  { key: "lightingMood", label: "Lighting/Mood", weight: "10%" },
  { key: "compositionQuality", label: "Composition", weight: "10%" },
];

// ── Component ──

export default function ArtDirectorModal({
  promptId,
  promptText,
  imageType,
  characterNames,
  seriesId,
  batchProgress,
  onClose,
  onComplete,
}: ArtDirectorModalProps) {
  const [step, setStep] = useState<ModalStep>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [references, setReferences] = useState<Reference[]>([]);
  const [selectedRefId, setSelectedRefId] = useState<number | null>(null);
  const [intentAnalysis, setIntentAnalysis] = useState<Record<string, unknown> | null>(null);
  const [iterations, setIterations] = useState<Iteration[]>([]);
  const [currentIteration, setCurrentIteration] = useState(0);
  const [bestScore, setBestScore] = useState<number | null>(null);
  const [bestIteration, setBestIteration] = useState<number | null>(null);
  const [finalImageUrl, setFinalImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [podStatus, setPodStatus] = useState<"checking" | "running" | "starting" | "stopped" | "error">("checking");
  const [podStartMessage, setPodStartMessage] = useState<string | null>(null);
  const [selectedIterationIdx, setSelectedIterationIdx] = useState<number | null>(null);
  const [approving, setApproving] = useState(false);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const podPollRef = useRef<NodeJS.Timeout | null>(null);
  const podReadyRef = useRef(false);

  // ART DIRECTOR POD AUTO-START — DEACTIVATED 2026-04-19
  // Pod can still be started manually via /api/art-director/pod if needed.
  // The original auto-start useEffect is preserved below (commented) for
  // potential reactivation alongside the rest of the Art Director pipeline.
  /*
  useEffect(() => {
    let cancelled = false;
    let pollCount = 0;
    const MAX_POD_POLLS = 30; // 30 * 10s = 5 minutes

    async function checkAndStartPod() {
      try {
        const res = await fetch("/api/art-director/pod");
        const data = await res.json();

        if (data.status === "running" && data.modelStatus === "ok") {
          setPodStatus("running");
          podReadyRef.current = true;
          return;
        }

        if (data.status === "running") {
          setPodStatus("starting");
          setPodStartMessage("AI model is loading... Almost ready.");
          startPodPolling();
          return;
        }

        setPodStatus("starting");
        setPodStartMessage("Starting AI model... This takes about 2-3 minutes on first use.");

        try {
          const startRes = await fetch("/api/art-director/pod", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: data.podId ? "start" : "create" }),
          });

          if (!startRes.ok) {
            const err = await startRes.json();
            throw new Error(err.error || "Failed to start pod");
          }

          startPodPolling();
        } catch (err) {
          if (!cancelled) {
            setPodStatus("error");
            setPodStartMessage(
              err instanceof Error ? err.message : "Failed to start AI model"
            );
          }
        }
      } catch {
        if (!cancelled) {
          setPodStatus("error");
          setPodStartMessage("Could not check AI model status");
        }
      }
    }

    function startPodPolling() {
      podPollRef.current = setInterval(async () => {
        if (cancelled || podReadyRef.current) {
          if (podPollRef.current) clearInterval(podPollRef.current);
          return;
        }

        pollCount++;
        if (pollCount > MAX_POD_POLLS) {
          if (podPollRef.current) clearInterval(podPollRef.current);
          setPodStatus("error");
          setPodStartMessage("AI model failed to start within 5 minutes. Click Retry to try again.");
          return;
        }

        try {
          const res = await fetch("/api/art-director/pod");
          const data = await res.json();

          if (data.status === "running" && data.modelStatus === "ok") {
            if (podPollRef.current) clearInterval(podPollRef.current);
            setPodStatus("running");
            setPodStartMessage(null);
            podReadyRef.current = true;
          } else if (data.status === "running") {
            setPodStartMessage("AI model is loading... Almost ready.");
          }
        } catch {
          // Non-fatal polling error — keep trying
        }
      }, 10000);
    }

    checkAndStartPod();

    return () => {
      cancelled = true;
      if (podPollRef.current) clearInterval(podPollRef.current);
    };
  }, []);
  */

  // ── Cleanup polling on unmount ──
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (podPollRef.current) clearInterval(podPollRef.current);
    };
  }, []);

  // ── Step 1-3: Analyze ──
  const handleAnalyze = useCallback(async () => {
    setStep("analyzing");
    setError(null);

    try {
      const res = await fetch("/api/art-director/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptId,
          promptText,
          imageType,
          characterNames,
          seriesId,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Analysis failed");
      }

      const data = await res.json();
      setJobId(data.jobId);
      setIntentAnalysis(data.intentAnalysis);
      setReferences(data.references || []);
      setStep("awaiting_selection");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      setStep("failed");
    }
  }, [promptId, promptText, imageType, characterNames, seriesId]);

  // Auto-start analysis once pod is ready
  const hasStartedAnalysis = useRef(false);
  useEffect(() => {
    if (podStatus === "running" && !hasStartedAnalysis.current && step === "idle") {
      hasStartedAnalysis.current = true;
      handleAnalyze();
    }
  }, [podStatus, step, handleAnalyze]);

  // ── Step 4: Select reference ──
  const handleSelectReference = async () => {
    if (!jobId || selectedRefId == null) return;
    setError(null);

    try {
      const res = await fetch("/api/art-director/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, referenceId: selectedRefId }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Selection failed");
      }

      // Steps 5-6: Adapt and generate
      const genRes = await fetch("/api/art-director/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });

      if (!genRes.ok) {
        const err = await genRes.json();
        throw new Error(err.error || "Generation start failed");
      }

      setStep("generating");
      startPolling();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setStep("failed");
    }
  };

  // ── Polling ──
  const startPolling = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);

    pollingRef.current = setInterval(async () => {
      if (!jobId) return;

      try {
        const res = await fetch(`/api/art-director/status/${jobId}`);
        if (!res.ok) return;

        const data: JobStatus = await res.json();

        setIterations(data.iterations);
        setCurrentIteration(data.currentIteration);
        setBestScore(data.bestScore);
        setBestIteration(data.bestIteration);

        if (data.status === "completed") {
          setFinalImageUrl(data.finalImageUrl);
          setStep("completed");
          if (pollingRef.current) clearInterval(pollingRef.current);
        } else if (data.status === "failed") {
          setError(data.error || "Generation failed");
          // Still show results if we have iterations
          if (data.iterations.length > 0) {
            setStep("completed"); // Show what we have
          } else {
            setStep("failed");
          }
          if (pollingRef.current) clearInterval(pollingRef.current);
        }
      } catch {
        // Polling errors are non-fatal
      }
    }, POLL_INTERVAL);
  }, [jobId]);

  // Start polling when jobId changes and step is generating
  useEffect(() => {
    if (step === "generating" && jobId) {
      startPolling();
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [step, jobId, startPolling]);

  // ── Approve ──
  const handleApprove = async (iterationIndex?: number) => {
    if (!jobId) return;
    setApproving(true);

    try {
      const res = await fetch("/api/art-director/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, iterationIndex }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Approval failed");
      }

      const data = await res.json();
      onComplete(data.imageUrl);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setApproving(false);
    }
  };

  // ── Try again ──
  const handleTryAgain = () => {
    setStep("awaiting_selection");
    setIterations([]);
    setCurrentIteration(0);
    setBestScore(null);
    setBestIteration(null);
    setFinalImageUrl(null);
    setSelectedRefId(null);
    setError(null);
  };

  // ── Render ──

  const latestIteration = iterations[iterations.length - 1];
  const displayImage = selectedIterationIdx != null
    ? iterations[selectedIterationIdx]?.imageUrl
    : latestIteration?.imageUrl;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[95vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <Palette className="h-5 w-5 text-violet-400" />
            <h2 className="text-lg font-semibold">Generate Image</h2>
            {batchProgress && (
              <Badge variant="outline" className="text-xs text-violet-400 border-violet-500/30">
                Image {batchProgress.current} of {batchProgress.total}
              </Badge>
            )}
            {/* Pod status indicator */}
            <div className="flex items-center gap-1.5">
              <div
                className={`h-2 w-2 rounded-full ${
                  podStatus === "running"
                    ? "bg-green-500"
                    : podStatus === "starting"
                      ? "bg-yellow-500 animate-pulse"
                      : podStatus === "checking"
                        ? "bg-zinc-500 animate-pulse"
                        : "bg-red-500"
                }`}
              />
              <span className="text-xs text-muted-foreground">
                {podStatus === "running"
                  ? "AI Ready"
                  : podStatus === "starting"
                    ? "Starting..."
                    : podStatus === "checking"
                      ? "Checking..."
                      : "Offline"}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Prompt display */}
          <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-800/50 p-4">
            <p className="text-xs font-medium text-muted-foreground mb-1">Scene Prompt</p>
            <p className="text-sm text-zinc-300">{promptText}</p>
          </div>

          {/* ── Pod Starting ── */}
          {step === "idle" && (podStatus === "starting" || podStatus === "checking") && (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="mb-4 h-10 w-10 animate-spin text-yellow-400" />
              <h3 className="mb-2 text-lg font-semibold">Starting AI Model</h3>
              <p className="text-sm text-muted-foreground max-w-md text-center">
                {podStartMessage || "Starting AI model... This takes about 2-3 minutes on first use."}
              </p>
            </div>
          )}

          {/* ── Pod Error ── */}
          {step === "idle" && podStatus === "error" && (
            <div className="flex flex-col items-center justify-center py-16">
              <AlertCircle className="mb-4 h-10 w-10 text-red-400" />
              <h3 className="mb-2 text-lg font-semibold">Failed to Start AI Model</h3>
              <p className="text-sm text-red-400 max-w-md text-center">
                {podStartMessage || "Could not start the AI model."}
              </p>
              <Button
                variant="outline"
                className="mt-6"
                onClick={() => {
                  setPodStatus("checking");
                  setPodStartMessage("Retrying...");
                  podReadyRef.current = false;
                  hasStartedAnalysis.current = false;
                  // Re-trigger the mount effect by forcing a state change
                  window.location.reload();
                }}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry
              </Button>
            </div>
          )}

          {/* ── Analyzing ── */}
          {step === "analyzing" && (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="mb-4 h-10 w-10 animate-spin text-violet-400" />
              <h3 className="mb-2 text-lg font-semibold">Analyzing Scene</h3>
              <p className="text-sm text-muted-foreground max-w-md text-center">
                Analyzing prompt intent and searching CivitAI for reference images.
                This takes 30-60 seconds.
              </p>
            </div>
          )}

          {/* ── Reference Selection ── */}
          {step === "awaiting_selection" && (
            <div className="space-y-4">
              {/* Intent summary */}
              {intentAnalysis && (
                <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-4 space-y-2">
                  <h3 className="text-sm font-medium text-violet-400">Scene Intent</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-zinc-400">
                    <div>
                      <span className="text-zinc-500">Type:</span>{" "}
                      {String(intentAnalysis.interactionType || "unknown")}
                    </div>
                    <div>
                      <span className="text-zinc-500">Characters:</span>{" "}
                      {String(intentAnalysis.characterCount || 0)}
                    </div>
                    <div>
                      <span className="text-zinc-500">NSFW:</span>{" "}
                      {String(intentAnalysis.nsfwLevel || "unknown")}
                    </div>
                    <div>
                      <span className="text-zinc-500">Setting:</span>{" "}
                      {String((intentAnalysis.setting as string)?.slice(0, 40) || "unknown")}
                    </div>
                  </div>
                </div>
              )}

              <h3 className="text-sm font-medium">
                Select a Reference Image ({references.length} found)
              </h3>

              {references.length === 0 ? (
                <div className="flex flex-col items-center py-8 text-center">
                  <Search className="mb-3 h-8 w-8 text-zinc-600" />
                  <p className="text-sm text-muted-foreground">
                    No reference images found with generation metadata.
                  </p>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={handleAnalyze}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Search Again
                  </Button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {references.map((ref) => (
                      <Card
                        key={ref.id}
                        className={`cursor-pointer overflow-hidden transition-all ${
                          selectedRefId === ref.id
                            ? "ring-2 ring-violet-500 border-violet-500"
                            : "hover:border-zinc-600"
                        }`}
                        onClick={() => setSelectedRefId(ref.id)}
                      >
                        <div className="relative aspect-[3/4] bg-zinc-800">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={ref.url}
                            alt={`Reference ${ref.rank}`}
                            className="h-full w-full object-cover"
                          />
                          <div className="absolute top-2 left-2 flex items-center gap-1.5">
                            <Badge className="bg-violet-600 text-white text-xs">
                              #{ref.rank}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={`text-xs ${
                                ref.relevanceScore >= 80
                                  ? "bg-green-500/20 text-green-400 border-green-500/30"
                                  : ref.relevanceScore >= 60
                                    ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                                    : "bg-zinc-500/20 text-zinc-400 border-zinc-500/30"
                              }`}
                            >
                              {ref.relevanceScore}%
                            </Badge>
                          </div>
                          {selectedRefId === ref.id && (
                            <div className="absolute inset-0 bg-violet-500/10 flex items-center justify-center">
                              <div className="rounded-full bg-violet-600 p-2">
                                <Check className="h-6 w-6 text-white" />
                              </div>
                            </div>
                          )}
                        </div>
                        <CardContent className="p-3 space-y-2">
                          <p className="text-xs text-zinc-300">{ref.explanation}</p>
                          <div className="text-[10px] text-zinc-500 space-y-0.5">
                            <p>
                              <span className="text-green-400">+</span> {ref.whatMatches}
                            </p>
                            <p>
                              <span className="text-red-400">-</span> {ref.whatDoesnt}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-1 text-[10px] text-zinc-500">
                            <span>{ref.recipe.model?.slice(0, 20) || "Unknown model"}</span>
                            <span>|</span>
                            <span>{ref.recipe.steps}s</span>
                            <span>|</span>
                            <span>CFG {ref.recipe.cfgScale}</span>
                            <span>|</span>
                            <span>
                              {ref.recipe.dimensions.width}x{ref.recipe.dimensions.height}
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-4">
                    <Button
                      variant="outline"
                      onClick={handleAnalyze}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Search Again
                    </Button>
                    <Button
                      disabled={selectedRefId == null}
                      onClick={handleSelectReference}
                      className="bg-violet-600 hover:bg-violet-700"
                    >
                      <ArrowRight className="mr-2 h-4 w-4" />
                      Generate with Reference
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Generating ── */}
          {step === "generating" && (
            <div className="space-y-6">
              {/* Status header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
                  <div>
                    <h3 className="text-sm font-semibold">
                      {latestIteration?.status === "generating"
                        ? "Generating Image..."
                        : latestIteration?.status === "evaluating"
                          ? "Evaluating Result..."
                          : `Iteration ${currentIteration} of 8`}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {latestIteration?.status === "generating"
                        ? "CivitAI is generating the image"
                        : latestIteration?.status === "evaluating"
                          ? "Qwen VL is scoring the result"
                          : "Preparing next attempt"}
                    </p>
                  </div>
                </div>
                {bestScore != null && (
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Best Score</p>
                    <p
                      className={`text-2xl font-bold ${
                        bestScore >= 90
                          ? "text-green-400"
                          : bestScore >= 70
                            ? "text-amber-400"
                            : "text-red-400"
                      }`}
                    >
                      {Math.round(bestScore)}
                    </p>
                  </div>
                )}
              </div>

              {/* Current image + scores */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Image preview */}
                <div className="rounded-lg border border-zinc-800 bg-zinc-800/50 overflow-hidden">
                  {displayImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={displayImage}
                      alt="Current generation"
                      className="w-full object-contain max-h-[500px]"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-64">
                      <Loader2 className="h-8 w-8 animate-spin text-zinc-600" />
                    </div>
                  )}
                </div>

                {/* Scores */}
                <div className="space-y-4">
                  {latestIteration?.scores && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium">Evaluation Scores</h4>
                      {SCORE_DIMENSIONS.map((dim) => {
                        const score = (latestIteration.scores as Record<string, number>)?.[dim.key] ?? 0;
                        return (
                          <div key={dim.key} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-zinc-400">
                                {dim.label}{" "}
                                <span className="text-zinc-600">({dim.weight})</span>
                              </span>
                              <span
                                className={
                                  score >= 90
                                    ? "text-green-400"
                                    : score >= 70
                                      ? "text-amber-400"
                                      : "text-red-400"
                                }
                              >
                                {Math.round(score)}
                              </span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-zinc-800">
                              <div
                                className={`h-1.5 rounded-full transition-all duration-500 ${
                                  score >= 90
                                    ? "bg-green-500"
                                    : score >= 70
                                      ? "bg-amber-500"
                                      : "bg-red-500"
                                }`}
                                style={{ width: `${score}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Feedback */}
                  {latestIteration?.feedback && (
                    <div className="rounded-lg border border-zinc-800 bg-zinc-800/50 p-3">
                      <p className="text-xs font-medium text-zinc-400 mb-1">Feedback</p>
                      <p className="text-sm text-zinc-300">{latestIteration.feedback}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Iteration history strip */}
              {iterations.length > 1 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Iteration History</h4>
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {iterations.map((iter, idx) => (
                      <button
                        key={idx}
                        onClick={() => setSelectedIterationIdx(idx)}
                        className={`shrink-0 rounded-lg border overflow-hidden transition-all ${
                          selectedIterationIdx === idx
                            ? "ring-2 ring-violet-500 border-violet-500"
                            : bestIteration === idx
                              ? "border-green-500/50"
                              : "border-zinc-800 hover:border-zinc-600"
                        }`}
                      >
                        <div className="relative w-24 h-32 bg-zinc-800">
                          {iter.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={iter.imageUrl}
                              alt={`Attempt ${iter.attempt}`}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="flex items-center justify-center h-full">
                              <Loader2 className="h-4 w-4 animate-spin text-zinc-600" />
                            </div>
                          )}
                          {bestIteration === idx && (
                            <Star className="absolute top-1 right-1 h-3.5 w-3.5 text-green-400 fill-green-400" />
                          )}
                        </div>
                        <div className="p-1.5 text-center">
                          <p className="text-[10px] text-zinc-400">#{iter.attempt}</p>
                          {iter.score != null && (
                            <p
                              className={`text-xs font-semibold ${
                                iter.score >= 90
                                  ? "text-green-400"
                                  : iter.score >= 70
                                    ? "text-amber-400"
                                    : "text-red-400"
                              }`}
                            >
                              {Math.round(iter.score)}
                            </p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Completed ── */}
          {step === "completed" && (
            <div className="space-y-6">
              {/* Best result */}
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">
                    {(bestScore ?? 0) >= 90 ? "Generation Complete" : "Best Result"}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {iterations.length} iteration{iterations.length !== 1 ? "s" : ""} completed
                    {bestScore != null && ` | Best score: ${Math.round(bestScore)}/100`}
                  </p>
                </div>
                {bestScore != null && (
                  <div
                    className={`flex items-center gap-2 rounded-lg px-4 py-2 ${
                      bestScore >= 90
                        ? "bg-green-500/10 border border-green-500/30"
                        : bestScore >= 70
                          ? "bg-amber-500/10 border border-amber-500/30"
                          : "bg-red-500/10 border border-red-500/30"
                    }`}
                  >
                    <Zap
                      className={`h-5 w-5 ${
                        bestScore >= 90
                          ? "text-green-400"
                          : bestScore >= 70
                            ? "text-amber-400"
                            : "text-red-400"
                      }`}
                    />
                    <span
                      className={`text-2xl font-bold ${
                        bestScore >= 90
                          ? "text-green-400"
                          : bestScore >= 70
                            ? "text-amber-400"
                            : "text-red-400"
                      }`}
                    >
                      {Math.round(bestScore)}
                    </span>
                  </div>
                )}
              </div>

              {/* Final image */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="rounded-lg border border-zinc-800 overflow-hidden">
                  {(selectedIterationIdx != null
                    ? iterations[selectedIterationIdx]?.imageUrl
                    : finalImageUrl || iterations[bestIteration ?? 0]?.imageUrl
                  ) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={
                        selectedIterationIdx != null
                          ? iterations[selectedIterationIdx]?.imageUrl!
                          : finalImageUrl || iterations[bestIteration ?? 0]?.imageUrl!
                      }
                      alt="Final result"
                      className="w-full object-contain max-h-[500px]"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-64 bg-zinc-800">
                      <p className="text-sm text-zinc-500">No image available</p>
                    </div>
                  )}
                </div>

                {/* Scores for selected iteration */}
                <div className="space-y-4">
                  {(() => {
                    const viewIdx = selectedIterationIdx ?? bestIteration ?? 0;
                    const viewIter = iterations[viewIdx];
                    if (!viewIter?.scores) return null;

                    return (
                      <>
                        <div className="space-y-3">
                          <h4 className="text-sm font-medium">
                            Attempt #{viewIter.attempt} Scores
                          </h4>
                          {SCORE_DIMENSIONS.map((dim) => {
                            const score = (viewIter.scores as Record<string, number>)?.[dim.key] ?? 0;
                            return (
                              <div key={dim.key} className="space-y-1">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-zinc-400">{dim.label}</span>
                                  <span
                                    className={
                                      score >= 90
                                        ? "text-green-400"
                                        : score >= 70
                                          ? "text-amber-400"
                                          : "text-red-400"
                                    }
                                  >
                                    {Math.round(score)}
                                  </span>
                                </div>
                                <div className="h-1.5 w-full rounded-full bg-zinc-800">
                                  <div
                                    className={`h-1.5 rounded-full ${
                                      score >= 90
                                        ? "bg-green-500"
                                        : score >= 70
                                          ? "bg-amber-500"
                                          : "bg-red-500"
                                    }`}
                                    style={{ width: `${score}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {viewIter.feedback && (
                          <div className="rounded-lg border border-zinc-800 bg-zinc-800/50 p-3">
                            <p className="text-xs text-zinc-400 mb-1">Feedback</p>
                            <p className="text-sm text-zinc-300">{viewIter.feedback}</p>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Iteration history strip */}
              {iterations.length > 1 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">All Attempts</h4>
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {iterations.map((iter, idx) => (
                      <button
                        key={idx}
                        onClick={() => setSelectedIterationIdx(idx)}
                        className={`shrink-0 rounded-lg border overflow-hidden transition-all ${
                          selectedIterationIdx === idx
                            ? "ring-2 ring-violet-500 border-violet-500"
                            : bestIteration === idx
                              ? "border-green-500/50"
                              : "border-zinc-800 hover:border-zinc-600"
                        }`}
                      >
                        <div className="relative w-24 h-32 bg-zinc-800">
                          {iter.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={iter.imageUrl}
                              alt={`Attempt ${iter.attempt}`}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="flex items-center justify-center h-full text-xs text-zinc-600">
                              Failed
                            </div>
                          )}
                          {bestIteration === idx && (
                            <Star className="absolute top-1 right-1 h-3.5 w-3.5 text-green-400 fill-green-400" />
                          )}
                        </div>
                        <div className="p-1.5 text-center">
                          <p className="text-[10px] text-zinc-400">#{iter.attempt}</p>
                          {iter.score != null && (
                            <p
                              className={`text-xs font-semibold ${
                                iter.score >= 90
                                  ? "text-green-400"
                                  : iter.score >= 70
                                    ? "text-amber-400"
                                    : "text-red-400"
                              }`}
                            >
                              {Math.round(iter.score)}
                            </p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Failed ── */}
          {step === "failed" && (
            <div className="flex flex-col items-center justify-center py-16">
              <AlertCircle className="mb-4 h-10 w-10 text-red-400" />
              <h3 className="mb-2 text-lg font-semibold">Failed</h3>
              <p className="text-sm text-red-400 max-w-md text-center">{error}</p>
              <Button
                variant="outline"
                className="mt-6"
                onClick={handleAnalyze}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Try Again
              </Button>
            </div>
          )}

          {/* Error banner */}
          {error && step !== "failed" && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        {step === "completed" && (
          <div className="flex items-center justify-end gap-3 border-t border-zinc-800 px-6 py-4">
            <Button variant="outline" onClick={handleTryAgain}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
            {selectedIterationIdx != null && selectedIterationIdx !== bestIteration && (
              <Button
                variant="outline"
                className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10"
                onClick={() => handleApprove(selectedIterationIdx)}
                disabled={approving}
              >
                {approving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-2 h-4 w-4" />
                )}
                Use This Attempt
              </Button>
            )}
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={() => handleApprove(bestIteration ?? undefined)}
              disabled={approving}
            >
              {approving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Approve Best
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
