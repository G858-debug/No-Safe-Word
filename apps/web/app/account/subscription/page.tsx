"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";

export default function SubscriptionPage() {
  const { nswUser } = useAuth();
  const [toast, setToast] = useState<string | null>(null);

  // For now, no active subscriptions — show pricing card
  function showComingSoon() {
    setToast("Coming soon — subscriptions launching soon!");
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <div>
      <h1
        className="mb-6 text-2xl font-bold text-amber-50"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Subscription
      </h1>

      {/* No active subscription */}
      <div className="rounded-xl border border-amber-900/20 bg-[#111111] px-6 py-10 text-center">
        <p className="text-sm text-warm-400">No active subscription</p>

        <div className="mx-auto mt-8 max-w-sm rounded-lg border border-amber-900/30 bg-[#0a0a0a] p-6">
          <h3
            className="text-xl font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            All-Access Pass
          </h3>
          <p className="mt-2 text-warm-300">
            <span className="text-3xl font-bold text-amber-50">R55</span>
            <span className="text-warm-400">/month</span>
          </p>
          <ul className="mt-4 space-y-2 text-left text-sm text-warm-200">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-amber-600">&#10003;</span>
              Unlimited access to every story
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-amber-600">&#10003;</span>
              New stories added regularly
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-amber-600">&#10003;</span>
              Cancel anytime
            </li>
          </ul>
          <button
            onClick={showComingSoon}
            className="mt-6 w-full rounded-lg bg-amber-700 px-6 py-3 text-sm font-semibold text-amber-50 transition-colors hover:bg-amber-600"
          >
            Subscribe — R55/month
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-amber-900 px-5 py-3 text-sm font-medium text-amber-50 shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
