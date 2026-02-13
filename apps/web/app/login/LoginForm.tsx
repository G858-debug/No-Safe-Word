"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">(
    "idle"
  );
  const [errorMsg, setErrorMsg] = useState("");
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus("loading");
    setErrorMsg("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
    } else {
      setStatus("sent");
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header — simplified for login */}
      <header className="border-b border-amber-900/30 bg-[#0a0a0a]/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center px-4 py-4 sm:px-6">
          <Link href="/" className="group">
            <h1
              className="text-xl font-bold tracking-tight text-amber-50 transition-colors group-hover:text-amber-300 sm:text-2xl"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              No Safe Word
            </h1>
          </Link>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-sm">
          <div className="text-center">
            <h2
              className="text-2xl font-bold text-amber-50 sm:text-3xl"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              {status === "sent" ? "Check your email" : "Sign in"}
            </h2>
            <p className="mt-3 text-sm text-warm-300">
              {status === "sent"
                ? "We sent you a magic link. Click it to sign in."
                : "Enter your email and we\u2019ll send you a magic link."}
            </p>
          </div>

          {status === "sent" ? (
            <div className="mt-8 rounded-lg border border-amber-900/30 bg-amber-950/20 p-6 text-center">
              <p className="text-sm text-warm-200">
                Sent to{" "}
                <span className="font-medium text-amber-50">{email}</span>
              </p>
              <button
                onClick={() => {
                  setStatus("idle");
                  setEmail("");
                }}
                className="mt-4 text-sm text-amber-700 transition-colors hover:text-amber-500"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              <div>
                <label htmlFor="email" className="sr-only">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus
                  className="w-full rounded-lg border border-amber-900/30 bg-[#111111] px-4 py-3 text-amber-50 placeholder-warm-400 outline-none transition-colors focus:border-amber-700 focus:ring-1 focus:ring-amber-700"
                />
              </div>

              {status === "error" && (
                <p className="text-sm text-red-400">{errorMsg}</p>
              )}

              <button
                type="submit"
                disabled={status === "loading"}
                className="w-full rounded-lg bg-amber-700 px-4 py-3 text-sm font-semibold text-amber-50 transition-colors hover:bg-amber-600 disabled:opacity-50"
              >
                {status === "loading" ? "Sending..." : "Send magic link"}
              </button>
            </form>
          )}

          <p className="mt-8 text-center text-xs text-warm-400">
            No account? One will be created automatically.
          </p>
        </div>
      </main>
    </div>
  );
}
