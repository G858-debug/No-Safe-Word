import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { cleanupOrphanedImage } from "@/lib/server/cleanup-orphaned-image";

// POST /api/stories/characters/[storyCharId]/discard-candidate
//
// Tear down a candidate pair the user chose not to promote. Body fields are
// nullable independently — regenerate-body-only produces a candidate with
// only a body image (face stays the approved one), so candidate_face_image_id
// will be null on that path.
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const { storyCharId } = await props.params;

  try {
    const body = await request.json();
    const {
      candidate_face_image_id,
      candidate_body_image_id,
    } = body as {
      candidate_face_image_id?: string | null;
      candidate_body_image_id?: string;
    };

    if (!candidate_body_image_id) {
      return NextResponse.json(
        { error: "candidate_body_image_id is required" },
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

    // Authorize each candidate id against the base character before tearing
    // down. Without this check a malicious caller could pass any image_id
    // and delete arbitrary rows.
    const candidateIds: string[] = [candidate_body_image_id];
    if (candidate_face_image_id) candidateIds.push(candidate_face_image_id);

    const { data: candidateImages } = await supabase
      .from("images")
      .select("id, character_id")
      .in("id", candidateIds);

    for (const id of candidateIds) {
      const row = candidateImages?.find((r) => r.id === id);
      if (!row) {
        return NextResponse.json(
          { error: `Image ${id} not found` },
          { status: 400 }
        );
      }
      if (row.character_id !== storyChar.character_id) {
        return NextResponse.json(
          { error: `Image ${id} does not belong to this character` },
          { status: 403 }
        );
      }
    }

    const errors: Array<{ image_id: string; errors: string[] }> = [];
    const r1 = await cleanupOrphanedImage(supabase, candidate_body_image_id);
    if (!r1.ok)
      errors.push({ image_id: candidate_body_image_id, errors: r1.errors });
    if (candidate_face_image_id) {
      const r2 = await cleanupOrphanedImage(
        supabase,
        candidate_face_image_id
      );
      if (!r2.ok)
        errors.push({
          image_id: candidate_face_image_id,
          errors: r2.errors,
        });
    }

    return NextResponse.json({ ok: errors.length === 0, errors });
  } catch (err) {
    console.error("[discard-candidate] error:", err);
    return NextResponse.json(
      {
        error: "Discard failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
