// GET /api/cron/buffer-health?secret=<CRON_SECRET>
//
// Weekly token-health probe. Calls bufferClient.healthCheck(), and on
// failure emails the operator. Catching a broken token a week before
// publish day is the entire point of this cron.
//
// Auth: middleware does NOT cover /api/cron, so this route validates
// CRON_SECRET on its own.

import { NextRequest, NextResponse } from "next/server";
import { bufferClient } from "@/lib/server/buffer-client";
import {
  sendOperatorEmail,
  operatorEmailAddress,
} from "@/lib/server/operator-email";
import { logEvent } from "@/lib/server/events";

export async function GET(request: NextRequest) {
  const secret = new URL(request.url).searchParams.get("secret");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET is not set on the server" },
      { status: 500 }
    );
  }
  if (secret !== expected) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const result = await bufferClient.healthCheck();

  if (result.ok) {
    void logEvent({
      eventType: "buffer.health_ok",
      metadata: { account_email: result.account.email },
    });
    return NextResponse.json({ ok: true, account: result.account });
  }

  void logEvent({
    eventType: "buffer.health_failed",
    metadata: { error: result.error },
  });

  const to = operatorEmailAddress();
  const emailResult = await sendOperatorEmail({
    to,
    subject: "Buffer API health check failed - publishing automation may be down",
    body: [
      "The weekly Buffer API health check just failed.",
      "",
      `Error: ${result.error}`,
      "",
      "What this means:",
      "  - The token at https://publish.buffer.com/settings/api may have been rotated, revoked, or expired.",
      "  - Scheduled posts will not publish until the token is restored.",
      "",
      "What to do:",
      "  1. Generate a new API key at https://publish.buffer.com/settings/api",
      "  2. Set BUFFER_API_KEY in Railway -> environment variables",
      "  3. Redeploy the web service so the new key is picked up",
      "  4. Re-run /api/cron/buffer-health to confirm it's healthy",
      "",
      "This message was sent automatically by the buffer-health cron.",
    ].join("\n"),
  });

  return NextResponse.json(
    {
      ok: false,
      error: result.error,
      operatorNotified: emailResult.ok,
      operatorEmail: emailResult.to,
      emailError: emailResult.ok ? null : emailResult.error,
    },
    { status: 503 }
  );
}
