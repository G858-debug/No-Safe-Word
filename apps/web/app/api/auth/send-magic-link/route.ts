import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/auth/send-magic-link
 *
 * Public endpoint called by the access page to send an email magic link.
 * Uses Supabase's built-in OTP system.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.email || typeof body.email !== "string") {
      return NextResponse.json(
        { success: false, error: "Email is required." },
        { status: 400 }
      );
    }

    const email = body.email.trim().toLowerCase();

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { success: false, error: "Please enter a valid email address." },
        { status: 400 }
      );
    }

    // Build redirect URL with story context
    const storySlug = body.story_slug || "";
    const chapter = body.chapter || 1;
    const origin = process.env.NEXT_PUBLIC_SITE_URL || "https://nosafeword.co.za";
    const redirectTo = `${origin}/auth/callback?story=${encodeURIComponent(storySlug)}&chapter=${chapter}`;

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });

    if (error) {
      console.error("Magic link send failed:", error);
      return NextResponse.json(
        { success: false, error: "Failed to send email. Please try again." },
        { status: 500 }
      );
    }

    // Mask the email for display
    const [local, domain] = email.split("@");
    const masked = local.slice(0, 2) + "***@" + domain;

    return NextResponse.json({
      success: true,
      masked_email: masked,
    });
  } catch (err) {
    console.error("Auth send-magic-link failed:", err);
    return NextResponse.json(
      { success: false, error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
