import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import type { ImageModel } from "@no-safe-word/shared";

const VALID_MODELS: ImageModel[] = ["flux2_dev", "hunyuan3"];

/**
 * POST /api/stories/[seriesId]/change-image-model
 *
 * Switches the story's image_model between flux2_dev and hunyuan3 and resets
 * any in-flight scene generations back to pending. Character portraits are
 * canonical on the base `characters` table and serve BOTH pipelines (Flux 2
 * uses the image as a reference, Hunyuan uses the locked portrait prompt), so
 * switching models does NOT wipe portraits.
 *
 * Body: { image_model: 'flux2_dev' | 'hunyuan3' }
 */
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const { seriesId } = await props.params;

  let newModel: ImageModel;
  try {
    const body = await request.json();
    if (
      typeof body?.image_model !== "string" ||
      !VALID_MODELS.includes(body.image_model as ImageModel)
    ) {
      return NextResponse.json(
        { error: `image_model must be one of: ${VALID_MODELS.join(", ")}` },
        { status: 400 }
      );
    }
    newModel = body.image_model as ImageModel;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { data: series, error: seriesErr } = await supabase
    .from("story_series")
    .select("id, image_model")
    .eq("id", seriesId)
    .single();

  if (seriesErr || !series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  if (series.image_model === newModel) {
    return NextResponse.json({
      series_id: seriesId,
      image_model: newModel,
      reset: false,
      message: "Model unchanged; nothing reset.",
    });
  }

  // Reset every prompt status + clear image_id for all posts in this series.
  const { data: posts, error: postsErr } = await supabase
    .from("story_posts")
    .select("id")
    .eq("series_id", seriesId);

  if (postsErr) {
    return NextResponse.json(
      { error: `Failed to load posts: ${postsErr.message}` },
      { status: 500 }
    );
  }

  const postIds = (posts ?? []).map((p) => p.id);
  if (postIds.length > 0) {
    const { error: promptResetErr } = await supabase
      .from("story_image_prompts")
      .update({ status: "pending", image_id: null })
      .in("post_id", postIds);

    if (promptResetErr) {
      return NextResponse.json(
        { error: `Failed to reset image prompts: ${promptResetErr.message}` },
        { status: 500 }
      );
    }
  }

  // Flip the model and send the series back to images_pending. Characters
  // already have their portraits on the base row; no reset needed.
  const { data: updated, error: updateErr } = await supabase
    .from("story_series")
    .update({ image_model: newModel, status: "images_pending" })
    .eq("id", seriesId)
    .select("id, image_model, status")
    .single();

  if (updateErr || !updated) {
    return NextResponse.json(
      { error: `Failed to update series: ${updateErr?.message ?? "unknown"}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    series_id: seriesId,
    image_model: updated.image_model,
    status: updated.status,
    reset: true,
  });
}
