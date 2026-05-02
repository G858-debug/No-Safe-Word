import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { logEvent } from "@/lib/server/events";

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
        prompt, image_id, previous_image_id, status, character_block_override, secondary_character_block_override, suppress_character_block,
        clothing_override, sfw_constraint_override, visual_signature_override,
        final_prompt, final_prompt_drafted_at, pose_template_id
      )
    `
    )
    .eq("series_id", seriesId)
    .order("part_number", { ascending: true });

  // Fetch characters linked to this series.
  // approved_image_id is included so the cover-character dropdown can
  // filter to characters that have approved portraits (only those can
  // be used as cover reference images).
  const { data: storyCharacters } = await supabase
    .from("story_characters")
    .select(
      `
      *,
      characters:character_id (id, name, description, approved_image_id)
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

    // Stuck-state recovery: a variant job that hangs (RunPod pod
    // evicted, Siray queue stall, network blip) leaves the series in
    // 'generating' forever — the user sees "Generating…" with no
    // recovery path. The threshold is model-specific:
    //   RunPod (Flux 2):  cover variants typically take 30–90s. 5min is
    //                     3–10× expected.
    //   Siray (Hunyuan):  cover variants are bimodal in practice — fast
    //                     workers finish in ~2.5min, slow ones in ~8min,
    //                     plus queue depth adds variance. 15min gives
    //                     ~2× tail headroom while still catching truly
    //                     stuck jobs.
    // We detect Siray via the `siray-` job_id prefix on the OLDEST job
    // (all jobs in one cover run come from the same backend, so any
    // sample is representative).
    const isSirayBatch = coverJobStates.some((j) =>
      j.job_id?.startsWith("siray-")
    );
    const stuckModel = isSirayBatch ? "hunyuan3" : "flux2_dev";
    const STUCK_THRESHOLD_MS = (isSirayBatch ? 15 : 5) * 60 * 1000;
    const now = Date.now();
    const oldestActive = coverJobStates.reduce<number | null>((acc, j) => {
      const t = new Date(j.created_at).getTime();
      return acc === null || t < acc ? t : acc;
    }, null);
    if (oldestActive !== null && now - oldestActive > STUCK_THRESHOLD_MS) {
      const stuckErrorMsg = `Stuck >${Math.round(STUCK_THRESHOLD_MS / 60000)}min — auto-failed by GET /api/stories reconciliation`;
      await supabase
        .from("generation_jobs")
        .update({
          status: "failed",
          error: stuckErrorMsg,
          completed_at: new Date().toISOString(),
        })
        .eq("series_id", seriesId)
        .eq("job_type", "cover_variant")
        .in("status", ["pending", "processing"]);

      // Log a cover.variant_failed event for each job we just timed out
      // so the events table reflects the failure mode (otherwise stuck
      // jobs would silently disappear into 'pending' with no trace).
      await Promise.all(
        coverJobStates.map((j) =>
          logEvent({
            eventType: "cover.variant_failed",
            metadata: {
              series_id: seriesId,
              variant_index: j.variant_index,
              model: stuckModel,
              job_id: j.job_id,
              error: stuckErrorMsg,
              reason: "stuck_timeout",
            },
          })
        )
      );
      // Preserve any cover_variants slots that already have URLs — they
      // came from previously-completed jobs (this same series may have
      // finished some variants on a prior run, or in the case of a
      // partial retry the un-retried slots are intact). Only the slots
      // tied to the stuck pending/processing jobs are at risk; the rest
      // are real images sitting in storage that we shouldn't discard.
      const stuckIndices = new Set(
        coverJobStates
          .map((j) => j.variant_index)
          .filter((i): i is number => typeof i === "number")
      );
      const preservedVariants: (string | null)[] = Array.from(
        { length: 4 },
        (_, i) => {
          if (stuckIndices.has(i)) return null;
          const existing = (series.cover_variants as (string | null)[] | null) ?? [];
          return existing[i] ?? null;
        }
      );
      const anyPreserved = preservedVariants.some((v) => v !== null);
      // If anything was preserved, recover to variants_ready so the user
      // can keep the good art and retry only the stuck slots. Otherwise
      // fall back to 'pending' so they can start fresh.
      await supabase
        .from("story_series")
        .update({
          cover_status: anyPreserved ? "variants_ready" : "pending",
          cover_variants: preservedVariants,
          cover_error: `Cover generation timed out after ${Math.round(STUCK_THRESHOLD_MS / 60000)} minutes. ${
            anyPreserved
              ? "Existing variants preserved — retry the failed slots."
              : "Try generating again."
          }`,
        })
        .eq("id", seriesId)
        .eq("cover_status", "generating");

      // Re-read so the response reflects the recovered state instead
      // of the stale 'generating' we read at the top of this handler.
      const { data: refreshed } = await supabase
        .from("story_series")
        .select("*")
        .eq("id", seriesId)
        .single();
      if (refreshed) {
        Object.assign(series, refreshed);
      }
      coverJobStates = [];
    }
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
