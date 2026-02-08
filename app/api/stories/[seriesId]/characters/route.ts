import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/stories/[seriesId]/characters — List characters linked to this series
export async function GET(
  _request: NextRequest,
  { params }: { params: { seriesId: string } }
) {
  const { seriesId } = params;

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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!storyCharacters || storyCharacters.length === 0) {
    return NextResponse.json({ characters: [] });
  }

  // Fetch stored_url for any approved images
  const approvedImageIds = storyCharacters
    .map((sc) => sc.approved_image_id)
    .filter((id): id is string => id !== null);

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
    }
  }

  const characters = storyCharacters.map((sc) => ({
    ...sc,
    approved_image_url: sc.approved_image_id
      ? imageUrls[sc.approved_image_id] || null
      : null,
  }));

  return NextResponse.json({ characters });
}
