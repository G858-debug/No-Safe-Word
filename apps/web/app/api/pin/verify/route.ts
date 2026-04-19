import { NextRequest, NextResponse } from "next/server";
import { verifyPin } from "@/lib/server/pin-auth";

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
    if (!body.pin || typeof body.pin !== "string" || !/^\d{4}$/.test(body.pin)) {
      return NextResponse.json(
        { success: false, error: "Missing or invalid 'pin' field (must be 4 digits)" },
        { status: 400 }
      );
    }

    const result = await verifyPin({
      phone: body.phone,
      pin: body.pin,
    });

    if (!result.success) {
      const status = result.error_type === "locked" ? 429 : 400;
      return NextResponse.json(result, { status });
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";

    if (message === "Invalid SA phone number") {
      return NextResponse.json(
        { success: false, error: message },
        { status: 400 }
      );
    }

    console.error("PIN verify failed:", err);
    return NextResponse.json(
      { success: false, error: "Internal error" },
      { status: 500 }
    );
  }
}
