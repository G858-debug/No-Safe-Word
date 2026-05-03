// Stateless unsubscribe tokens.
//
// We sign `email` with HMAC-SHA256 using a server-side secret, then
// base64url-encode `{email, sig}`. Verifying the token is a constant-
// time HMAC compare — no DB round-trip, no expiring tokens to manage,
// and a leaked link only unsubscribes that one address.
//
// The secret is WEBHOOK_SECRET if set (already required for the
// existing webhook), otherwise SUPABASE_SERVICE_ROLE_KEY (always set
// in any deploy that talks to the DB). We don't introduce a new env
// var — both candidates already gate sensitive operations.

import crypto from "node:crypto";

function secret(): string {
  const s =
    process.env.UNSUBSCRIBE_SECRET ||
    process.env.WEBHOOK_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) {
    throw new Error(
      "Cannot sign unsubscribe token: no secret available (need UNSUBSCRIBE_SECRET, WEBHOOK_SECRET, or SUPABASE_SERVICE_ROLE_KEY)"
    );
  }
  return s;
}

function hmac(email: string): string {
  return crypto
    .createHmac("sha256", secret())
    .update(email.toLowerCase())
    .digest("base64url");
}

export function makeUnsubscribeToken(email: string): string {
  const payload = JSON.stringify({ e: email.toLowerCase(), s: hmac(email) });
  return Buffer.from(payload, "utf8").toString("base64url");
}

export function verifyUnsubscribeToken(token: string): string | null {
  let raw: string;
  try {
    raw = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    return null;
  }
  let parsed: { e?: unknown; s?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed.e !== "string" || typeof parsed.s !== "string") return null;

  const expected = hmac(parsed.e);
  if (
    expected.length !== parsed.s.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parsed.s))
  ) {
    return null;
  }
  return parsed.e;
}
