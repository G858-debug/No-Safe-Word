import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// POST /api/stories/characters/[storyCharId]/approve — Approve a character image
export async function POST(
  request: NextRequest,
  { params }: { params: { storyCharId: string } }
) {
  const { storyCharId } = params;

  try {
    const body = await request.json();
    const { image_id, seed } = body as {
      image_id: string;
      seed?: number;
    };

    console.log(`[StoryPublisher] Approving character ${storyCharId}, image_id: ${image_id}, seed: ${seed}`);

    if (!image_id) {
      console.error(`[StoryPublisher] Approval failed: no image_id provided`);
      return NextResponse.json(
        { error: "image_id is required" },
        { status: 400 }
      );
    }

    // 1. Verify the story character exists
    const { data: storyChar, error: scError } = await supabase
      .from("story_characters")
      .select("id")
      .eq("id", storyCharId)
      .single();

    if (scError || !storyChar) {
      return NextResponse.json(
        { error: "Story character not found" },
        { status: 404 }
      );
    }

    // 2. Fetch the image to get its blob URL
    const { data: image, error: imgError } = await supabase
      .from("images")
      .select("id, sfw_url")
      .eq("id", image_id)
      .single();

    if (imgError || !image) {
      return NextResponse.json(
        { error: "Image not found" },
        { status: 404 }
      );
    }

    if (!image.sfw_url) {
      return NextResponse.json(
        { error: "Image has no blob URL yet — is the generation complete?" },
        { status: 400 }
      );
    }

    // 3. Download the Civitai blob and upload to Supabase Storage
    console.log(`[StoryPublisher] Downloading image from: ${image.sfw_url}`);
    const imageResponse = await fetch(image.sfw_url);
    if (!imageResponse.ok) {
      console.error(`[StoryPublisher] Failed to download image: ${imageResponse.statusText}`);
      return NextResponse.json(
        { error: `Failed to download image: ${imageResponse.statusText}` },
        { status: 502 }
      );
    }

    const buffer = await imageResponse.arrayBuffer();
    const contentType =
      imageResponse.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png") ? "png" : "jpeg";
    const storagePath = `characters/${image_id}.${ext}`;

    console.log(`[StoryPublisher] Uploading to Supabase Storage: ${storagePath}`);
    const { error: uploadError } = await supabase.storage
      .from("story-images")
      .upload(storagePath, buffer, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      console.error(`[StoryPublisher] Storage upload failed:`, uploadError);
      return NextResponse.json(
        { error: `Storage upload failed: ${uploadError.message}` },
        { status: 500 }
      );
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("story-images").getPublicUrl(storagePath);
    console.log(`[StoryPublisher] Image stored at: ${publicUrl}`);

    // 4. Update the image record with the stored URL
    await supabase
      .from("images")
      .update({ stored_url: publicUrl })
      .eq("id", image_id);

    // 5. Approve the story character
    console.log(`[StoryPublisher] Updating story_characters to mark as approved`);
    const { data: updated, error: updateError } = await supabase
      .from("story_characters")
      .update({
        approved: true,
        approved_image_id: image_id,
        approved_seed: seed ?? null,
      })
      .eq("id", storyCharId)
      .select("*, series_id")
      .single();

    if (updateError) {
      console.error(`[StoryPublisher] Failed to approve character:`, updateError);
      return NextResponse.json(
        { error: `Failed to approve character: ${updateError.message}` },
        { status: 500 }
      );
    }

    console.log(`[StoryPublisher] Character approved successfully: ${storyCharId}`);

    // 6. Check if all characters are now approved and update series status
    if (updated) {
      const { data: allChars } = await supabase
        .from("story_characters")
        .select("id, approved")
        .eq("series_id", updated.series_id);

      if (allChars && allChars.length > 0) {
        const allApproved = allChars.every((ch) => ch.approved);
        if (allApproved) {
          console.log(`[StoryPublisher] All characters approved for series ${updated.series_id}, updating series status`);
          await supabase
            .from("story_series")
            .update({ status: "images_pending" })
            .eq("id", updated.series_id);
        }
      }
    }

    return NextResponse.json({
      story_character: updated,
      stored_url: publicUrl,
    });
  } catch (err) {
    console.error("Character approval failed:", err);
    return NextResponse.json(
      {
        error: "Approval failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
