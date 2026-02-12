import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// POST /api/stories/images/[promptId]/approve — Approve a generated story image
export async function POST(
  _request: NextRequest,
  props: { params: Promise<{ promptId: string }> }
) {
  const params = await props.params;
  const { promptId } = params;

  try {
    // 1. Fetch the image prompt with its linked image
    const { data: imgPrompt, error: fetchError } = await supabase
      .from("story_image_prompts")
      .select("id, image_id, status")
      .eq("id", promptId)
      .single();

    if (fetchError || !imgPrompt) {
      return NextResponse.json(
        { error: "Image prompt not found" },
        { status: 404 }
      );
    }

    if (!imgPrompt.image_id) {
      return NextResponse.json(
        { error: "No image linked to this prompt — generate one first" },
        { status: 400 }
      );
    }

    // 2. Fetch the image to get its blob URL
    const { data: image, error: imgError } = await supabase
      .from("images")
      .select("id, sfw_url, nsfw_url, stored_url")
      .eq("id", imgPrompt.image_id)
      .single();

    if (imgError || !image) {
      return NextResponse.json(
        { error: "Linked image record not found" },
        { status: 404 }
      );
    }

    // If already stored, just approve without re-uploading
    if (image.stored_url) {
      const { data: updated, error: updateError } = await supabase
        .from("story_image_prompts")
        .update({ status: "approved" })
        .eq("id", promptId)
        .select()
        .single();

      if (updateError) {
        return NextResponse.json(
          { error: updateError.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        image_prompt: updated,
        stored_url: image.stored_url,
      });
    }

    // 3. Download the Civitai blob
    const blobUrl = image.sfw_url || image.nsfw_url;
    if (!blobUrl) {
      return NextResponse.json(
        {
          error:
            "Image has no blob URL yet — is the generation complete?",
        },
        { status: 400 }
      );
    }

    const imageResponse = await fetch(blobUrl);
    if (!imageResponse.ok) {
      return NextResponse.json(
        { error: `Failed to download image: ${imageResponse.statusText}` },
        { status: 502 }
      );
    }

    const buffer = await imageResponse.arrayBuffer();
    const contentType =
      imageResponse.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png") ? "png" : "jpeg";
    const storagePath = `stories/${image.id}.${ext}`;

    // 4. Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("story-images")
      .upload(storagePath, buffer, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      return NextResponse.json(
        { error: `Storage upload failed: ${uploadError.message}` },
        { status: 500 }
      );
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("story-images").getPublicUrl(storagePath);

    // 5. Update the image record with the stored URL
    await supabase
      .from("images")
      .update({ stored_url: publicUrl })
      .eq("id", image.id);

    // 6. Approve the image prompt
    const { data: updated, error: updateError } = await supabase
      .from("story_image_prompts")
      .update({ status: "approved" })
      .eq("id", promptId)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      image_prompt: updated,
      stored_url: publicUrl,
    });
  } catch (err) {
    console.error("Image approval failed:", err);
    return NextResponse.json(
      {
        error: "Approval failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
