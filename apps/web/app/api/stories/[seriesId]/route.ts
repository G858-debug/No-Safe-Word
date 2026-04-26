import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// GET /api/stories/[seriesId] — Full series with all related data
export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const params = await props.params;
  const { seriesId } = params;

  // Fetch series
  const { data: series, error: seriesError } = await supabase
    .from("story_series")
    .select("*")
    .eq("id", seriesId)
    .single();

  if (seriesError || !series) {
    return NextResponse.json(
      { error: "Series not found" },
      { status: 404 }
    );
  }

  // Fetch posts with their image prompts
  const { data: posts } = await supabase
    .from("story_posts")
    .select(
      `
      *,
      story_image_prompts (
        id, image_type, pairs_with, position, position_after_word,
        character_name, character_id, secondary_character_id, secondary_character_name,
        prompt, image_id, previous_image_id, status, character_block_override, secondary_character_block_override
      )
    `
    )
    .eq("series_id", seriesId)
    .order("part_number", { ascending: true });

  // Fetch characters linked to this series
  const { data: storyCharacters } = await supabase
    .from("story_characters")
    .select(
      `
      *,
      characters:character_id (id, name, description)
    `
    )
    .eq("series_id", seriesId);

  // Fetch stored image URLs for any approved/generated images
  const allImageIds = (posts || [])
    .flatMap((p) =>
      (p.story_image_prompts || [])
        .map((ip: any) => ip.image_id)
        .filter((id: any): id is string => id !== null)
    );

  let imageUrls: Record<string, string> = {};
  if (allImageIds.length > 0) {
    const { data: images } = await supabase
      .from("images")
      .select("id, stored_url, sfw_url, nsfw_url")
      .in("id", allImageIds);

    if (images) {
      imageUrls = Object.fromEntries(
        images.map((img) => [
          img.id,
          img.stored_url || img.sfw_url || img.nsfw_url || "",
        ])
      );
    }
  }

  // Count image prompt statuses
  const allPrompts = (posts || []).flatMap(
    (p) => p.story_image_prompts || []
  );

  const imageCounts = {
    total: allPrompts.length,
    pending: allPrompts.filter((p: { status: string }) => p.status === "pending").length,
    generating: allPrompts.filter((p: { status: string }) => p.status === "generating").length,
    generated: allPrompts.filter((p: { status: string }) => p.status === "generated").length,
    approved: allPrompts.filter((p: { status: string }) => p.status === "approved").length,
    failed: allPrompts.filter((p: { status: string }) => p.status === "failed").length,
  };

  // When cover is actively generating, include per-variant job states so the
  // status pill and cover approval UI can show "Queued" vs "Generating" without
  // re-polling RunPod on every page load.  The cover-variant-handler writes
  // 'processing' to generation_jobs.status when RunPod returns IN_PROGRESS.
  let coverJobStates: Array<{
    variant_index: number;
    status: string;
    created_at: string;
    job_id: string;
  }> = [];
  if (series.cover_status === "generating") {
    const { data: coverJobs } = await supabase
      .from("generation_jobs")
      .select("variant_index, status, created_at, job_id")
      .eq("series_id", seriesId)
      .eq("job_type", "cover_variant")
      .in("status", ["pending", "processing"]);
    coverJobStates = (coverJobs ?? []) as typeof coverJobStates;
  }

  return NextResponse.json({
    series,
    posts: posts || [],
    characters: storyCharacters || [],
    image_urls: imageUrls,
    image_prompt_counts: imageCounts,
    cover_job_states: coverJobStates,
  });
}

// PATCH /api/stories/[seriesId] — Update series metadata
export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const params = await props.params;
  const { seriesId } = params;
  const body = await request.json();

  // Note: `image_model` is editable here only while the series is unlocked
  // (no portraits generated yet). For locked series, use POST
  // /api/stories/[seriesId]/change-image-model which resets downstream state.
  const allowedFields = ["title", "description", "hashtag", "status", "marketing", "image_model", "inpaint_prompt", "sfw_inpaint_prompt"];
  const updates: Record<string, unknown> = {};

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates[field] = body[field];
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("story_series")
    .update(updates)
    .eq("id", seriesId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ series: data });
}

// DELETE /api/stories/[seriesId] — Archive (soft delete)
export async function DELETE(
  _request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const params = await props.params;
  const { seriesId } = params;

  const { error } = await supabase
    .from("story_series")
    .update({ status: "archived" })
    .eq("id", seriesId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
