import { NextRequest, NextResponse } from "next/server";
import { validateImportPayload } from "@/lib/story-types";
import { importStory } from "@/lib/story-import";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // 1. Validate the payload
    const validation = validateImportPayload(body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: "Invalid import payload", details: validation.errors },
        { status: 400 }
      );
    }

    const payload = validation.payload;
    const result = await importStory(payload);

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("Story import failed:", err);
    return NextResponse.json(
      {
        error: "Import failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
