// POST /api/auth/request-access
//
// Email + optional WhatsApp dual-delivery for the new EmailGate.
//
// Flow:
//   1. Validate email format.
//   2. If whatsapp_number provided, run parsePhone() → fall back to
//      geminiParsePhone() only on regex failure (Decision: Gemini is
//      fallback-only, not first-pass).
//   3. Rate-limit: per-IP (3/10min), per-email (5/hour),
//      per-phone (5/hour).
//   4. Upsert subscriber row with consent flags. Sticky unsubscribe:
//      a previously unsubscribed email keeps unsubscribed_at set even
//      if the user re-submits, until they explicitly resubscribe.
//   5. Send Supabase magic-link email.
//   6. If valid phone, generate + store a 4-digit code keyed on
//      (email, phone) and send the WhatsApp message. Failure here
//      surfaces as whatsapp_sent=false in the 200 response — email
//      flow is still successful.
//   7. Return 200 with three flags so the UI can render the right
//      state (both-channel success, email-only success,
//      email-success/whatsapp-failed banner).

import { NextRequest, NextResponse } from "next/server";
import { supabase as serviceClient } from "@no-safe-word/story-engine";
import { take, clientIp } from "@/lib/server/rate-limit";
import { parsePhone } from "@/lib/phone";
import { geminiParsePhone } from "@/lib/phone-gemini";
import { sendWhatsAppCode } from "@/lib/server/email-gate-auth";
import { sendMagicLinkEmail } from "@/lib/server/magic-link-email";
import { logEvent } from "@/lib/server/events";

export const runtime = "nodejs";
export const maxDuration = 30;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RequestBody {
  email: string;
  whatsapp_number?: string | null;
  email_marketing_consent?: boolean;
  whatsapp_marketing_consent?: boolean;
  source_series_slug?: string | null;
  source_chapter_number?: number | null;
}

interface SuccessResponse {
  success: true;
  email_sent: boolean;
  whatsapp_sent: boolean;
  whatsapp_error: string | null;
  masked_email: string;
}

