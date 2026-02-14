"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import { createClient } from "@/lib/supabase/client";

export default function SubscriptionPage() {
  const { nswUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSub, setActiveSub] = useState<{
    status: string;
    starts_at: string;
    ends_at: string | null;
  } | null>(null);
  const [checkingSubscription, setCheckingSubscription] = useState(true);

  useEffect(() => {
    if (!nswUser) {
      setCheckingSubscription(false);
      return;
    }

    const supabase = createClient();
    supabase
      .from("nsw_subscriptions")
      .select("status, starts_at, ends_at")
      .eq("user_id", nswUser.id)
      .eq("status", "active")
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) setActiveSub(data);
        setCheckingSubscription(false);
      });
  }, [nswUser]);

  async function handleSubscribe() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/payfast/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || "Subscription failed");
      }

      const form = document.createElement("form");
      form.method = "POST";
      form.action = json.actionUrl;

      for (const [key, value] of Object.entries(json.data)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = key;
        input.value = value as string;
        form.appendChild(input);
      }

      document.body.appendChild(form);
      form.submit();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div>
      <h1
        className="mb-6 text-2xl font-bold text-amber-50"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Subscription
      </h1>

      {checkingSubscription ? (
        <div className="rounded-xl border border-amber-900/20 bg-[#111111] px-6 py-12 text-center">
          <p className="text-warm-400">Loading...</p>
        </div>
      ) : activeSub ? (
        /* Active subscription status */
        <div className="rounded-xl border border-amber-900/20 bg-[#111111] px-6 py-10 text-center">
          <h3
            className="text-xl font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Nontsikelelo&apos;s Inner Circle
          </h3>
          <p className="mt-2 text-sm text-warm-300">
            Your subscription is <span className="font-semibold text-amber-400">active</span>
          </p>
          <div className="mx-auto mt-6 max-w-xs space-y-2 text-left text-sm text-warm-300">
            <p>
              <span className="text-warm-500">Started:</span>{" "}
              {new Date(activeSub.starts_at).toLocaleDateString("en-ZA", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
            {activeSub.ends_at && (
              <p>
                <span className="text-warm-500">Renews:</span>{" "}
                {new Date(activeSub.ends_at).toLocaleDateString("en-ZA", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            )}
          </div>
          <p className="mt-6 text-xs text-warm-500">
            You have full access to every story.
          </p>
        </div>
      ) : (
        /* No active subscription — show pricing card */
        <div className="rounded-xl border border-amber-900/20 bg-[#111111] px-6 py-10 text-center">
          <p className="text-sm text-warm-400">No active subscription</p>

          <div className="mx-auto mt-8 max-w-sm rounded-lg border border-amber-900/30 bg-[#0a0a0a] p-6">
            <h3
              className="text-xl font-bold text-amber-50"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              Nontsikelelo&apos;s Inner Circle
            </h3>
            <p className="mt-1 text-sm text-warm-400">
              The stories your timeline can&apos;t show you.
            </p>
            <p className="mt-4 text-warm-300">
              <span className="text-3xl font-bold text-amber-50">R55</span>
              <span className="text-warm-400">/mo</span>
            </p>
            <p className="mt-1 text-xs text-warm-500">
              Founding member price — locked forever
            </p>
            <ul className="mt-6 space-y-2 text-left text-sm text-warm-200">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-amber-600">&#10003;</span>
                Every story, every scene, nothing held back
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-amber-600">&#10003;</span>
                New stories before anyone on Facebook
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-amber-600">&#10003;</span>
                Vote on what gets written next
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-amber-600">&#10003;</span>
                The uncut versions your timeline will never see
              </li>
            </ul>
            <button
              onClick={handleSubscribe}
              disabled={loading}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-amber-700 px-6 py-3 text-sm font-semibold text-amber-50 transition-colors hover:bg-amber-600 disabled:opacity-60"
            >
              {loading && <Spinner />}
              Subscribe — R55/month
            </button>
            <p className="mt-3 text-xs text-warm-500">
              First 100 members lock in R55/mo. Price goes to R79 after.
            </p>

            {error && (
              <p className="mt-3 text-sm text-red-400">{error}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
