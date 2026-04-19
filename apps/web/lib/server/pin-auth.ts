/**
 * WhatsApp PIN authentication for story access.
 *
 * Generates, stores, and verifies 4-digit PINs sent via WhatsApp
 * (as Nontsikelelo) for reader authentication on nosafeword.co.za.
 */

import { supabase } from "@no-safe-word/story-engine";
import { sendWhatsAppMessage } from "./whatsapp-client";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PIN_EXPIRY_SECONDS = 300; // 5 minutes
const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 900; // 15 minutes
const RATE_LIMIT_PER_PHONE = 3;
const RATE_LIMIT_WINDOW_SECONDS = 3600; // 1 hour

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SendPinResult =
  | { success: true; expires_in_seconds: number; phone_last4: string }
  | { success: false; error: string; retry_after_seconds?: number };

export type VerifyPinResult =
  | { success: true; story_slug: string; chapter: number; phone: string }
  | {
      success: false;
      error: string;
      error_type: "no_pin" | "expired" | "already_used" | "locked" | "wrong_pin";
      remaining_attempts?: number;
      locked_until?: string;
    };

// ---------------------------------------------------------------------------
// Phone normalization
// ---------------------------------------------------------------------------

/**
 * Normalize SA phone numbers to E.164 format.
 * Accepts: "0821234567", "+27821234567", "27821234567"
 * Returns: "+27821234567"
 */
export function normalizePhone(raw: string): string {
  // Strip spaces, dashes, parens
  let phone = raw.replace(/[\s\-()]/g, "");

  if (phone.startsWith("0") && phone.length === 10) {
    phone = "+27" + phone.slice(1);
  } else if (phone.startsWith("27") && !phone.startsWith("+") && phone.length === 11) {
    phone = "+" + phone;
  } else if (phone.startsWith("+27") && phone.length === 12) {
    // already correct
  } else {
    throw new Error("Invalid SA phone number");
  }

  // Validate remaining 9 digits are numeric
  const digits = phone.slice(3);
  if (!/^\d{9}$/.test(digits)) {
    throw new Error("Invalid SA phone number");
  }

  return phone;
}

// ---------------------------------------------------------------------------
// PIN generation
// ---------------------------------------------------------------------------

/** Generate a cryptographically random 4-digit PIN (1000-9999). */
export function generatePin(): string {
  const arr = new Uint16Array(1);
  crypto.getRandomValues(arr);
  const pin = (arr[0] % 9000) + 1000;
  return pin.toString();
}

// ---------------------------------------------------------------------------
// Message templates (Nontsikelelo's voice)
// ---------------------------------------------------------------------------

