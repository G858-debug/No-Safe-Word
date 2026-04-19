import { NextRequest, NextResponse } from "next/server";
import { sendPin } from "@/lib/server/pin-auth";

/**
 * POST /api/auth/send-pin
 *
 * Public endpoint called by the access page to send a WhatsApp PIN.
 * Rate-limited internally by sendPin() (3 per phone per hour).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.phone || typeof body.phone !== "string") {
      return NextResponse.json(
        { success: false, error: "Phone number is required." },
        { status: 400 }
      );
    }

    const result = await sendPin({
      phone: body.phone,
      storySlug: body.story_slug || "unknown",
      chapter: typeof body.chapter === "number" ? body.chapter : 1,
    });

    if (!result.success) {
      const status = result.retry_after_seconds ? 429 : 400;
      return NextResponse.json(result, { status });
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";

    if (message === "Invalid SA phone number") {
      return NextResponse.json(
        { success: false, error: "Please enter a valid South African phone number." },
        { status: 400 }
      );
    }

    console.error("Auth send-pin failed:", err);
    return NextResponse.json(
      { success: false, error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
