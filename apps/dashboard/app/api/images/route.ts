import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import type { ImageRow } from "@no-safe-word/shared";

// GET /api/images - List images, optionally filtered by character_id
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const characterId = searchParams.get("character_id");
  const mode = searchParams.get("mode");
  const limit = Number(searchParams.get("limit") ?? "50");
  const offset = Number(searchParams.get("offset") ?? "0");

  let query = supabase
    .from("images")
    .select("*, characters(id, name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (characterId) {
    query = query.eq("character_id", characterId);
  }
  if (mode === "sfw" || mode === "nsfw") {
    query = query.eq("mode", mode);
  }

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ images: data, total: count });
}

// POST /api/images - Save a generated image
export async function POST(request: NextRequest) {
  const body = await request.json();

  const {
    character_id,
    sfw_url,
    nsfw_url,
    prompt,
    negative_prompt,
    settings,
    mode,
    job_id,
  } = body;

  if (!prompt) {
    return NextResponse.json(
      { error: "Prompt is required" },
      { status: 400 }
    );
  }

  if (!mode || (mode !== "sfw" && mode !== "nsfw")) {
    return NextResponse.json(
      { error: "Mode must be 'sfw' or 'nsfw'" },
      { status: 400 }
    );
  }

  // Insert image record
  const { data, error: imageError } = await supabase
    .from("images")
    .insert({
      character_id: character_id || null,
      sfw_url: sfw_url || null,
      nsfw_url: nsfw_url || null,
      prompt,
      negative_prompt: negative_prompt ?? "",
      settings: settings ?? {},
      mode,
    })
    .select()
    .single();

  const image = data as ImageRow | null;

  if (imageError || !image) {
    return NextResponse.json(
      { error: imageError?.message ?? "Failed to insert image" },
      { status: 500 }
    );
  }

  // If a Civitai job_id was provided, create a generation_jobs record linked to this image
  if (job_id) {
    const { error: jobError } = await supabase
      .from("generation_jobs")
      .insert({
        job_id,
        image_id: image.id,
        status: sfw_url || nsfw_url ? "completed" : "pending",
        completed_at: sfw_url || nsfw_url ? new Date().toISOString() : null,
      });

    if (jobError) {
      // Image was saved but job tracking failed — return image with warning
      return NextResponse.json(
        { ...image, _warning: `Job tracking failed: ${jobError.message}` },
        { status: 201 }
      );
    }
  }

  return NextResponse.json(image, { status: 201 });
}

// DELETE /api/images - Delete an image
export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const { id } = body;

  if (!id) {
    return NextResponse.json(
      { error: "Image id is required" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("images")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
