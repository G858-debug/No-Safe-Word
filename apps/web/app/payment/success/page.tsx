"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function SuccessContent() {
  const searchParams = useSearchParams();
  const isSubscription = searchParams.get("type") === "subscription";

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md text-center">
        <h1
          className="text-3xl font-bold text-amber-50 sm:text-4xl"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {isSubscription ? "Welcome to the Inner Circle" : "Story Unlocked"}
        </h1>
        <p className="mt-4 text-warm-300">
          {isSubscription
            ? "You now have full access to every story. Enjoy."
            : "Your story is ready. Nothing held back."}
        </p>
        <Link
          href="/stories"
          className="mt-8 inline-block rounded-lg bg-amber-700 px-6 py-3 text-sm font-semibold text-amber-50 transition-colors hover:bg-amber-600"
        >
          Browse Stories
        </Link>
      </div>
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-warm-400">Loading...</p>
        </div>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}
