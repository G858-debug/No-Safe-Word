import { NextRequest, NextResponse } from "next/server";
import { sendPin } from "@/lib/server/pin-auth";

const PIN_API_SECRET = process.env.PIN_API_SECRET;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Auth
    if (!PIN_API_SECRET || body.secret !== PIN_API_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Validate required fields
    if (!body.phone || typeof body.phone !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing or invalid 'phone' field" },
        { status: 400 }
      );
    }
    if (!body.story_slug || typeof body.story_slug !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing or invalid 'story_slug' field" },
        { status: 400 }
      );
    }
    if (typeof body.chapter !== "number" || body.chapter < 1) {
      return NextResponse.json(
        { success: false, error: "Missing or invalid 'chapter' field" },
        { status: 400 }
      );
    }

    const result = await sendPin({
      phone: body.phone,
      storySlug: body.story_slug,
      chapter: body.chapter,
    });

    if (!result.success) {
      const status = result.retry_after_seconds ? 429 : 400;
      const headers: Record<string, string> = {};
      if (result.retry_after_seconds) {
        headers["Retry-After"] = result.retry_after_seconds.toString();
      }
      return NextResponse.json(result, { status, headers });
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";

    // Phone validation errors → 400
    if (message === "Invalid SA phone number") {
      return NextResponse.json(
        { success: false, error: message },
        { status: 400 }
      );
    }

    console.error("PIN send failed:", err);
    return NextResponse.json(
      { success: false, error: "Internal error" },
      { status: 500 }
    );
  }
}
