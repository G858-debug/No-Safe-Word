import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { imageUrlToBase64 } from "@no-safe-word/image-gen";
import { concatImagesVertically } from "@/lib/server/image-concat";

// POST /api/stories/characters/[storyCharId]/stitch-preview
// Stitches the approved face portrait on top of a body image for preview display.
// Returns { preview_url: "data:image/png;base64,..." }
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const { storyCharId } = await props.params;

  try {
    const { body_image_url } = (await request.json()) as { body_image_url: string };

    if (!body_image_url) {
      return NextResponse.json({ error: "body_image_url is required" }, { status: 400 });
    }

    // 1. Fetch the story_character to get the approved face image
    const { data: storyChar, error: scError } = await supabase
      .from("story_characters")
      .select("approved_image_id")
      .eq("id", storyCharId)
      .single();

    if (scError || !storyChar) {
      return NextResponse.json({ error: "Story character not found" }, { status: 404 });
    }

    if (!storyChar.approved_image_id) {
      console.log(`[CharGen] No approved face for stitching — returning body only`);
      return NextResponse.json({ preview_url: null });
    }

    // 2. Get the face image URL
    const { data: faceImage, error: faceError } = await supabase
      .from("images")
      .select("stored_url, sfw_url")
      .eq("id", storyChar.approved_image_id)
      .single();

    if (faceError || !faceImage) {
      console.log(`[CharGen] Face image record not found — returning body only`);
      return NextResponse.json({ preview_url: null });
    }

    const faceUrl = faceImage.stored_url || faceImage.sfw_url;
    if (!faceUrl) {
      console.log(`[CharGen] Face image has no URL — returning body only`);
      return NextResponse.json({ preview_url: null });
    }

    // 3. Fetch both images as base64
    const [faceBase64, bodyBase64] = await Promise.all([
      imageUrlToBase64(faceUrl),
      imageUrlToBase64(body_image_url),
    ]);

    // 4. Stitch face on top of body
    const stitchedBase64 = await concatImagesVertically(faceBase64, bodyBase64, 768);

    console.log(`[CharGen] Stitched face+body preview for ${storyCharId} (${Math.round(stitchedBase64.length / 1024)}KB)`);

    return NextResponse.json({
      preview_url: `data:image/png;base64,${stitchedBase64}`,
    });
  } catch (err) {
    console.error(`[CharGen] Stitching failed for ${storyCharId}:`, err);
    // Non-fatal — return null so the UI falls back to showing body only
    return NextResponse.json({ preview_url: null });
  }
}
