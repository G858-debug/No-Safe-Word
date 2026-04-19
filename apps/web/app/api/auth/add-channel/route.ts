import { NextRequest, NextResponse } from "next/server";
import { supabase as serviceClient } from "@no-safe-word/story-engine";
import { normalizePhone } from "@/lib/server/pin-auth";

/**
 * POST /api/auth/add-channel
 *
 * Adds a second contact channel (email or WhatsApp) to the reader's profile.
 * Called after primary auth to unlock the "both channels" bonus.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { channel, phone, email } = body;

    if (channel !== "email" && channel !== "whatsapp") {
      return NextResponse.json(
        { success: false, error: "Invalid channel." },
        { status: 400 }
      );
    }

    // Find the user by their primary auth identifier
    // After WhatsApp auth, we look up by phone; after email auth, by email
    let nswUser: { id: string; has_whatsapp: boolean; has_email: boolean } | null = null;

    if (phone) {
      const normalized = normalizePhone(phone);
      const { data } = await serviceClient
        .from("nsw_users")
        .select("id, has_whatsapp, has_email")
        .eq("phone", normalized)
        .single();
      nswUser = data;
    }

    if (!nswUser && email) {
      const { data } = await serviceClient
        .from("nsw_users")
        .select("id, has_whatsapp, has_email")
        .eq("email", email.trim().toLowerCase())
        .single();
      nswUser = data;
    }

    if (!nswUser) {
      return NextResponse.json(
        { success: false, error: "User not found." },
        { status: 404 }
      );
    }

    // Build the update
    const updates: Record<string, unknown> = {};

    if (channel === "email") {
      if (!body.add_email || typeof body.add_email !== "string" || !body.add_email.includes("@")) {
        return NextResponse.json(
          { success: false, error: "Please enter a valid email." },
          { status: 400 }
        );
      }
      updates.email = body.add_email.trim().toLowerCase();
      updates.has_email = true;
    }

    if (channel === "whatsapp") {
      if (!body.add_phone || typeof body.add_phone !== "string") {
        return NextResponse.json(
          { success: false, error: "Please enter a valid phone number." },
          { status: 400 }
        );
      }
      updates.phone = normalizePhone(body.add_phone);
      updates.has_whatsapp = true;
    }

    // Check if both channels are now present
    const willHaveWhatsapp = channel === "whatsapp" ? true : nswUser.has_whatsapp;
    const willHaveEmail = channel === "email" ? true : nswUser.has_email;
    if (willHaveWhatsapp && willHaveEmail) {
      updates.both_channels_bonus = true;
    }

    await serviceClient
      .from("nsw_users")
      .update(updates)
      .eq("id", nswUser.id);

    return NextResponse.json({
      success: true,
      both_channels_bonus: willHaveWhatsapp && willHaveEmail,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";

    if (message === "Invalid SA phone number") {
      return NextResponse.json(
        { success: false, error: "Please enter a valid South African phone number." },
        { status: 400 }
      );
    }

    console.error("Add channel failed:", err);
    return NextResponse.json(
      { success: false, error: "Something went wrong." },
      { status: 500 }
    );
  }
}
