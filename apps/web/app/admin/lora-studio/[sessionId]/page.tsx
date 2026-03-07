"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  Loader2,
  ImagePlus,
  CheckSquare,
  RefreshCw,
  Cpu,
  Star,
  ChevronRight,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface SessionData {
  id: string;
  name: string;
  status: string;
  replicate_training_id: string | null;
  replicate_training_url: string | null;
  lora_output_url: string | null;
  dataset_zip_url: string | null;
  created_at: string;
}

interface Counts {
  animeTotal: number;
  animeReady: number;
  animeApproved: number;
  convertedTotal: number;
  convertedReady: number;
  convertedApproved: number;
  finalApproved: number;
  captioned: number;
}

// ─────────────────────────────────────────────────────────────────
// Pipeline config
// ─────────────────────────────────────────────────────────────────

const PIPELINE_STATUSES = [
  "anime_generation",
  "anime_approval",
  "flux_conversion",
  "flux_approval",
  "captioning",
  "training",
  "complete",
] as const;

type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

function getStepIndex(status: string): number {
  return PIPELINE_STATUSES.indexOf(status as PipelineStatus);
}

// ─────────────────────────────────────────────────────────────────
// Step card
// ─────────────────────────────────────────────────────────────────

function StepCard({
  icon: Icon,
  label,
  href,
  state,
  stat,
  statLabel,
}: {
  icon: React.ElementType;
  label: string;
  href: string;
  state: "done" | "active" | "pending";
  stat?: string | number;
  statLabel?: string;
}) {
  const border =
    state === "active"
      ? "border-amber-700"
      : state === "done"
      ? "border-zinc-700"
      : "border-zinc-800";

  const bg =
    state === "active"
      ? "bg-amber-950/20"
      : state === "done"
      ? "bg-zinc-900/60"
      : "bg-zinc-900/30";

  return (
    <Link
      href={href}
      className={`group flex flex-col gap-3 rounded-xl border p-4 transition-colors hover:border-zinc-600 ${border} ${bg}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Icon
            className={`h-4 w-4 ${
              state === "active"
                ? "text-amber-400"
                : state === "done"
                ? "text-emerald-500"
                : "text-zinc-600"
            }`}
          />
          <span
            className={`text-sm font-medium ${
              state === "active"
                ? "text-amber-200"
                : state === "done"
                ? "text-zinc-300"
                : "text-zinc-600"
            }`}
          >
            {label}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {state === "done" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
          {state === "active" && <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />}
          {state === "pending" && <Clock className="h-3.5 w-3.5 text-zinc-700" />}
          <ChevronRight className="h-3.5 w-3.5 text-zinc-700 transition-colors group-hover:text-zinc-400" />
        </div>
      </div>

      {stat !== undefined && (
        <div>
          <p
            className={`text-xl font-bold tabular-nums ${
              state === "active"
                ? "text-amber-300"
                : state === "done"
                ? "text-zinc-100"
                : "text-zinc-600"
            }`}
          >
            {stat}
          </p>
          {statLabel && <p className="text-[10px] text-zinc-600">{statLabel}</p>}
        </div>
      )}
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────

export default function SessionOverviewPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;

  const [session, setSession] = useState<SessionData | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/lora-studio/${sessionId}/session-overview`);
    if (!res.ok) {
      setError("Failed to load session");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setSession(data.session);
    setCounts(data.counts);
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-zinc-500">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="rounded-lg border border-red-900/40 bg-red-950/20 px-4 py-3 text-sm text-red-400">
        {error ?? "Session not found"}
      </div>
    );
  }

  const base = `/admin/lora-studio/${sessionId}`;
  const currentIdx = getStepIndex(session.status);

  function stepState(stepStatus: PipelineStatus): "done" | "active" | "pending" {
    const stepIdx = getStepIndex(stepStatus);
    if (stepIdx < currentIdx) return "done";
    if (stepIdx === currentIdx) return "active";
    return "pending";
  }

  const steps: Array<{
    status: PipelineStatus;
    label: string;
    href: string;
    icon: React.ElementType;
    stat?: string | number;
    statLabel?: string;
  }> = [
    {
      status: "anime_generation",
      label: "Generate Anime",
      href: `${base}/generate`,
      icon: ImagePlus,
      stat: counts?.animeTotal ?? 0,
      statLabel: `${counts?.animeReady ?? 0} ready`,
    },
    {
      status: "anime_approval",
      label: "Approve Anime",
      href: `${base}/approve-anime`,
      icon: CheckSquare,
      stat: counts?.animeApproved ?? 0,
      statLabel: `of ${counts?.animeReady ?? 0} ready`,
    },
    {
      status: "flux_conversion",
      label: "Convert to Photorealistic",
      href: `${base}/convert`,
      icon: RefreshCw,
      stat: counts?.convertedTotal ?? 0,
      statLabel: `${counts?.convertedReady ?? 0} ready`,
    },
    {
      status: "flux_approval",
      label: "Approve Converted",
      href: `${base}/approve-converted`,
      icon: CheckSquare,
      stat: counts?.finalApproved ?? 0,
      statLabel: "final approved",
    },
    {
      status: "captioning",
      label: "Caption & Package",
      href: `${base}/train`,
      icon: Cpu,
      stat: counts?.captioned ?? 0,
      statLabel: "captioned",
    },
    {
      status: "training",
      label: "Training on Replicate",
      href: `${base}/train`,
      icon: Cpu,
      stat: session.replicate_training_id ? "Running" : "—",
      statLabel: session.replicate_training_id ? "on Replicate" : undefined,
    },
    {
      status: "complete",
      label: "Complete",
      href: `${base}/train`,
      icon: Star,
      stat: session.lora_output_url ? "Done" : "—",
      statLabel: session.lora_output_url ? "LoRA ready" : undefined,
    },
  ];

  const createdAt = new Date(session.created_at).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{session.name}</h1>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{sessionId}</p>
        <p className="mt-0.5 text-xs text-zinc-600">Created {createdAt}</p>
      </div>

      {/* Status badge */}
      <div className="mb-8 flex items-center gap-2">
        <span className="text-xs text-zinc-500">Pipeline status:</span>
        <span className="rounded-full bg-amber-950/50 px-3 py-0.5 text-xs font-medium text-amber-300 ring-1 ring-amber-800">
          {session.status.replace(/_/g, " ")}
        </span>
        <button
          onClick={load}
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
        >
          Refresh
        </button>
      </div>

      {/* Pipeline stepper grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {steps.map((step) => (
          <StepCard
            key={step.status}
            icon={step.icon}
            label={step.label}
            href={step.href}
            state={stepState(step.status)}
            stat={step.stat}
            statLabel={step.statLabel}
          />
        ))}
      </div>

      {/* LoRA output if complete */}
      {session.lora_output_url && (
        <div className="mt-8 rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-4">
          <p className="mb-1 text-xs font-medium text-emerald-400">LoRA ready</p>
          <a
            href={session.lora_output_url}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all font-mono text-xs text-zinc-400 underline hover:text-zinc-200"
          >
            {session.lora_output_url}
          </a>
        </div>
      )}
    </div>
  );
}
