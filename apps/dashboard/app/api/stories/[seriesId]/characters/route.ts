import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// GET /api/stories/[seriesId]/characters — List characters linked to this series
export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const params = await props.params;
  const { seriesId } = params;

  console.log(`[StoryPublisher] Loading characters for series: ${seriesId}`);

  const { data: storyCharacters, error } = await supabase
    .from("story_characters")
    .select(
      `
      id, role, prose_description, approved, approved_image_id, approved_seed,
      characters:character_id (id, name, description)
    `
    )
    .eq("series_id", seriesId);

  if (error) {
    console.error(`[StoryPublisher] Failed to load characters:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!storyCharacters || storyCharacters.length === 0) {
    console.log(`[StoryPublisher] No characters found for series ${seriesId}`);
    return NextResponse.json({ characters: [] });
  }

  console.log(`[StoryPublisher] Found ${storyCharacters.length} characters`);

  // Fetch stored_url for any approved images
  const approvedImageIds = storyCharacters
    .map((sc) => sc.approved_image_id)
    .filter((id): id is string => id !== null);

  console.log(`[StoryPublisher] Fetching image URLs for ${approvedImageIds.length} approved images`);

  let imageUrls: Record<string, string> = {};
  if (approvedImageIds.length > 0) {
    const { data: images } = await supabase
      .from("images")
      .select("id, stored_url, sfw_url")
      .in("id", approvedImageIds);

    if (images) {
      imageUrls = Object.fromEntries(
        images.map((img) => [img.id, img.stored_url || img.sfw_url || ""])
      );
      console.log(`[StoryPublisher] Loaded ${images.length} image URLs:`, imageUrls);
    }
  }

  const characters = storyCharacters.map((sc) => {
    // Check for pending image in prose_description metadata
    const pendingImageId =
      typeof sc.prose_description === "object" && sc.prose_description !== null
        ? (sc.prose_description as Record<string, unknown>)._pending_image_id as string | undefined
        : undefined;
    const pendingImageUrl =
      typeof sc.prose_description === "object" && sc.prose_description !== null
        ? (sc.prose_description as Record<string, unknown>)._pending_image_url as string | undefined
        : undefined;

    return {
      ...sc,
      approved_image_url: sc.approved_image_id
        ? imageUrls[sc.approved_image_id] || null
        : null,
      pending_image_id: pendingImageId || null,
      pending_image_url: pendingImageUrl || null,
    };
  });

  console.log(`[StoryPublisher] Returning ${characters.length} characters with image data`);
  return NextResponse.json({ characters });
}
