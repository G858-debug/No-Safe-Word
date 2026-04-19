import { NextRequest, NextResponse } from "next/server";
import { verifyPin, normalizePhone } from "@/lib/server/pin-auth";
import { supabase as serviceClient } from "@no-safe-word/story-engine";
import { createClient as createAdminClient } from "@supabase/supabase-js";

/**
 * POST /api/auth/verify-pin
 *
 * Public endpoint called by the access page to verify a WhatsApp PIN.
 * On success, creates/finds a Supabase auth user and returns a token
 * the client can exchange for a session.
 */

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** Generate a synthetic email from a phone number for Supabase auth. */
function phoneToEmail(phone: string): string {
  return `wa${phone.replace("+", "")}@nosafeword.co.za`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.phone || typeof body.phone !== "string") {
      return NextResponse.json(
        { success: false, error: "Phone number is required." },
        { status: 400 }
      );
    }
    if (!body.pin || typeof body.pin !== "string" || !/^\d{4}$/.test(body.pin)) {
      return NextResponse.json(
        { success: false, error: "Please enter a 4-digit code." },
        { status: 400 }
      );
    }

    // Verify the PIN
    const result = await verifyPin({ phone: body.phone, pin: body.pin });

    if (!result.success) {
      const status = result.error_type === "locked" ? 429 : 400;
      return NextResponse.json(result, { status });
    }

    // PIN verified — create or find Supabase auth user
    const phone = normalizePhone(body.phone);
    const syntheticEmail = phoneToEmail(phone);
    const admin = getAdminClient();

    // Check if user already exists by phone in nsw_users
    const { data: existingNswUser } = await serviceClient
      .from("nsw_users")
      .select("id, auth_user_id")
      .eq("phone", phone)
      .single();

    let authUserId: string;

    if (existingNswUser?.auth_user_id) {
      authUserId = existingNswUser.auth_user_id;
    } else {
      // Check if auth user exists with this email
      const { data: existingUsers } = await admin.auth.admin.listUsers();
      const existingAuth = existingUsers?.users?.find(
        (u) => u.email === syntheticEmail || u.phone === phone
      );

      if (existingAuth) {
        authUserId = existingAuth.id;
      } else {
        // Create new auth user
        const { data: newUser, error: createError } = await admin.auth.admin.createUser({
          email: syntheticEmail,
          phone,
          email_confirm: true,
          phone_confirm: true,
        });
        if (createError || !newUser.user) {
          throw new Error(`Failed to create auth user: ${createError?.message}`);
        }
        authUserId = newUser.user.id;
      }

      // Upsert nsw_users record
      await serviceClient.from("nsw_users").upsert(
        {
          auth_user_id: authUserId,
          email: syntheticEmail,
          phone,
          has_whatsapp: true,
        },
        { onConflict: "auth_user_id" }
      );
    }

    // Generate a magic link token for the client to exchange for a session
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: syntheticEmail,
    });

    if (linkError || !linkData) {
      throw new Error(`Failed to generate session link: ${linkError?.message}`);
    }

    // Extract the token hash from the generated link
    const tokenHash = linkData.properties?.hashed_token;
    if (!tokenHash) {
      throw new Error("No token hash in generated link");
    }

    return NextResponse.json({
      success: true,
      token_hash: tokenHash,
      story_slug: result.story_slug,
      chapter: result.chapter,
      phone,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";

    if (message === "Invalid SA phone number") {
      return NextResponse.json(
        { success: false, error: "Please enter a valid South African phone number." },
        { status: 400 }
      );
    }

    console.error("Auth verify-pin failed:", err);
    return NextResponse.json(
      { success: false, error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