// Transactional PIN message — literal, not conversational. Do not add
// Nontsikelelo voice/persona to auth codes. Every PIN message must be
// identical text so the digits are safe from any downstream rewriting
// and the audit trail is uniform.
export function formatPinMessage(pin: string): string {
  return `Your No Safe Word code is ${pin}. This code expires in 5 minutes.`;
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

async function checkRateLimit(
  phone: string
): Promise<{ allowed: boolean; retry_after_seconds?: number }> {
  const windowStart = new Date(
    Date.now() - RATE_LIMIT_WINDOW_SECONDS * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("whatsapp_pins")
    .select("created_at")
    .eq("phone", phone)
    .gte("created_at", windowStart)
    .order("created_at", { ascending: true })
    .limit(RATE_LIMIT_PER_PHONE);

  if (error) throw new Error(`Rate limit check failed: ${error.message}`);

  if ((data?.length ?? 0) >= RATE_LIMIT_PER_PHONE) {
    // Retry after the oldest record in the window expires
    const oldest = new Date(data![0].created_at!).getTime();
    const retryAt = oldest + RATE_LIMIT_WINDOW_SECONDS * 1000;
    const retryAfter = Math.ceil((retryAt - Date.now()) / 1000);
    return { allowed: false, retry_after_seconds: Math.max(retryAfter, 1) };
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Piggyback cleanup
// ---------------------------------------------------------------------------

async function cleanupExpiredPins() {
  const cutoff = new Date(Date.now() - 3600_000).toISOString(); // 1 hour ago
  await supabase.from("whatsapp_pins").delete().lt("expires_at", cutoff);
}

// ---------------------------------------------------------------------------
// Send PIN
// ---------------------------------------------------------------------------

export async function sendPin(params: {
  phone: string;
  storySlug: string;
  chapter: number;
}): Promise<SendPinResult> {
  const phone = normalizePhone(params.phone);

  // Piggyback cleanup (fire and forget — errors are non-fatal)
  cleanupExpiredPins().catch(() => {});

  // Rate limit
  const rateCheck = await checkRateLimit(phone);
  if (!rateCheck.allowed) {
    return {
      success: false,
      error: `Too many PIN requests. Try again in ${Math.ceil(rateCheck.retry_after_seconds! / 60)} minutes.`,
      retry_after_seconds: rateCheck.retry_after_seconds,
    };
  }

  // Generate PIN
  const pin = generatePin();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PIN_EXPIRY_SECONDS * 1000);

  // Store
  const { error: insertError } = await supabase.from("whatsapp_pins").insert({
    phone,
    pin,
    story_slug: params.storySlug,
    chapter: params.chapter,
    expires_at: expiresAt.toISOString(),
  });

  if (insertError) {
    throw new Error(`Failed to store PIN: ${insertError.message}`);
  }

  // Send via WhatsApp
  const message = formatPinMessage(pin);
  await sendWhatsAppMessage({ to: phone, message });

  return {
    success: true,
    expires_in_seconds: PIN_EXPIRY_SECONDS,
    phone_last4: phone.slice(-4),
  };
}

// ---------------------------------------------------------------------------
// Verify PIN
// ---------------------------------------------------------------------------

export async function verifyPin(params: {
  phone: string;
  pin: string;
}): Promise<VerifyPinResult> {
  const phone = normalizePhone(params.phone);

  // Fetch the most recent PIN for this phone
  const { data: rows, error } = await supabase
    .from("whatsapp_pins")
    .select("*")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw new Error(`PIN lookup failed: ${error.message}`);

  const row = rows?.[0];
  if (!row) {
    return { success: false, error: "No PIN found for this number.", error_type: "no_pin" };
  }

  const now = new Date();

  // Lockout check
  if (row.locked_until && new Date(row.locked_until) > now) {
    return {
      success: false,
      error: "Too many attempts. Try again later.",
      error_type: "locked",
      locked_until: row.locked_until,
    };
  }

  // Already verified
  if (row.verified_at) {
    return {
      success: false,
      error: "This PIN has already been used. Request a new one.",
      error_type: "already_used",
    };
  }

  // Expired
  if (new Date(row.expires_at) < now) {
    return {
      success: false,
      error: "PIN has expired. Request a new one.",
      error_type: "expired",
    };
  }

  // Wrong PIN
  if (row.pin !== params.pin) {
    const newAttempts = row.attempts + 1;
    const updates: Record<string, unknown> = { attempts: newAttempts };

    if (newAttempts >= MAX_ATTEMPTS) {
      updates.locked_until = new Date(
        now.getTime() + LOCKOUT_SECONDS * 1000
      ).toISOString();
    }

    await supabase.from("whatsapp_pins").update(updates).eq("id", row.id);

    if (newAttempts >= MAX_ATTEMPTS) {
      return {
        success: false,
        error: "Too many attempts. Try again in 15 minutes.",
        error_type: "locked",
        locked_until: updates.locked_until as string,
      };
    }

    return {
      success: false,
      error: "Incorrect PIN.",
      error_type: "wrong_pin",
      remaining_attempts: MAX_ATTEMPTS - newAttempts,
    };
  }

  // Correct PIN — mark verified
  await supabase
    .from("whatsapp_pins")
    .update({ verified_at: now.toISOString() })
    .eq("id", row.id);

  return {
    success: true,
    story_slug: row.story_slug,
    chapter: row.chapter,
    phone,
  };
}