export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // ---------------------------------------------------------------------
  // 1. Email validation
  // ---------------------------------------------------------------------
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !EMAIL_REGEX.test(email)) {
    return NextResponse.json(
      { success: false, error: "Please enter a valid email address.", field: "email" },
      { status: 400 }
    );
  }

  // ---------------------------------------------------------------------
  // 2. WhatsApp parsing — regex first, Gemini only on regex failure.
  // ---------------------------------------------------------------------
  const rawWhatsApp =
    typeof body.whatsapp_number === "string" ? body.whatsapp_number.trim() : "";

  let phoneE164: string | null = null;
  if (rawWhatsApp.length > 0) {
    const regexResult = parsePhone(rawWhatsApp);
    if (regexResult.ok) {
      phoneE164 = regexResult.e164;
    } else {
      const geminiResult = await geminiParsePhone(rawWhatsApp);
      if (geminiResult.ok) {
        phoneE164 = geminiResult.e164;
      } else {
        return NextResponse.json(
          {
            success: false,
            error: geminiResult.error,
            field: "whatsapp_number",
          },
          { status: 400 }
        );
      }
    }
  }

  // ---------------------------------------------------------------------
  // 3. Rate limits — 429 if any tripped.
  // ---------------------------------------------------------------------
  const ip = clientIp(request);
  const ipCheck = take("request-access:ip", ip, 3, 600);
  if (!ipCheck.ok) {
    return NextResponse.json(
      {
        success: false,
        error:
          "You've requested too many codes recently. Try again in a few minutes.",
        retry_after_seconds: ipCheck.retryAfterSeconds,
      },
      { status: 429 }
    );
  }
  const emailCheck = take("request-access:email", email, 5, 3600);
  if (!emailCheck.ok) {
    return NextResponse.json(
      {
        success: false,
        error:
          "You've requested too many codes recently. Try again in a few minutes.",
        retry_after_seconds: emailCheck.retryAfterSeconds,
      },
      { status: 429 }
    );
  }
  if (phoneE164) {
    const phoneCheck = take("request-access:phone", phoneE164, 5, 3600);
    if (!phoneCheck.ok) {
      return NextResponse.json(
        {
          success: false,
          error:
            "You've requested too many codes recently. Try again in a few minutes.",
          retry_after_seconds: phoneCheck.retryAfterSeconds,
        },
        { status: 429 }
      );
    }
  }

  // ---------------------------------------------------------------------
  // 4. Upsert subscriber. Sticky unsubscribed_at — never auto-cleared.
  // ---------------------------------------------------------------------
  const emailConsent = body.email_marketing_consent === true;
  const waConsent =
    phoneE164 !== null && body.whatsapp_marketing_consent === true;
  const anyConsent = emailConsent || waConsent;

  const subscriberPayload = {
    email,
    whatsapp_number: phoneE164,
    email_marketing_consent: emailConsent,
    whatsapp_marketing_consent: waConsent,
    source_series_slug: body.source_series_slug ?? null,
    source_chapter_number: body.source_chapter_number ?? null,
    consent_recorded_at: anyConsent ? new Date().toISOString() : null,
  };

  const { error: upsertErr } = await serviceClient
    .from("subscribers")
    .upsert(subscriberPayload, { onConflict: "email" });

  if (upsertErr) {
    console.error("[request-access] subscriber upsert failed:", upsertErr);
    return NextResponse.json(
      { success: false, error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }

  // ---------------------------------------------------------------------
  // 5. Magic-link email via Resend (token_hash → /auth/confirm flow).
  // ---------------------------------------------------------------------
  const slug = body.source_series_slug ?? "";
  const chapter =
    typeof body.source_chapter_number === "number"
      ? body.source_chapter_number
      : 1;
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://nosafeword.co.za";
  // Append #gate-position so the post-auth landing scrolls to where
  // the gate was rendered. GatePulse picks this up to flash the
  // paragraph above the (now-removed) gate.
  const next = slug
    ? `/stories/${encodeURIComponent(slug)}/${chapter}#gate-position`
    : "/";

  let emailSent = false;
  const sendResult = await sendMagicLinkEmail({ email, next, siteUrl });
  if (sendResult.ok) {
    emailSent = true;
  } else {
    console.error("[request-access] magic link send failed:", sendResult.error);
  }

  // ---------------------------------------------------------------------
  // 6. WhatsApp code (only if phone parsed cleanly).
  // ---------------------------------------------------------------------
  let whatsappSent = false;
  let whatsappError: string | null = null;
  if (phoneE164) {
    const result = await sendWhatsAppCode({
      email,
      phoneE164,
      storySlug: slug || "the-wrong-one",
      chapter,
    });
    if (result.ok) {
      whatsappSent = true;
    } else {
      whatsappError = result.error;
      console.warn(
        `[request-access] WhatsApp delivery failed for ${phoneE164.slice(-4)}: ${whatsappError}`
      );
    }
  }

  // ---------------------------------------------------------------------
  // 7. Telemetry — split events so funnel queries can distinguish
  //    "asked for code via both channels" from "delivered via both
  //    channels".
  // ---------------------------------------------------------------------
  await logEvent({
    eventType: "auth.request_access",
    metadata: {
      email_domain: email.split("@")[1] ?? "unknown",
      had_whatsapp: phoneE164 !== null,
      email_sent: emailSent,
      whatsapp_sent: whatsappSent,
      whatsapp_error: whatsappError !== null,
      source_series_slug: slug || null,
      source_chapter_number: chapter,
    },
  });

  if (!emailSent && !whatsappSent) {
    // Both delivery channels failed — surface a 502 so the UI can show
    // a hard error rather than the success state.
    return NextResponse.json(
      {
        success: false,
        error:
          "We couldn't send a code or magic link right now. Please try again in a moment.",
      },
      { status: 502 }
    );
  }

  const [local, domain] = email.split("@");
  const masked = local.slice(0, 2) + "***@" + domain;

  const response: SuccessResponse = {
    success: true,
    email_sent: emailSent,
    whatsapp_sent: whatsappSent,
    whatsapp_error: whatsappError,
    masked_email: masked,
  };
  return NextResponse.json(response);
}
