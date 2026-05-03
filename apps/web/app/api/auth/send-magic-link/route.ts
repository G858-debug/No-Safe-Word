import { NextRequest, NextResponse } from "next/server";
import { sendMagicLinkEmail } from "@/lib/server/magic-link-email";
import { take, clientIp } from "@/lib/server/rate-limit";
import { logEvent } from "@/lib/server/events";

/**
 * POST /api/auth/send-magic-link
 *
 * Public endpoint called by /login to send a magic-link email.
 *
 * Delivery goes through Resend (not Supabase SMTP) so we control the
 * template and can include a properly-signed unsubscribe link. The
 * link itself points at /auth/confirm which calls verifyOtp().
 */
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: { email?: unknown; next?: unknown; story_slug?: unknown; chapter?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { success: false, error: "Please enter a valid email address." },
      { status: 400 }
    );
  }

  // Rate limits — match request-access (5/hour per email, 3/10min per IP).
  const ip = clientIp(request);
  const ipCheck = take("send-magic-link:ip", ip, 3, 600);
  if (!ipCheck.ok) {
    return NextResponse.json(
      {
        success: false,
        error:
          "You've requested too many sign-in emails recently. Try again in a few minutes.",
        retry_after_seconds: ipCheck.retryAfterSeconds,
      },
      { status: 429 }
    );
  }
  const emailCheck = take("send-magic-link:email", email, 5, 3600);
  if (!emailCheck.ok) {
    return NextResponse.json(
      {
        success: false,
        error:
          "You've requested too many sign-in emails recently. Try again in a few minutes.",
        retry_after_seconds: emailCheck.retryAfterSeconds,
      },
      { status: 429 }
    );
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://nosafeword.co.za";

  // Resolve `next`: prefer the explicit `next` path, else the
  // story/chapter deep-link, else "/".
  let next = "/";
  if (typeof body.next === "string" && body.next.startsWith("/")) {
    next = body.next;
  } else if (typeof body.story_slug === "string" && body.story_slug.length) {
    const ch =
      typeof body.chapter === "number" && body.chapter > 0 ? body.chapter : 1;
    next = `/stories/${encodeURIComponent(body.story_slug)}/${ch}`;
  }

  const result = await sendMagicLinkEmail({ email, next, siteUrl });

  if (!result.ok) {
    console.error("[send-magic-link] delivery failed:", result.error);
    return NextResponse.json(
      {
        success: false,
        error:
          "We couldn't send your sign-in email. Please check the address and try again in a moment.",
      },
      { status: 500 }
    );
  }

  const [local, domain] = email.split("@");
  const masked = local.slice(0, 2) + "***@" + domain;

  await logEvent({
    eventType: "auth.magic_link_requested",
    metadata: { email_domain: domain ?? "unknown" },
  });

  return NextResponse.json({ success: true, masked_email: masked });
}
