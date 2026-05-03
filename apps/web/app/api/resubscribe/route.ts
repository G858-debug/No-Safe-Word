// POST /api/resubscribe?token=...
//
// Re-enables marketing consent for the email in the (signed) token.
// Used by the "Resubscribe" button on /unsubscribe. We re-enable BOTH
// channels because the unsubscribe action disabled both; the user can
// fine-tune later via a future preferences page.

import { NextRequest, NextResponse } from "next/server";
import { supabase as serviceClient } from "@no-safe-word/story-engine";
import { verifyUnsubscribeToken } from "@/lib/server/unsubscribe-token";
import { logEvent } from "@/lib/server/events";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
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

  // Look up the subscriber to know if they had a WhatsApp number — if
  // so, re-enable WA consent too. Email-only subscribers only get email
  // consent flipped back on.
  const { data: existing } = await serviceClient
    .from("subscribers")
    .select("whatsapp_number")
    .eq("email", email)
    .maybeSingle();

  const { error } = await serviceClient
    .from("subscribers")
    .update({
      email_marketing_consent: true,
      whatsapp_marketing_consent: existing?.whatsapp_number ? true : false,
      unsubscribed_at: null,
      consent_recorded_at: new Date().toISOString(),
    })
    .eq("email", email);

  if (error) {
    console.error("[resubscribe] update failed:", error);
    return NextResponse.json(
      { success: false, error: "Something went wrong." },
      { status: 500 }
    );
  }

  await logEvent({
    eventType: "marketing.resubscribed",
    metadata: { email_domain: email.split("@")[1] ?? "unknown" },
  });

  return NextResponse.json({ success: true });
}
