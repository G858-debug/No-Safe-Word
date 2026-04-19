import type { Metadata } from "next";
import { Suspense } from "react";
import EnterFlow from "./EnterFlow";

export const metadata: Metadata = {
  title: "Sign in — No Safe Word",
  description:
    "Enter your WhatsApp number or email to keep reading No Safe Word.",
};

export default function EnterPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-8 sm:py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1
            className="text-2xl font-bold text-amber-50 sm:text-3xl"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Welcome back, love
          </h1>
          <p className="mt-3 text-sm text-warm-300">
            Pop in your WhatsApp or email — I&rsquo;ll send you a code to keep
            reading.
          </p>
        </div>

        <Suspense>
          <EnterFlow />
        </Suspense>
      </div>
    </div>
  );
}
