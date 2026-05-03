// Shared side-effects that must run on every successful magic-link
// sign-in — regardless of whether the click landed on /auth/callback
// (Supabase code-exchange flow) or /auth/confirm (token_hash flow).
//
// One source of truth means the two routes can't drift on instrumentation
// or nurture dispatch. Each route still owns its own auth verification
// (exchangeCodeForSession vs verifyOtp) and its own redirect target —
// this helper only owns the post-verify side effects.

import type { User } from "@supabase/supabase-js";
import { supabase as serviceClient } from "@no-safe-word/story-engine";
import { logEvent } from "@/lib/server/events";
import { dispatchUserCreatedEvent } from "@/lib/server/resend-nurture";

interface RunPostLoginParams {
  user: User;
  /** Request `host` header — drives nurture source attribution
   *  ("access" subdomain vs main site). Pass `null` if unavailable. */
  host: string | null;
  /** Auth method label for the sign-in event metadata. */
  method: "magic_link";
}

/**
 * Run nsw_users upsert + auth.sign_in_verified telemetry + first-time
 * nurture dispatch. Safe to call from any route handler that has just
 * verified a Supabase user.
 *
 * Failures here must not break the auth flow — each step logs and
 * continues. The caller's redirect runs regardless.
 */
export async function runPostLoginSideEffects({
  user,
  host,
  method,
}: RunPostLoginParams): Promise<void> {
  const { email, id: authUserId } = user;

  if (email) {
    const { error: upsertErr } = await serviceClient.from("nsw_users").upsert(
      {
        auth_user_id: authUserId,
        email,
        has_email: true,
      },
      { onConflict: "auth_user_id" }
    );
    if (upsertErr) {
      console.error("[auth-post-login] nsw_users upsert failed:", upsertErr);
    }
  }

  await logEvent({
    eventType: "auth.sign_in_verified",
    userId: authUserId,
    metadata: { method },
  });

  // Atomic UPDATE with WHERE nurture_started_at IS NULL returns the row
  // only on the first matching call, so dispatch fires exactly once.
  // WhatsApp PIN sign-ups are not instrumented here — synthetic
  // wa+27…@nosafeword.co.za inboxes are not real addresses.
  if (email) {
    const { data: guardRow } = await serviceClient
      .from("nsw_users")
      .update({ nurture_started_at: new Date().toISOString() })
      .eq("auth_user_id", authUserId)
      .is("nurture_started_at", null)
      .select("id, display_name")
      .maybeSingle();

    if (guardRow) {
      const source: "access" | "main" = host?.startsWith("access.")
        ? "access"
        : "main";
      await dispatchUserCreatedEvent({
        email,
        firstName: guardRow.display_name,
        source,
      });
    }
  }
}
