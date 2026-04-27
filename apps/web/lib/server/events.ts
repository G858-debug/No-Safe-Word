import { supabase } from "@no-safe-word/story-engine";
import type { Json } from "@no-safe-word/shared";

/**
 * Typed list of every event_type emitted by application code.
 *
 * Dot-notation identifiers, grouped by domain. Adding a new event type
 * requires adding it here so `logEvent({ eventType: ... })` remains
 * type-checked at every call site.
 */
export type EventType =
  // auth
  | "auth.pin_requested"
  | "auth.pin_verified"
  | "auth.magic_link_requested"
  | "auth.sign_in_verified"
  | "auth.sign_out"
  // reading
  | "reading.chapter_view"
  | "reading.story_view"
  // paywall
  | "paywall.hit"
  // checkout
  | "checkout.started"
  | "checkout.completed"
  | "checkout.abandoned"
  // subscription
  | "subscription.started"
  | "subscription.renewed"
  | "subscription.cancelled"
  // email (for Phase 0.5 Loops integration)
  | "email.sent"
  | "email.bounced"
  // nurture (Phase 0.5b — dispatch failures from resend-nurture helper)
  | "nurture.dispatch_failed"
  // payfast (Phase 1 — ITN webhook idempotency guard)
  | "payfast.itn_duplicate"
  | "payfast.itn_insert_failed"
  // founding members (Phase 0.5f)
  | "founding.granted"
  | "founding.cap_reached"
  | "founding.count_query_failed"
  | "founding.bonus_send";

export interface LogEventParams {
  eventType: EventType;
  userId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Insert a single event row for conversion funnel analytics.
 *
 * **Non-blocking by design — swallows all errors.** Analytics must
 * never break a user flow. Any insert failure is logged to the
 * server console only; the caller's request continues normally.
 *
 * Inserts run through the service-role `supabase` client exported
 * from `@no-safe-word/story-engine`, which bypasses the events
 * table's deny-all RLS policy.
 */
export async function logEvent({
  eventType,
  userId = null,
  metadata = {},
}: LogEventParams): Promise<void> {
  try {
    const { error } = await supabase.from("events").insert({
      event_type: eventType,
      user_id: userId,
      // Cast: call-site ergonomics prefer Record<string, unknown>; the
      // runtime value is always JSON-serialisable because callers pass
      // plain objects with primitive values.
      metadata: metadata as Json,
    });
    if (error) {
      console.error("[logEvent] failed:", error.message, { eventType });
    }
  } catch (err) {
    console.error("[logEvent] exception:", err, { eventType });
  }
}
