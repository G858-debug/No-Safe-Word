import { NextRequest, NextResponse } from "next/server";
import { validateImportPayload } from "@/lib/story-types";
import { importStory } from "@/lib/story-import";

// POST /api/webhook/story-import — Webhook for receiving story JSON
export async function POST(request: NextRequest) {
  try {
    // 1. Auth check
    const webhookSecret = process.env.WEBHOOK_SECRET;
    if (!webhookSecret) {
      return NextResponse.json(
        {
          error: "Webhook not configured",
          details: "Set the WEBHOOK_SECRET environment variable",
        },
        { status: 500 }
      );
    }

    const providedSecret = request.headers.get("X-Webhook-Secret");
    if (!providedSecret || providedSecret !== webhookSecret) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // 2. Parse and validate payload
    const body = await request.json();

    const validation = validateImportPayload(body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: "Invalid import payload", details: validation.errors },
        { status: 400 }
      );
    }

    // 3. Import the story
    const result = await importStory(validation.payload);

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("Webhook story import failed:", err);
    return NextResponse.json(
      {
        error: "Import failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
