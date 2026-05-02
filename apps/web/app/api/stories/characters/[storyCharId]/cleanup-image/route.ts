import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { cleanupOrphanedImage } from "@/lib/server/cleanup-orphaned-image";

// POST /api/stories/characters/[storyCharId]/cleanup-image
//
// Authorized wrapper around cleanupOrphanedImage scoped to a single
// character. Used by client cancel / regenerate-from-pre-approval / failure
// rollback flows. We don't extend DELETE /api/images because that route's
// blast radius is wider — this route guarantees the image being torn down
// is one the calling character actually owns.
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const { storyCharId } = await props.params;

  try {
    const body = await request.json();
    const { image_id } = body as { image_id?: string };

    if (!image_id) {
      return NextResponse.json(
        { error: "image_id is required" },
        { status: 400 }
      );
    }

    const { data: storyChar } = await supabase
      .from("story_characters")
      .select("id, character_id")
      .eq("id", storyCharId)
      .single();
    if (!storyChar) {
      return NextResponse.json(
        { error: "Story character not found" },
        { status: 404 }
      );
    }

    const { data: image } = await supabase
      .from("images")
      .select("id, character_id")
      .eq("id", image_id)
      .single();
    if (!image) {
      // Already gone — idempotent success.
      return NextResponse.json({ ok: true, errors: [] });
    }
    if (image.character_id !== storyChar.character_id) {
      return NextResponse.json(
        { error: "image does not belong to this character" },
        { status: 403 }
      );
    }

    const result = await cleanupOrphanedImage(supabase, image_id);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[cleanup-image] error:", err);
    return NextResponse.json(
      {
        error: "Cleanup failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
