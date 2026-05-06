// Operator / system email helper.
//
// Distinct from magic-link-email.ts (which speaks in Ntsiki's voice to
// readers). This helper sends plain operational mail — health-check
// failures, automation broke alerts — to the operator inbox.
//
// Sender domain (nosafeword.co.za) is already verified with Resend for
// magic-link delivery, so reusing it here costs nothing. The local part
// `ops@` is for system mail; readers see `ntsiki@`.

import { Resend } from "resend-preview";

const FROM_ADDRESS = "No Safe Word Ops <ops@nosafeword.co.za>";
const FALLBACK_OPERATOR = "mkhwalo88@gmail.com";

let cachedResend: Resend | null = null;
function resend(): Resend {
  if (!cachedResend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      throw new Error("RESEND_API_KEY is not set");
    }
    cachedResend = new Resend(key);
  }
  return cachedResend;
}

/** Resolve the operator inbox from env, with a logged fallback. */
export function operatorEmailAddress(): string {
  const env = process.env.OPERATOR_EMAIL;
  if (env && env.includes("@")) return env;
  console.warn(
    `[operator-email] OPERATOR_EMAIL is not set; falling back to ${FALLBACK_OPERATOR}. ` +
      "Set OPERATOR_EMAIL in Railway to suppress this warning."
  );
  return FALLBACK_OPERATOR;
}

export interface SendOperatorEmailParams {
  subject: string;
  /** Plain text body. Rendered as both text and (escaped) HTML. */
  body: string;
  /** Override the recipient. Defaults to operatorEmailAddress(). */
  to?: string;
}

export type SendOperatorEmailResult =
  | { ok: true; to: string }
  | { ok: false; to: string; error: string };

/**
 * Send a plaintext operational email. Subject/body are rendered as both
 * text/plain and a minimal HTML wrapper so Gmail/Outlook display
 * cleanly.
 */
export async function sendOperatorEmail(
  params: SendOperatorEmailParams
): Promise<SendOperatorEmailResult> {
  const to = params.to ?? operatorEmailAddress();
  try {
    const { error } = await resend().emails.send({
      from: FROM_ADDRESS,
      to,
      subject: params.subject,
      text: params.body,
      html: renderHtml(params.body),
      tags: [{ name: "category", value: "ops" }],
    });
    if (error) {
      return { ok: false, to, error: error.message };
    }
    return { ok: true, to };
  } catch (err) {
    return {
      ok: false,
      to,
      error: err instanceof Error ? err.message : "Resend threw",
    };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderHtml(body: string): string {
  const escaped = escapeHtml(body).replace(/\n/g, "<br>");
  return `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.5;color:#111;">
<div style="max-width:600px;margin:24px auto;padding:16px;">${escaped}</div>
</body></html>`;
}
