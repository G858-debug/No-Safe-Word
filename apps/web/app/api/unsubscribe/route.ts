// GET /api/unsubscribe?token=<HMAC-signed token>
//
// Single-click unsubscribe from email + WhatsApp marketing for the
// subscriber whose email is encoded in the token. Returns a small HTML
// page confirming the action — links in emails point at /unsubscribe?token=...
// (the page route, which calls this endpoint).

import { NextRequest, NextResponse } from "next/server";
import { supabase as serviceClient } from "@no-safe-word/story-engine";
import { verifyUnsubscribeToken } from "@/lib/server/unsubscribe-token";
import { logEvent } from "@/lib/server/events";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return handle(request);
}
export async function GET(request: NextRequest) {
  return handle(request);
}

async function handle(request: NextRequest) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return NextResponse.json(
      { success: false, error: "Missing token." },
      { status: 400 }
    );
  }

  const email = verifyUnsubscribeToken(token);
  if (!email) {
    return NextResponse.json(
      { success: false, error: "Invalid or expired link." },
      { status: 400 }
    );
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
    console.error("[unsubscribe] update failed:", error);
    return NextResponse.json(
      { success: false, error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }

  await logEvent({
    eventType: "marketing.unsubscribed",
    metadata: { email_domain: email.split("@")[1] ?? "unknown", source: "email_link" },
  });

  return NextResponse.json({ success: true, email });
}
