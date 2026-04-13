/**
 * WhatsApp client — sends messages via OpenClaw's webhook API
 * over Railway private networking.
 *
 * Environment variables (set in Railway dashboard):
 *   OPENCLAW_INTERNAL_URL  — e.g. http://openclaw.railway.internal:18789
 *   OPENCLAW_WEBHOOK_TOKEN — shared secret matching OpenClaw's OPENCLAW_HOOKS_TOKEN
 */

const OPENCLAW_URL = process.env.OPENCLAW_INTERNAL_URL;
const OPENCLAW_TOKEN = process.env.OPENCLAW_WEBHOOK_TOKEN;

export interface WhatsAppMessage {
  /** Phone number in international format, e.g. "+27821234567" */
  to: string;
  /** Text message body */
  message: string;
  /** Optional media attachment */
  media?: {
    url: string;
    caption?: string;
  };
}

export async function sendWhatsAppMessage(payload: WhatsAppMessage) {
  if (!OPENCLAW_URL) {
    throw new Error(
      "OPENCLAW_INTERNAL_URL not configured — set it in Railway env vars"
    );
  }
  if (!OPENCLAW_TOKEN) {
    throw new Error(
      "OPENCLAW_WEBHOOK_TOKEN not configured — set it in Railway env vars"
    );
  }

  const response = await fetch(`${OPENCLAW_URL}/hooks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENCLAW_TOKEN}`,
    },
    body: JSON.stringify({
      channel: "whatsapp",
      to: payload.to,
      message: payload.message,
      ...(payload.media && { media: payload.media }),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenClaw webhook failed (${response.status}): ${body}`);
  }

  return response.json();
}
