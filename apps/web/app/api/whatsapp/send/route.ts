import { NextRequest, NextResponse } from "next/server";
import { validateSessionToken, COOKIE_NAME } from "@/lib/admin-auth";
import { sendWhatsAppMessage } from "@/lib/server/whatsapp-client";

// POST /api/whatsapp/send — Send a WhatsApp message via OpenClaw
export async function POST(request: NextRequest) {
  try {
    // Auth: require admin session cookie
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (!token || !(await validateSessionToken(token))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    // Validate payload
    if (!body.to || typeof body.to !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'to' field (phone number)" },
        { status: 400 }
      );
    }
    if (!body.message || typeof body.message !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'message' field" },
        { status: 400 }
      );
    }

    const result = await sendWhatsAppMessage({
      to: body.to,
      message: body.message,
      media: body.media,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("WhatsApp send failed:", err);
    return NextResponse.json(
      {
        error: "Send failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
