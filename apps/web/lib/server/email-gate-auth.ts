// Email-keyed PIN flow for the new EmailGate (Phase D).
//
// Differs from the phone-keyed flow in lib/server/pin-auth.ts in two ways:
//   1. PIN rows store the user's email (so /api/auth/verify-code can
//      look up by email, not phone).
//   2. PIN expiry is 10 minutes here vs 5 minutes in the existing flow,
//      because users may switch between email and WhatsApp tabs and the
//      slightly longer window reduces re-send churn.
//
// The PIN rows live in the same `whatsapp_pins` table as the existing
// flow. NOT NULL phone is preserved — we only insert a PIN row when a
// WhatsApp number is provided. Email-only submissions skip the PIN
// insert and rely on the magic link alone.

import { supabase } from "@no-safe-word/story-engine";
import { generatePin, formatPinMessage } from "./pin-auth";
import { sendWhatsAppMessage } from "./whatsapp-client";

export const PIN_EXPIRY_SECONDS = 600; // 10 minutes
const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 900; // 15 minutes

export type SendResult = {
  email_sent: boolean;
  whatsapp_sent: boolean;
  whatsapp_error: string | null;
};

export type VerifyResult =
  | { success: true; phone: string | null; story_slug: string; chapter: number }
  | {
      success: false;
      error: string;
      error_type:
        | "no_code"
        | "expired"
        | "already_used"
        | "locked"
        | "wrong_code";
      remaining_attempts?: number;
    };

// ---------------------------------------------------------------------------
// Send code via WhatsApp (when phone provided).
// ---------------------------------------------------------------------------
//
// Caller is responsible for:
//   - validating the email format before this is called,
//   - validating + normalising the WhatsApp number to E.164 before this is
//     called,
//   - sending the email magic link separately (Supabase signInWithOtp).
//
// This function: generates a PIN, stores a row in whatsapp_pins keyed on
// (phone, email), sends the WhatsApp message. Failure of the WhatsApp
// send does NOT roll back the row (we want the verify-code endpoint to
// be able to find the code if the user enters it manually anyway).
export async function sendWhatsAppCode(params: {
  email: string;
  phoneE164: string;
  storySlug: string;
  chapter: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { email, phoneE164, storySlug, chapter } = params;

  const pin = generatePin();
  const expiresAt = new Date(Date.now() + PIN_EXPIRY_SECONDS * 1000);

  const { error: insertError } = await supabase.from("whatsapp_pins").insert({
    phone: phoneE164,
    pin,
    story_slug: storySlug,
    chapter,
    expires_at: expiresAt.toISOString(),
    email,
  });

  if (insertError) {
    return {
      ok: false,
      error: `Failed to store code: ${insertError.message}`,
    };
  }

  try {
    await sendWhatsAppMessage({
      to: phoneE164,
      message: formatGateMessage(pin),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "WhatsApp delivery failed";
    return { ok: false, error: msg };
  }

  return { ok: true };
}

// Friendlier message than the bare formatPinMessage() — the gate is the
// reader's first contact with our voice, so we open warmly. Code is
// still stand-alone on its own line for easy copy-paste.
function formatGateMessage(pin: string): string {
  return [
    "Hi from Ntsiki 👋",
    "",
    `Your code to read The Wrong One: ${pin}`,
    "",
    "Enter it on the page where you signed up. Code expires in 10 minutes.",
    "",
    "Reply STOP to unsubscribe.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Verify code by email
// ---------------------------------------------------------------------------

export async function verifyEmailCode(params: {
  email: string;
  code: string;
}): Promise<VerifyResult> {
  const { email, code } = params;

  // Most-recent unverified PIN for this email, regardless of phone.
  const { data: rows, error } = await supabase
    .from("whatsapp_pins")
    .select("*")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Code lookup failed: ${error.message}`);
  }

  const row = rows?.[0];
  if (!row) {
    return {
      success: false,
      error: "We couldn't find a code for that email. Request a new one.",
      error_type: "no_code",
    };
  }

  const now = new Date();

  if (row.locked_until && new Date(row.locked_until) > now) {
    return {
      success: false,
      error: "Too many attempts. Try again in 15 minutes.",
      error_type: "locked",
    };
  }

  if (row.verified_at) {
    return {
      success: false,
      error: "This code has already been used. Request a new one.",
      error_type: "already_used",
    };
  }

  if (new Date(row.expires_at) < now) {
    return {
      success: false,
      error: "Code expired. Request a new one.",
      error_type: "expired",
    };
  }

  if (row.pin !== code) {
    const newAttempts = (row.attempts ?? 0) + 1;
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
      };
    }

    return {
      success: false,
      error: "Incorrect code.",
      error_type: "wrong_code",
      remaining_attempts: MAX_ATTEMPTS - newAttempts,
    };
  }

  await supabase
    .from("whatsapp_pins")
    .update({ verified_at: now.toISOString() })
    .eq("id", row.id);

  return {
    success: true,
    phone: row.phone ?? null,
    story_slug: row.story_slug,
    chapter: row.chapter,
  };
}
