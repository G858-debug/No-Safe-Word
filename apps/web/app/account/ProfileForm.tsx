"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ProfileForm({
  currentDisplayName,
  userId,
}: {
  currentDisplayName: string;
  userId: string;
}) {
  const [displayName, setDisplayName] = useState(currentDisplayName);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;

    setStatus("saving");

    const supabase = createClient();
    const { error } = await supabase
      .from("nsw_users")
      .update({ display_name: displayName.trim() || null })
      .eq("id", userId);

    if (error) {
      setStatus("error");
    } else {
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <div>
        <label
          htmlFor="displayName"
          className="block text-xs font-medium uppercase tracking-wider text-warm-400"
        >
          Display Name
        </label>
        <input
          id="displayName"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Choose a display name"
          className="mt-1 w-full max-w-sm rounded-lg border border-amber-900/30 bg-[#111111] px-4 py-2.5 text-amber-50 placeholder-warm-400 outline-none transition-colors focus:border-amber-700 focus:ring-1 focus:ring-amber-700"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={status === "saving"}
          className="rounded-lg bg-amber-700 px-5 py-2 text-sm font-semibold text-amber-50 transition-colors hover:bg-amber-600 disabled:opacity-50"
        >
          {status === "saving" ? "Saving..." : "Save"}
        </button>
        {status === "saved" && (
          <span className="text-sm text-green-400">Saved!</span>
        )}
        {status === "error" && (
          <span className="text-sm text-red-400">
            Failed to save. Please try again.
          </span>
        )}
      </div>
    </form>
  );
}
