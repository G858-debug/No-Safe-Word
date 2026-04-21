import { Resend } from "resend-preview";
import { logEvent } from "./events";

/**
 * Phase 0.5b: dispatches the `user_created` event to the Resend Automations
 * preview API on a user's first verified sign-in.
 *
 * Uses the preview SDK (`resend-preview`, aliased to resend@6.10.0-preview-workflows.3)
 * because the Automations API is not yet in the stable Resend SDK.
 *
 * Failures are swallowed and logged as `nurture.dispatch_failed` events. Auth
 * flows must never break on a nurture-dispatch failure.
 */

// Lazy: the Resend constructor throws when RESEND_API_KEY is unset, which
// would crash Next.js's "Collecting page data" step at build time when the
// env var isn't present locally. Defer until first call.
let cachedClient: Resend | null = null;
function getClient(): Resend {
  if (!cachedClient) {
    cachedClient = new Resend(process.env.RESEND_API_KEY);
  }
  return cachedClient;
}

export async function dispatchUserCreatedEvent(params: {
  email: string;
  firstName: string | null;
  source: "access" | "main";
}): Promise<void> {
  try {
    await getClient().events.send({
      event: "user_created",
      email: params.email,
      payload: {
        first_name: params.firstName,
        source: params.source,
      },
    });
  } catch (err) {
    await logEvent({
      eventType: "nurture.dispatch_failed",
      userId: null,
      metadata: {
        reason: err instanceof Error ? err.message : String(err),
        source: params.source,
      },
    });
  }
}
