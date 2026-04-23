import { NextRequest, NextResponse } from "next/server";
import { validateImportPayload } from "@no-safe-word/shared";
import { importStory } from "@no-safe-word/story-engine";

// POST /api/webhook/story-import — Webhook for receiving story JSON
//
// Pipeline entry point (Stage 7). The imported series starts with
// cover_status='pending' and null blurb variants; cover generation
// and blurb selection run in a dedicated post-import workflow
// (Stage 8½) that sits between character approval (Stage 8) and
// scene image generation (Stage 9). Covers always use Flux 2 Dev
// regardless of the story's image_model — see CLAUDE.md.
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
