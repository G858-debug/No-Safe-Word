"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import {
  Loader2,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Package,
  Cpu,
  FileText,
  ChevronRight,
  AlertCircle,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface CaptionImage {
  id: string;
  converted_image_url: string;
  caption: string | null;
  pose_category: string | null;
  clothing_state: string | null;
  angle_category: string | null;
  signedUrl?: string;
}

interface TrainingConfig {
  triggerWord: string;
  steps: number;
  learningRate: number;
  loraRank: number;
  batchSize: number;
  resolution: number;
}

type Phase = "captioning" | "reviewing" | "packaging" | "configuring" | "training" | "complete";

const DEFAULT_CONFIG: TrainingConfig = {
  triggerWord: "nsw_curves",
  steps: 1000,
  learningRate: 0.0004,
  loraRank: 16,
  batchSize: 1,
  resolution: 768,
};

function fmtBytes(b: number): string {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

// ─────────────────────────────────────────────────────────────────
// Sub-stage chips
// ─────────────────────────────────────────────────────────────────

function StageChip({
  label,
  active,
  done,
}: {
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        done
          ? "bg-emerald-950/50 text-emerald-400 ring-1 ring-emerald-800"
          : active
          ? "bg-amber-950/50 text-amber-300 ring-1 ring-amber-700"
          : "bg-zinc-900 text-zinc-600 ring-1 ring-zinc-800"
      }`}
    >
      {done ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : active ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <span className="h-3 w-3 rounded-full bg-zinc-700" />
      )}
      {label}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Caption card
// ─────────────────────────────────────────────────────────────────

function CaptionCard({
  image,
  onCaptionChange,
}: {
  image: CaptionImage;
  onCaptionChange: (id: string, caption: string) => void;
}) {
  const [localCaption, setLocalCaption] = useState(image.caption ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLocalCaption(image.caption ?? "");
  }, [image.caption]);

  const handleBlur = useCallback(async () => {
    if (localCaption === (image.caption ?? "")) return;
    setSaving(true);
    await onCaptionChange(image.id, localCaption);
    setSaving(false);
  }, [localCaption, image.caption, image.id, onCaptionChange]);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      {/* Thumbnail */}
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded bg-zinc-800">
        {image.signedUrl ? (
          <img src={image.signedUrl} alt="Training image" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-zinc-600" />
          </div>
        )}
        {!image.caption && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
          </div>
        )}
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-0.5">
        {[image.pose_category, image.clothing_state, image.angle_category]
          .filter(Boolean)
          .map((t) => (
            <span key={t} className="rounded bg-zinc-800 px-1 py-0.5 text-[8px] text-zinc-500">
              {t?.replace(/_/g, " ")}
            </span>
          ))}
      </div>

      {/* Caption textarea */}
      <div className="relative">
        <textarea
          value={localCaption}
          onChange={(e) => setLocalCaption(e.target.value)}
          onBlur={handleBlur}
          rows={4}
          placeholder="Caption will appear here…"
          className="w-full resize-none rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-[11px] leading-relaxed text-zinc-300 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
        />
        {saving && (
          <Loader2 className="absolute right-2 top-2 h-3 w-3 animate-spin text-zinc-500" />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Training config form
// ─────────────────────────────────────────────────────────────────

function TrainingConfigForm({
  config,
  onChange,
}: {
  config: TrainingConfig;
  onChange: (c: TrainingConfig) => void;
}) {
  const fields: Array<{
    label: string;
    key: keyof TrainingConfig;
    type: "text" | "number";
    step?: number;
  }> = [
    { label: "Trigger word", key: "triggerWord", type: "text" },
    { label: "Training steps", key: "steps", type: "number", step: 100 },
    { label: "Learning rate", key: "learningRate", type: "number", step: 0.0001 },
    { label: "LoRA rank", key: "loraRank", type: "number", step: 4 },
    { label: "Batch size", key: "batchSize", type: "number", step: 1 },
    { label: "Resolution", key: "resolution", type: "number", step: 64 },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {fields.map(({ label, key, type, step }) => (
        <div key={key}>
          <label className="mb-1 block text-xs text-zinc-400">{label}</label>
          <input
            type={type}
            value={config[key]}
            step={step}
            onChange={(e) =>
              onChange({
                ...config,
                [key]: type === "number" ? Number(e.target.value) : e.target.value,
              })
            }
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Training log panel
// ─────────────────────────────────────────────────────────────────

function TrainingLog({
  logs,
  progressPct,
  status,
}: {
  logs: string | null;
  progressPct: number | null;
  status: string;
}) {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="mt-4 rounded-lg border border-zinc-700 bg-zinc-950">
      {progressPct !== null && (
        <div className="border-b border-zinc-800 px-4 py-2">
          <div className="mb-1 flex justify-between text-xs text-zinc-500">
            <span>{status === "processing" ? "Training…" : status}</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-amber-600 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}
      <div
        ref={logRef}
        className="h-56 overflow-y-auto p-3 font-mono text-[10px] leading-relaxed text-zinc-400"
      >
        {logs ? (
          logs
            .split("\n")
            .slice(-200)
            .map((line, i) => (
              <div
                key={i}
                className={
                  /error/i.test(line) ? "text-red-400" : ""
                }
              >
                {line}
              </div>
            ))
        ) : (
          <span className="text-zinc-600">Waiting for logs…</span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 15_000;

export default function TrainPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;

  // Caption state
  const [images, setImages] = useState<CaptionImage[]>([]);
  const [captioningStarted, setCaptioningStarted] = useState(false);
  const [captioningError, setCaptioningError] = useState<string | null>(null);

  // Phase
  const [phase, setPhase] = useState<Phase>("captioning");

  // Package state
  const [packaging, setPackaging] = useState(false);
  const [packageResult, setPackageResult] = useState<{
    zipUrl: string;
    imageCount: number;
    sizeBytes: number;
  } | null>(null);
  const [packageError, setPackageError] = useState<string | null>(null);

  // Training state
  const [config, setConfig] = useState<TrainingConfig>(DEFAULT_CONFIG);
  const [startingTraining, setStartingTraining] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [trainingId, setTrainingId] = useState<string | null>(null);
  const [trainingStatus, setTrainingStatus] = useState<string>("idle");
  const [trainingLogs, setTrainingLogs] = useState<string | null>(null);
  const [trainingProgress, setTrainingProgress] = useState<number | null>(null);
  const [loraOutputUrl, setLoraOutputUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load images ────────────────────────────────────────────────

  const loadImages = useCallback(async (): Promise<CaptionImage[]> => {
    const res = await fetch(`/api/lora-studio/${sessionId}/caption-images`);
    if (!res.ok) return [];
    const data = await res.json();
    const imgs: CaptionImage[] = (data.images ?? []).map((img: any) => ({
      ...img,
      signedUrl: data.signedUrls?.[img.id],
    }));
    setImages(imgs);
    return imgs;
  }, [sessionId]);

  // ── Run captioning for uncaptioned images ─────────────────────

  const runCaptioning = useCallback(
    async (imgs: CaptionImage[]) => {
      const uncaptioned = imgs.filter((i) => !i.caption);
      if (uncaptioned.length === 0) {
        setPhase("reviewing");
        return;
      }

      setCaptioningStarted(true);
      setCaptioningError(null);

      const res = await fetch(`/api/lora-studio/${sessionId}/caption-images`, {
        method: "POST",
      });

      if (!res.ok) {
        setCaptioningError("Captioning failed. Please refresh and try again.");
        return;
      }

      const data = await res.json();
      const captionMap = new Map<string, string>(
        (data.results ?? []).map((r: { id: string; caption: string }) => [r.id, r.caption]),
      );

      setImages((prev) =>
        prev.map((img) => {
          const c = captionMap.get(img.id);
          return c ? { ...img, caption: c } : img;
        }),
      );

      setPhase("reviewing");
    },
    [sessionId],
  );

  // ── Mount: load images, check training status, start captioning ─

  useEffect(() => {
    let cancelled = false;

    // Check if training is already in progress / complete
    fetch(`/api/lora-studio/${sessionId}/training-status`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.status === "succeeded" && data.loraOutputUrl) {
          setLoraOutputUrl(data.loraOutputUrl);
          setTrainingStatus("succeeded");
          setTrainingLogs(data.logs ?? null);
          setPhase("complete");
        } else if (data.status === "starting" || data.status === "processing") {
          setTrainingStatus(data.status);
          setTrainingLogs(data.logs ?? null);
          setTrainingProgress(data.progressPct ?? null);
          setPhase("training");
        }
      })
      .catch(() => {});

    // Load images and start captioning
    loadImages().then((imgs) => {
      if (!cancelled) runCaptioning(imgs);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // ── Caption edits ──────────────────────────────────────────────

  const handleCaptionChange = useCallback(
    async (imageId: string, caption: string) => {
      setImages((prev) =>
        prev.map((img) => (img.id === imageId ? { ...img, caption } : img)),
      );
      await fetch(`/api/lora-studio/${sessionId}/caption-images`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId, caption }),
      });
    },
    [sessionId],
  );

  // ── Package dataset ────────────────────────────────────────────

  const handlePackage = useCallback(async () => {
    setPackaging(true);
    setPackageError(null);

    const res = await fetch(`/api/lora-studio/${sessionId}/package-dataset`, {
      method: "POST",
    });
    const data = await res.json();

    if (!res.ok) {
      setPackageError(data.error ?? "Packaging failed");
      setPackaging(false);
      return;
    }

    setPackageResult(data);
    setPackaging(false);
    setPhase("configuring");
  }, [sessionId]);

  // ── Start training ─────────────────────────────────────────────

  const handleStartTraining = useCallback(async () => {
    setStartingTraining(true);
    setStartError(null);

    const res = await fetch(`/api/lora-studio/${sessionId}/start-training`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const data = await res.json();

    if (!res.ok) {
      setStartError(data.error ?? "Failed to start training");
      setStartingTraining(false);
      return;
    }

    setTrainingId(data.trainingId);
    setTrainingStatus("starting");
    setStartingTraining(false);
    setPhase("training");
  }, [sessionId, config]);

  // ── Poll training status ───────────────────────────────────────

  const pollTraining = useCallback(async () => {
    const res = await fetch(`/api/lora-studio/${sessionId}/training-status`);
    if (!res.ok) return;
    const data = await res.json();

    setTrainingStatus(data.status ?? "unknown");
    setTrainingLogs(data.logs ?? null);
    setTrainingProgress(data.progressPct ?? null);

    if (data.loraOutputUrl) {
      setLoraOutputUrl(data.loraOutputUrl);
      setPhase("complete");
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
  }, [sessionId]);

  useEffect(() => {
    if (phase === "training") {
      pollRef.current = setInterval(pollTraining, POLL_INTERVAL_MS);
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [phase, pollTraining]);

  // ── Helpers ────────────────────────────────────────────────────

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const allCaptioned = images.length > 0 && images.every((i) => !!i.caption);
  const captionedCount = images.filter((i) => !!i.caption).length;

  const registrySnippet = `  {
    name: '${sessionId?.slice(0, 8) ?? "custom"} Custom Body',
    filename: 'nsw-curves-body.safetensors',
    category: 'bodies' as const,
    defaultStrength: 0.8,
    clipStrength: 0.8,
    triggerWord: '${config.triggerWord}',
    description: 'Trained NSW LoRA Studio body LoRA — curvy proportions for Black women',
    compatibleWith: ['sfw', 'nsfw'] as const,
    installed: false,
    genderCategory: 'female' as const,
  },`;

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Captioning & Training</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Auto-caption approved images with Claude Vision, package the dataset, then train on
          Replicate.
        </p>
      </div>

      {/* Stage chips */}
      <div className="mb-8 flex flex-wrap items-center gap-2">
        <StageChip
          label="Caption"
          active={phase === "captioning" || phase === "reviewing"}
          done={!["captioning", "reviewing"].includes(phase)}
        />
        <ChevronRight className="h-3.5 w-3.5 text-zinc-700" />
        <StageChip
          label="Package"
          active={phase === "packaging"}
          done={["configuring", "training", "complete"].includes(phase)}
        />
        <ChevronRight className="h-3.5 w-3.5 text-zinc-700" />
        <StageChip
          label="Train"
          active={phase === "configuring" || phase === "training"}
          done={phase === "complete"}
        />
      </div>

      {/* ── Sub-stage 1: Caption ── */}
      {(phase === "captioning" || phase === "reviewing") && (
        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              {phase === "captioning" && !captioningStarted ? (
                <p className="flex items-center gap-2 text-sm text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                  Loading images…
                </p>
              ) : phase === "captioning" ? (
                <p className="flex items-center gap-2 text-sm text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                  Captioning {captionedCount} / {images.length} images…
                </p>
              ) : (
                <p className="text-sm text-zinc-400">
                  <span className="text-emerald-400">{captionedCount}</span> of{" "}
                  <span className="text-zinc-200">{images.length}</span> images captioned.
                  Review and edit, then approve.
                </p>
              )}
              {captioningError && (
                <p className="mt-1 flex items-center gap-1 text-xs text-red-400">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {captioningError}
                </p>
              )}
            </div>
            {phase === "reviewing" && (
              <button
                onClick={() => setPhase("packaging")}
                disabled={!allCaptioned}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-amber-100 hover:bg-amber-600 disabled:pointer-events-none disabled:opacity-40"
              >
                <CheckCircle2 className="h-4 w-4" />
                Approve all captions
              </button>
            )}
          </div>

          {/* Progress bar during captioning */}
          {phase === "captioning" && captioningStarted && images.length > 0 && (
            <div className="mb-6">
              <div className="mb-1 flex justify-between text-xs text-zinc-500">
                <span>Captioning…</span>
                <span>
                  {captionedCount} / {images.length}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-amber-600 transition-all duration-500"
                  style={{
                    width:
                      images.length > 0
                        ? `${(captionedCount / images.length) * 100}%`
                        : "0%",
                  }}
                />
              </div>
            </div>
          )}

          {/* Image grid */}
          {images.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {images.map((img) => (
                <CaptionCard
                  key={img.id}
                  image={img}
                  onCaptionChange={handleCaptionChange}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Sub-stage 2: Package ── */}
      {["packaging", "configuring", "training", "complete"].includes(phase) && (
        <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
          <div className="mb-4 flex items-center gap-2">
            <Package className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-zinc-200">Package Dataset</h2>
            {packageResult && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
          </div>

          {!packageResult ? (
            <>
              <p className="mb-4 text-sm text-zinc-400">
                <span className="font-medium text-zinc-200">{captionedCount} images</span> with
                captions ready. Creates a ZIP in Kohya format and uploads to Supabase Storage.
              </p>
              {packageError && (
                <p className="mb-3 flex items-center gap-1 text-xs text-red-400">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {packageError}
                </p>
              )}
              <button
                onClick={handlePackage}
                disabled={packaging}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-amber-100 hover:bg-amber-600 disabled:opacity-60"
              >
                {packaging ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Packaging…
                  </>
                ) : (
                  <>
                    <Package className="h-4 w-4" />
                    Package & Upload Dataset
                  </>
                )}
              </button>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-6">
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: "Images", value: String(packageResult.imageCount) },
                  { label: "ZIP size", value: fmtBytes(packageResult.sizeBytes) },
                  {
                    label: "Est. time",
                    value: `~${Math.ceil((config.steps / 1000) * 20)}m`,
                  },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-center"
                  >
                    <p className="text-base font-bold text-zinc-100">{value}</p>
                    <p className="text-[10px] text-zinc-500">{label}</p>
                  </div>
                ))}
              </div>
              <a
                href={packageResult.zipUrl}
                download
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700"
              >
                <Download className="h-3.5 w-3.5" />
                Download Dataset ZIP
              </a>
            </div>
          )}
        </section>
      )}

      {/* ── Sub-stage 3: Training config + trigger ── */}
      {["configuring", "training", "complete"].includes(phase) && (
        <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
          <div className="mb-4 flex items-center gap-2">
            <Cpu className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-zinc-200">Training Configuration</h2>
            {["training", "complete"].includes(phase) && (
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            )}
          </div>

          {phase === "configuring" && (
            <>
              <div className="mb-6">
                <TrainingConfigForm config={config} onChange={setConfig} />
              </div>
              {startError && (
                <p className="mb-3 flex items-center gap-1 text-xs text-red-400">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {startError}
                </p>
              )}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleStartTraining}
                  disabled={startingTraining}
                  className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-5 py-2.5 text-sm font-medium text-amber-100 hover:bg-amber-600 disabled:opacity-60"
                >
                  {startingTraining ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Starting…
                    </>
                  ) : (
                    <>
                      <Cpu className="h-4 w-4" />
                      Start Training
                    </>
                  )}
                </button>
                <p className="text-xs text-zinc-600">
                  Uses{" "}
                  <code className="text-zinc-500">ostris/flux-dev-lora-trainer</code> on Replicate
                </p>
              </div>
            </>
          )}

          {["training", "complete"].includes(phase) && trainingId && (
            <div className="space-y-0.5 text-xs text-zinc-500">
              <p>
                Training ID:{" "}
                <span className="font-mono text-zinc-300">{trainingId}</span>
              </p>
              <p>
                Trigger:{" "}
                <span className="font-mono text-zinc-300">{config.triggerWord}</span>
                {" · "}Steps:{" "}
                <span className="text-zinc-300">{config.steps}</span>
                {" · "}LR:{" "}
                <span className="text-zinc-300">{config.learningRate}</span>
                {" · "}Rank:{" "}
                <span className="text-zinc-300">{config.loraRank}</span>
              </p>
            </div>
          )}
        </section>
      )}

      {/* ── Training monitor ── */}
      {phase === "training" && (
        <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
              <h2 className="text-sm font-semibold text-zinc-200">Training in progress</h2>
              <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
                {trainingStatus}
              </span>
            </div>
            <p className="text-xs text-zinc-600">Polling every 15s</p>
          </div>
          <TrainingLog logs={trainingLogs} progressPct={trainingProgress} status={trainingStatus} />
        </section>
      )}

      {/* ── Complete ── */}
      {phase === "complete" && (
        <section className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-6">
          <div className="mb-4 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            <h2 className="text-base font-semibold text-emerald-300">
              Training complete! Your LoRA is ready.
            </h2>
          </div>

          {loraOutputUrl && (
            <div className="space-y-4">
              {/* Output URL */}
              <div>
                <p className="mb-1 text-xs text-zinc-500">LoRA weights URL</p>
                <div className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2">
                  <span className="flex-1 truncate font-mono text-xs text-zinc-300">
                    {loraOutputUrl}
                  </span>
                  <button
                    onClick={() => handleCopy(loraOutputUrl)}
                    className="shrink-0 rounded p-1 text-zinc-500 hover:text-zinc-200"
                    title="Copy URL"
                  >
                    {copied ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <a
                    href={loraOutputUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 rounded p-1 text-zinc-500 hover:text-zinc-200"
                    title="Open"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2">
                <a
                  href={loraOutputUrl}
                  download="nsw-curves-body.safetensors"
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-700"
                >
                  <Download className="h-4 w-4" />
                  Download LoRA
                </a>
              </div>

              {/* Add to LoRA Registry */}
              <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-amber-400" />
                    <h3 className="text-sm font-medium text-zinc-200">Add to LoRA Registry</h3>
                  </div>
                  <button
                    onClick={() => handleCopy(registrySnippet)}
                    className="inline-flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                  >
                    <Copy className="h-3 w-3" />
                    Copy snippet
                  </button>
                </div>
                <p className="mb-2 text-xs text-zinc-500">
                  Add this entry inside{" "}
                  <code className="text-zinc-400">KONTEXT_LORA_REGISTRY</code> in{" "}
                  <code className="text-zinc-400">
                    packages/image-gen/src/lora-registry.ts
                  </code>
                  , then place <code className="text-zinc-400">nsw-curves-body.safetensors</code>{" "}
                  in your RunPod loras folder.
                </p>
                <pre className="overflow-x-auto rounded bg-zinc-950 p-3 text-[10px] leading-relaxed text-zinc-400">
                  {registrySnippet}
                </pre>
              </div>

              {/* Training logs */}
              {trainingLogs && (
                <details className="rounded-lg border border-zinc-800">
                  <summary className="cursor-pointer px-3 py-2 text-xs text-zinc-500 hover:text-zinc-300">
                    View training logs
                  </summary>
                  <TrainingLog logs={trainingLogs} progressPct={100} status="succeeded" />
                </details>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
