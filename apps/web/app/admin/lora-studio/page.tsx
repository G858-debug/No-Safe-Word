"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Loader2, ChevronRight, CheckCircle2, Cpu } from "lucide-react";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface Session {
  id: string;
  name: string;
  status: string;
  target_approved_count: number;
  created_at: string;
  lora_output_url: string | null;
  replicate_training_id: string | null;
}

// ─────────────────────────────────────────────────────────────────
// Status helpers
// ─────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  anime_generation: "Generating",
  anime_approval: "Approving anime",
  flux_conversion: "Converting",
  flux_approval: "Approving converted",
  captioning: "Captioning",
  training: "Training",
  complete: "Complete",
};

const STATUS_COLORS: Record<string, string> = {
  anime_generation: "bg-zinc-800 text-zinc-400",
  anime_approval: "bg-amber-950/60 text-amber-400",
  flux_conversion: "bg-amber-950/60 text-amber-400",
  flux_approval: "bg-amber-950/60 text-amber-400",
  captioning: "bg-blue-950/60 text-blue-400",
  training: "bg-blue-950/60 text-blue-400",
  complete: "bg-emerald-950/60 text-emerald-400",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
        STATUS_COLORS[status] ?? "bg-zinc-800 text-zinc-500"
      }`}
    >
      {status === "training" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      {status === "complete" && <CheckCircle2 className="h-2.5 w-2.5" />}
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────

export default function LoraStudioPage() {
  const router = useRouter();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  // New session form
  const [name, setName] = useState("");
  const [targetCount, setTargetCount] = useState(100);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    const res = await fetch("/api/lora-studio/sessions");
    if (res.ok) {
      const data = await res.json();
      setSessions(data.sessions ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim()) return;
      setCreating(true);
      setCreateError(null);

      const res = await fetch("/api/lora-studio/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), targetCount }),
      });
      const data = await res.json();

      if (!res.ok) {
        setCreateError(data.error ?? "Failed to create session");
        setCreating(false);
        return;
      }

      router.push(`/admin/lora-studio/${data.session.id}/generate`);
    },
    [name, targetCount, router],
  );

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-ZA", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">LoRA Studio</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Train custom body LoRAs from generated image datasets.
        </p>
      </div>

      {/* New Session form */}
      <div className="mb-10 rounded-xl border border-zinc-700 bg-zinc-900/60 p-6">
        <div className="mb-4 flex items-center gap-2">
          <Plus className="h-4 w-4 text-amber-400" />
          <h2 className="text-sm font-semibold text-zinc-200">New Training Session</h2>
        </div>
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-48">
            <label className="mb-1 block text-xs text-zinc-400">Session name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Venus Body v1"
              required
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>
          <div className="w-32">
            <label className="mb-1 block text-xs text-zinc-400">Target images</label>
            <input
              type="number"
              value={targetCount}
              min={20}
              max={500}
              onChange={(e) => setTargetCount(Number(e.target.value))}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>
          <div>
            <button
              type="submit"
              disabled={creating || !name.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-amber-100 hover:bg-amber-600 disabled:opacity-50"
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Create & Start
                </>
              )}
            </button>
          </div>
        </form>
        {createError && (
          <p className="mt-2 text-xs text-red-400">{createError}</p>
        )}
      </div>

      {/* Sessions list */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-400">All Sessions</h2>
          <button
            onClick={loadSessions}
            className="text-xs text-zinc-600 hover:text-zinc-400"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-zinc-600">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-800 px-6 py-12 text-center text-sm text-zinc-600">
            No sessions yet. Create one above to get started.
          </div>
        ) : (
          <div className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
            {sessions.map((session) => (
              <Link
                key={session.id}
                href={`/admin/lora-studio/${session.id}`}
                className="group flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-zinc-900/60"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-zinc-200 group-hover:text-zinc-100">
                      {session.name}
                    </span>
                    <StatusBadge status={session.status} />
                  </div>
                  <p className="mt-0.5 font-mono text-[10px] text-zinc-600">
                    {session.id}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-4">
                  {session.status === "complete" && session.lora_output_url && (
                    <span className="flex items-center gap-1 text-xs text-emerald-500">
                      <Cpu className="h-3 w-3" />
                      LoRA ready
                    </span>
                  )}
                  <span className="text-xs text-zinc-600">{fmtDate(session.created_at)}</span>
                  <ChevronRight className="h-4 w-4 text-zinc-700 group-hover:text-zinc-400" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
