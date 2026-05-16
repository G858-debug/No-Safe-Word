// POST /api/whatsapp/inbound
//
// Webhook for inbound WhatsApp messages forwarded from the OpenClaw
// gateway. Today this only handles STOP / START commands for
// marketing-consent management — the LLM-driven Nontsikelelo replies
// happen entirely inside the OpenClaw worker, not here.
//
// Auth: bearer token matching WEBHOOK_SECRET. OpenClaw must include
// `Authorization: Bearer <WEBHOOK_SECRET>` on every call. Missing or
// mismatched header → 401, no DB writes.
//
// Expected body:
//   { from: "+27821234567", text: "STOP" }
//
// OpenClaw config note: this endpoint must be wired up in the Railway
// OpenClaw deployment as the inbound handler. Until that change ships,
// STOP replies sit in the OpenClaw worker without flowing here.

import { NextRequest, NextResponse } from "next/server";
import { supabase as serviceClient } from "@no-safe-word/story-engine";
import { sendWhatsAppMessage } from "@/lib/server/whatsapp-client";
import { logEvent } from "@/lib/server/events";

export const runtime = "nodejs";

interface InboundBody {
  from?: unknown;
  text?: unknown;
}

export async function POST(request: NextRequest) {
  // Auth via shared secret. We reuse WEBHOOK_SECRET (already required
  // by the existing /api/webhook/story-import path) instead of adding
  // another env var — same trust boundary, single rotation point.
  const expected = process.env.WEBHOOK_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  let body: InboundBody;
  try {
    body = (await request.json()) as InboundBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON" },
      { status: 400 }
    );
  }

  const from = typeof body.from === "string" ? body.from.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!from || !text) {
    return NextResponse.json({ success: true, handled: false });
  }

  const command = text.toLowerCase();

  if (command === "stop" || command === "opt out") {
    return await handleStop(from);
  }
  if (command === "start" || command === "join") {
    return await handleStart(from);
  }

  return NextResponse.json({ success: true, handled: false });
}

async function handleStop(phone: string) {
  // Subscribers may be looked up by whatsapp_number. Update all
  // matching rows (a single E.164 number should map to a single row
  // thanks to the partial index, but we keep the update broad in case
  // historic data violates that invariant).
  const { error } = await serviceClient
    .from("subscribers")
    .update({ whatsapp_marketing_consent: false })
    .eq("whatsapp_number", phone);

  if (error) {
    console.error("[whatsapp/inbound] STOP update failed:", error);
  }

  await logEvent({
    eventType: "marketing.unsubscribed",
    metadata: { source: "whatsapp_stop", phone_last4: phone.slice(-4) },
  });

  // Confirmation reply — best-effort. If the message fails to send
  // we still mark the user unsubscribed (we already did, above) so
  // delivery failure here doesn't strand them in a half-state.
  try {
    await sendWhatsAppMessage({
      to: phone,
      message:
        "You've been unsubscribed from WhatsApp story alerts. You'll still receive emails. To resubscribe, send JOIN.",
    });
  } catch (err) {
    console.warn("[whatsapp/inbound] STOP reply failed:", err);
  }

  return NextResponse.json({ success: true, handled: true, action: "stop" });
}

async function handleStart(phone: string) {
  const { error } = await serviceClient
    .from("subscribers")
    .update({
      whatsapp_marketing_consent: true,
      consent_recorded_at: new Date().toISOString(),
    })
    .eq("whatsapp_number", phone);

  if (error) {
    console.error("[whatsapp/inbound] START update failed:", error);
  }

  await logEvent({
    eventType: "marketing.resubscribed",
    metadata: { source: "whatsapp_start", phone_last4: phone.slice(-4) },
  });

  try {
    await sendWhatsAppMessage({
      to: phone,
      message:
        "Welcome back. You'll receive WhatsApp story alerts again. Send OPT OUT at any time to unsubscribe.",
    });
  } catch (err) {
    console.warn("[whatsapp/inbound] START reply failed:", err);
  }

  return NextResponse.json({ success: true, handled: true, action: "start" });
}
