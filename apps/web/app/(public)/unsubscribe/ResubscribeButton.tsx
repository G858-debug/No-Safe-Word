"use client";

import { useState } from "react";

export default function ResubscribeButton({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">(
    "idle"
  );

  async function resubscribe() {
    setState("loading");
    try {
      const res = await fetch(`/api/resubscribe?token=${encodeURIComponent(token)}`, {
        method: "POST",
      });
      const data = await res.json();
      setState(data.success ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <p className="text-sm text-amber-200">
        You&apos;re back on the list. Welcome back. 🤍
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={resubscribe}
        disabled={state === "loading"}
        className="rounded-lg border border-amber-500/60 bg-amber-700/40 px-5 py-2 text-sm font-medium text-amber-50 transition-colors hover:bg-amber-700/55 disabled:opacity-60"
      >
        {state === "loading" ? "Resubscribing…" : "Resubscribe"}
      </button>
      {state === "error" && (
        <p className="text-xs text-rose-300">
          That didn&apos;t work — try again, or email us.
        </p>
      )}
    </>
  );
}
