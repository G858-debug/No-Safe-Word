"use client";

import { useCallback, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface CodeEntryProps {
  email: string;
  /** Where to send the user once their session is established. */
  postAuthPath: string;
}

/**
 * Four single-character inputs for a 4-digit code. Auto-advances on
 * input, accepts paste, and submits to /api/auth/verify-code on the
 * fourth keystroke.
 *
 * On success: calls supabase.auth.verifyOtp({ token_hash, type:
 * "magiclink" }) — same path as the existing /access flow — and
 * navigates to `postAuthPath`.
 */
export default function CodeEntry({ email, postAuthPath }: CodeEntryProps) {
  const [digits, setDigits] = useState(["", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  const submit = useCallback(
    async (code: string) => {
      setError(null);
      setLoading(true);
      try {
        const res = await fetch("/api/auth/verify-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, code }),
        });
        const data = await res.json();

        if (!data.success) {
          setError(data.error ?? "Incorrect code.");
          setDigits(["", "", "", ""]);
          inputs[0].current?.focus();
          return;
        }

        const supabase = createClient();
        const { error: otpError } = await supabase.auth.verifyOtp({
          token_hash: data.token_hash,
          type: "magiclink",
        });
        if (otpError) {
          console.error("[code-entry] verifyOtp failed:", otpError);
          setError("Couldn't establish session. Try the email link instead.");
          return;
        }

        const slug = data.story_slug || "";
        const chapter = data.chapter || 1;
        const target =
          postAuthPath || (slug ? `/stories/${slug}/${chapter}` : "/");
        window.location.href = target;
      } catch {
        setError("Network error. Check your connection and try again.");
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [email, postAuthPath]
  );

  function handleChange(idx: number, value: string) {
    if (!/^\d?$/.test(value)) return;
    const next = [...digits];
    next[idx] = value;
    setDigits(next);
    setError(null);
    if (value && idx < 3) inputs[idx + 1].current?.focus();
    if (value && idx === 3 && next.every((d) => d)) submit(next.join(""));
  }

  function handleKeyDown(idx: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !digits[idx] && idx > 0) {
      inputs[idx - 1].current?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4);
    if (pasted.length !== 4) return;
    e.preventDefault();
    setDigits(pasted.split(""));
    inputs[3].current?.focus();
    submit(pasted);
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-center gap-3">
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={inputs[i]}
            type="text"
            inputMode="numeric"
            maxLength={1}
            autoComplete="one-time-code"
            value={digit}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
            disabled={loading}
            aria-label={`Digit ${i + 1}`}
            className="h-14 w-12 rounded-lg border border-amber-500/60 bg-amber-900/30 text-center text-2xl font-bold text-amber-50 outline-none transition-colors focus:border-amber-400 focus:bg-amber-900/50 disabled:opacity-50"
          />
        ))}
      </div>
      {error && (
        <p role="alert" className="text-center text-sm text-rose-300">
          {error}
        </p>
      )}
      {loading && (
        <p className="text-center text-sm text-warm-400">Verifying…</p>
      )}
    </div>
  );
}
