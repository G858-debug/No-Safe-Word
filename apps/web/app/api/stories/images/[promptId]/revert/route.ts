import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// POST /api/stories/images/[promptId]/revert — Revert to the previous image
export async function POST(
  _request: NextRequest,
  props: { params: Promise<{ promptId: string }> }
) {
  const params = await props.params;
  const { promptId } = params;

  try {
    // 1. Fetch the prompt with previous_image_id
    const { data: imgPrompt, error: fetchError } = await supabase
      .from("story_image_prompts")
      .select("id, image_id, previous_image_id, status")
      .eq("id", promptId)
      .single();

    if (fetchError || !imgPrompt) {
      return NextResponse.json(
        { error: "Image prompt not found" },
        { status: 404 }
      );
    }

    if (!imgPrompt.previous_image_id) {
      return NextResponse.json(
        { error: "No previous image to revert to" },
        { status: 400 }
      );
    }

    // 2. Get the previous image's stored URL
    const { data: prevImage } = await supabase
      .from("images")
      .select("id, stored_url, sfw_url, nsfw_url")
      .eq("id", imgPrompt.previous_image_id)
      .single();

    if (!prevImage) {
      return NextResponse.json(
        { error: "Previous image record not found" },
        { status: 404 }
      );
    }

    const currentImageId = imgPrompt.image_id;

    // 3. Swap: restore previous image, save current as the new previous
    await supabase
      .from("story_image_prompts")
      .update({
        image_id: imgPrompt.previous_image_id,
        previous_image_id: currentImageId,
        status: "generated",
      })
      .eq("id", promptId);

    const imageUrl = prevImage.stored_url || prevImage.sfw_url || prevImage.nsfw_url;

    return NextResponse.json({
      imageId: prevImage.id,
      imageUrl,
    });
  } catch (err) {
    console.error("Revert failed:", err);
    return NextResponse.json(
      {
        error: "Revert failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
