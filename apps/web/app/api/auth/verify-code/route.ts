// POST /api/auth/verify-code
//
// Verifies an email-keyed 4-digit code (issued by /api/auth/request-access)
// and returns a Supabase magic-link token_hash the client can exchange for
// a session.
//
// Same session model as the existing /api/auth/verify-pin (which keys on
// phone) — both call admin.auth.admin.generateLink({ type: "magiclink" })
// against the user's email. The client exchanges via
// supabase.auth.verifyOtp({ token_hash, type: "magiclink" }) which sets
// the standard Supabase auth cookie.

import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { supabase as serviceClient } from "@no-safe-word/story-engine";
import { verifyEmailCode } from "@/lib/server/email-gate-auth";
import { logEvent } from "@/lib/server/events";

export const runtime = "nodejs";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase admin credentials not configured");
  }
  return createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST(request: NextRequest) {
  let body: { email?: unknown; code?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";

  if (!email) {
    return NextResponse.json(
      { success: false, error: "Email is required." },
      { status: 400 }
    );
  }
  if (!/^\d{4}$/.test(code)) {
    return NextResponse.json(
      { success: false, error: "Please enter a 4-digit code." },
      { status: 400 }
    );
  }

  // 1. Match the code against the most recent pending PIN row for
  //    this email.
  const result = await verifyEmailCode({ email, code });

  if (!result.success) {
    const status = result.error_type === "locked" ? 429 : 401;
    return NextResponse.json(result, { status });
  }

  // 2. Create / find the Supabase auth user for this email.
  const admin = getAdminClient();

  let authUserId: string | null = null;
  try {
    const { data: existingUsers } = await admin.auth.admin.listUsers();
    const found = existingUsers?.users?.find((u) => u.email === email);
    if (found) {
      authUserId = found.id;
    } else {
      const { data: newUser, error: createErr } =
        await admin.auth.admin.createUser({
          email,
          email_confirm: true,
        });
      if (createErr || !newUser.user) {
        throw new Error(
          `Failed to create auth user: ${createErr?.message ?? "unknown"}`
        );
      }
      authUserId = newUser.user.id;
    }
  } catch (err) {
    console.error("[verify-code] auth user setup failed:", err);
    return NextResponse.json(
      {
        success: false,
        error: "Something went wrong. Please try again.",
      },
      { status: 500 }
    );
  }

  // 3. Mirror the verify-pin flow: ensure an nsw_users row so existing
  //    subscription/purchase code can find the user. has_email=true
  //    because they verified via the email-gate flow.
  await serviceClient.from("nsw_users").upsert(
    {
      auth_user_id: authUserId,
      email,
      phone: result.phone,
      has_email: true,
      has_whatsapp: result.phone !== null,
    },
    { onConflict: "auth_user_id" }
  );

  // 4. Generate the magic-link token_hash for the client to exchange.
  const { data: linkData, error: linkErr } =
    await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
  if (linkErr || !linkData?.properties?.hashed_token) {
    console.error("[verify-code] generateLink failed:", linkErr);
    return NextResponse.json(
      {
        success: false,
        error: "Something went wrong. Please try again.",
      },
      { status: 500 }
    );
  }

  await logEvent({
    eventType: "auth.code_verified",
    userId: authUserId,
    metadata: {
      email_domain: email.split("@")[1] ?? "unknown",
      story_slug: result.story_slug,
      chapter: result.chapter,
    },
  });

  // The client calls supabase.auth.verifyOtp({ token_hash, type:
  // "magiclink" }) and is redirected to the chapter on success.
  return NextResponse.json({
    success: true,
    token_hash: linkData.properties.hashed_token,
    story_slug: result.story_slug,
    chapter: result.chapter,
  });
}
