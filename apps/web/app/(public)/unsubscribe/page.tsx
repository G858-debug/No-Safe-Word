import type { Metadata } from "next";
import Link from "next/link";
import { supabase as serviceClient } from "@no-safe-word/story-engine";
import { verifyUnsubscribeToken } from "@/lib/server/unsubscribe-token";
import { logEvent } from "@/lib/server/events";
import ResubscribeButton from "./ResubscribeButton";

export const metadata: Metadata = {
  title: "Unsubscribed",
  description: "Manage your email and WhatsApp subscriptions.",
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

// Server-rendered: the unsubscribe action is performed at render time
// rather than from a client useEffect, so revisiting the link is
// idempotent and screen readers see the confirmation immediately.
export default async function UnsubscribePage({ searchParams }: PageProps) {
  const { token } = await searchParams;

  if (!token) {
    return <BadLinkMessage reason="missing" />;
  }

  const email = verifyUnsubscribeToken(token);
  if (!email) {
    return <BadLinkMessage reason="invalid" />;
  }

  const { error } = await serviceClient
    .from("subscribers")
    .update({
      email_marketing_consent: false,
      whatsapp_marketing_consent: false,
      unsubscribed_at: new Date().toISOString(),
    })
    .eq("email", email);

  if (error) {
    console.error("[/unsubscribe] update failed:", error);
    return <BadLinkMessage reason="server" />;
  }

  await logEvent({
    eventType: "marketing.unsubscribed",
    metadata: {
      email_domain: email.split("@")[1] ?? "unknown",
      source: "page_visit",
    },
  });

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 sm:py-24">
      <h1
        className="text-3xl font-bold text-amber-50 sm:text-4xl"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        You&apos;ve been unsubscribed.
      </h1>
      <p className="mt-4 text-base text-warm-200">
        We won&apos;t send any more marketing emails or WhatsApp messages
        to <span className="text-amber-200">{email}</span>.
      </p>
      <p className="mt-2 text-sm text-warm-400">
        Transactional messages — like login codes you actively request —
        are not affected.
      </p>

      <div className="mt-10 flex flex-col items-center gap-3">
        <ResubscribeButton token={token} />
        <Link
          href="/"
          className="text-sm text-amber-500 transition-colors hover:text-amber-400"
        >
          Back to nosafeword.co.za
        </Link>
      </div>
    </div>
  );
}

function BadLinkMessage({ reason }: { reason: "missing" | "invalid" | "server" }) {
  const headline =
    reason === "server"
      ? "Something went wrong"
      : "This unsubscribe link isn't valid";
  const body =
    reason === "missing"
      ? "The link you followed didn't include a token. Try clicking the link in your email again."
      : reason === "invalid"
        ? "The token didn't match our records. Email links expire if the secret rotates — request a fresh one or email us directly."
        : "We couldn't update your preferences right now. Please try again in a moment.";
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 sm:py-24">
      <h1
        className="text-3xl font-bold text-amber-50 sm:text-4xl"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {headline}
      </h1>
      <p className="mt-4 text-base text-warm-200">{body}</p>
      <p className="mt-6 text-sm text-warm-400">
        Need to unsubscribe manually? Email{" "}
        <a
          href="mailto:ntsiki@nosafeword.co.za"
          className="text-amber-500 transition-colors hover:text-amber-400"
        >
          ntsiki@nosafeword.co.za
        </a>
        .
      </p>
    </div>
  );
}
