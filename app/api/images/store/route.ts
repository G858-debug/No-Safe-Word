import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// POST /api/images/store — Download a Civitai blob URL and upload to Supabase Storage
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { blob_url, filename, image_id } = body as {
      blob_url: string;
      filename?: string;
      image_id?: string;
    };

    if (!blob_url) {
      return NextResponse.json(
        { error: "blob_url is required" },
        { status: 400 }
      );
    }

    // 1. Download the image from Civitai blob URL
    const imageResponse = await fetch(blob_url);
    if (!imageResponse.ok) {
      return NextResponse.json(
        { error: `Failed to download image: ${imageResponse.statusText}` },
        { status: 502 }
      );
    }

    const buffer = await imageResponse.arrayBuffer();
    const contentType =
      imageResponse.headers.get("content-type") || "image/jpeg";

    // 2. Generate a filename if not provided
    const ext = contentType.includes("png") ? "png" : "jpeg";
    const storagePath = `stories/${filename || `${crypto.randomUUID()}.${ext}`}`;

    // 3. Upload to Supabase Storage
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

    // 4. Get the public URL
    const {
      data: { publicUrl },
    } = supabase.storage.from("story-images").getPublicUrl(storagePath);

    // 5. Update the image record with the stored URL if image_id provided
    if (image_id) {
      await supabase
        .from("images")
        .update({ stored_url: publicUrl })
        .eq("id", image_id);
    }

    return NextResponse.json({
      stored_url: publicUrl,
      storage_path: storagePath,
    });
  } catch (err) {
    console.error("Image store failed:", err);
    return NextResponse.json(
      {
        error: "Failed to store image",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
