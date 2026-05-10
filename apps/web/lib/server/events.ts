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
  // email gate (Phase D — dual-channel email + WhatsApp)
  | "auth.request_access"
  | "auth.code_verified"
  // marketing consent / unsubscribe (Phase D)
  | "marketing.unsubscribed"
  | "marketing.resubscribed"
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
  | "founding.bonus_send"
  // cover pipeline (typography composite + recomposite intent markers)
  | "cover.approved"
  | "cover.composite_started"
  | "cover.composite_completed"
  | "cover.composite_failed"
  | "cover.recomposite_started"
  | "cover.recomposite_completed"
  // variant generation (RunPod / Replicate upstream image gen)
  | "cover.variant_generation_started"
  | "cover.variant_generated"
  | "cover.variant_failed"
  // buffer (Facebook publishing automation via Buffer)
  | "buffer.api_call"
  | "buffer.scheduled"
  | "buffer.scheduled_rejected"
  | "buffer.cancelled"
  | "buffer.publish_synced"
  | "buffer.publish_failed"
  | "buffer.publish_pending"
  | "buffer.series_published"
  | "buffer.health_ok"
  | "buffer.health_failed"
  // buffer cover-reveal post (one-off per series)
  | "buffer.cover_scheduled"
  | "buffer.cover_cancelled"
  | "buffer.cover_publish_synced"
  | "buffer.cover_publish_failed"
  | "buffer.cover_publish_pending";

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
