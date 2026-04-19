import { NextRequest, NextResponse } from "next/server";
import { validateImportPayload, type ImageModel } from "@no-safe-word/shared";
import { importStory } from "@no-safe-word/story-engine";

const VALID_MODELS: ImageModel[] = ["flux2_dev", "hunyuan3"];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Optional top-level `image_model` selects the generation backend.
    // Defaults to 'flux2_dev' if absent or invalid.
    let imageModel: ImageModel = "flux2_dev";
    if (typeof body?.image_model === "string" && VALID_MODELS.includes(body.image_model as ImageModel)) {
      imageModel = body.image_model as ImageModel;
    }

    // 1. Validate the payload (ignores top-level image_model)
    const validation = validateImportPayload(body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: "Invalid import payload", details: validation.errors },
        { status: 400 }
      );
    }

    const payload = validation.payload;
    const result = await importStory(payload, { imageModel });

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
