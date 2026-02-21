import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// POST /api/stories/characters/[storyCharId]/set-pending-image — Link a generated image as pending
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    const body = await request.json();
    const { image_id, image_url, type: imageType } = body as {
      image_id: string;
      image_url: string;
      type?: "portrait" | "fullBody";
    };
    const isFullBody = imageType === "fullBody";

    console.log(`[StoryPublisher] Setting pending image for character ${storyCharId}: imageId=${image_id}, url=${image_url}`);

    if (!image_id) {
      return NextResponse.json(
        { error: "image_id is required" },
        { status: 400 }
      );
    }

    // Update story_characters with the pending image info
    // Store in prose_description JSON field temporarily (we can use a custom field if needed)
    const { data: storyChar, error: fetchError } = await supabase
      .from("story_characters")
      .select("prose_description")
      .eq("id", storyCharId)
      .single();

    if (fetchError || !storyChar) {
      console.error(`[StoryPublisher] Story character not found:`, fetchError);
      return NextResponse.json(
        { error: "Story character not found" },
        { status: 404 }
      );
    }

    // Add pending_image metadata to prose_description JSON
    const metadata = isFullBody
      ? {
          _pending_fullbody_image_id: image_id,
          _pending_fullbody_image_url: image_url,
          _updated_at: new Date().toISOString(),
        }
      : {
          _pending_image_id: image_id,
          _pending_image_url: image_url,
          _updated_at: new Date().toISOString(),
        };

    const { error: updateError } = await supabase
      .from("story_characters")
      .update({
        prose_description: {
          ...(typeof storyChar.prose_description === "object" ? storyChar.prose_description : {}),
          ...metadata,
        } as unknown as string, // JSONB field typed as string in client
      })
      .eq("id", storyCharId);

    if (updateError) {
      console.error(`[StoryPublisher] Failed to update pending image:`, updateError);
      return NextResponse.json(
        { error: `Failed to update: ${updateError.message}` },
        { status: 500 }
      );
    }

    console.log(`[StoryPublisher] Successfully set pending image for ${storyCharId}`);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[StoryPublisher] Set pending image failed:", err);
    return NextResponse.json(
      {
        error: "Failed to set pending image",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
