// POST   /api/stories/[seriesId]/buffer-schedule
// DELETE /api/stories/[seriesId]/buffer-schedule
//
// POST: schedule every unpublished post in this series on Buffer. The
// chain logic (buildScheduleForStory) decides the dates; this route
// just iterates the plan and writes Buffer's responses back to the DB.
//
// DELETE: cancel every scheduled-but-not-yet-sent post in this series
// on Buffer, and clear our local buffer_post_id.
//
// Auth: middleware (apps/web/middleware.ts) gates every /api/stories/*
// route with the admin session cookie, so no per-route auth check is
// needed here.

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { supabase } from "@no-safe-word/story-engine";
import { bufferClient, BufferApiError } from "@/lib/server/buffer-client";
import { buildScheduleForStory } from "@/lib/server/schedule-chain";

interface ScheduleRequestBody {
  startDate?: string;
}

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const { seriesId } = await props.params;

  let body: ScheduleRequestBody = {};
  try {
    body = (await request.json()) as ScheduleRequestBody;
  } catch {
    // Empty body is fine — startDate is optional.
  }

  // Resolve the Facebook channel up front. If the page isn't connected
  // we want to fail before scheduling anything at all.
  let channelId: string | null;
  try {
    channelId = await bufferClient.getFacebookPageChannelId();
  } catch (err) {
    return NextResponse.json(
      {
        error: "Buffer channel lookup failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 502 }
    );
  }
  if (!channelId) {
    return NextResponse.json(
      {
        error:
          "No Facebook page connected to Buffer. Connect the page in Buffer's UI and try again.",
      },
      { status: 400 }
    );
  }

  // Build the plan.
  let plan;
  try {
    plan = await buildScheduleForStory(seriesId, {
      startDate: body.startDate ? new Date(body.startDate) : undefined,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to build schedule plan",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }

  if (plan.plan.length === 0) {
    return NextResponse.json(
      {
        error:
          "No posts available to schedule on Buffer. Every chapter is already scheduled or sent.",
      },
      { status: 400 }
    );
  }

  // Iterate. Buffer is the source of truth — if call N succeeds we
  // commit it locally even if call N+1 fails, because the post is
  // genuinely scheduled on Buffer.
  //
  // The loop is idempotent. For each plan item we re-read the post's
  // current Buffer state and:
  //   - skip silently if it's already scheduled or sent (buffer_post_id
  //     set, buffer_status not 'error'),
  //   - clear the stale Buffer fields first if it's a retry of a failed
  //     attempt (buffer_status='error'),
  //   - otherwise schedule it fresh.
  // The chain filter in buildScheduleForStory should already exclude
  // already-scheduled posts; this re-check guards against a race where
  // another request scheduled the same post between plan-build and now.
  const successes: Array<{
    postId: string;
    bufferPostId: string;
    scheduledAt: string;
  }> = [];
  const skipped: Array<{ postId: string; reason: string }> = [];
  let firstFailure: { postId: string; error: string } | null = null;

  for (const item of plan.plan) {
    const { data: current, error: readError } = await supabase
      .from("story_posts")
      .select("buffer_post_id, buffer_status")
      .eq("id", item.postId)
      .single();

    if (readError || !current) {
      firstFailure = {
        postId: item.postId,
        error: readError?.message ?? "Post not found",
      };
      break;
    }

    const alreadyScheduled =
      current.buffer_post_id != null && current.buffer_status !== "error";
    if (alreadyScheduled) {
      skipped.push({ postId: item.postId, reason: "already_scheduled" });
      continue;
    }

    if (current.buffer_status === "error") {
      const { error: clearError } = await supabase
        .from("story_posts")
        .update({
          buffer_post_id: null,
          buffer_status: null,
          buffer_error: null,
        })
        .eq("id", item.postId);
      if (clearError) {
        firstFailure = {
          postId: item.postId,
          error: `Failed to clear failed Buffer state: ${clearError.message}`,
        };
        break;
      }
    }

    try {
      const result = await bufferClient.schedulePost({
        channelId,
        text: item.facebookContent,
        scheduledAt: item.scheduledAt,
        imageUrls: item.imageUrls,
        firstComment: item.firstComment || undefined,
      });

      const { error: updateError } = await supabase
        .from("story_posts")
        .update({
          status: "scheduled",
          scheduled_for: item.scheduledAt.toISOString(),
          buffer_post_id: result.id,
          buffer_status: result.status,
          buffer_error: null,
        })
        .eq("id", item.postId);

      if (updateError) {
        // The post is on Buffer but our DB write failed. Log but
        // continue — the next sync run will detect it via Buffer's
        // post_id (we'll have lost the link, but a manual reconcile
        // is recoverable).
        console.error(
          `[buffer-schedule] Failed to persist buffer_post_id for post ${item.postId}: ${updateError.message}`
        );
      }

      successes.push({
        postId: item.postId,
        bufferPostId: result.id,
        scheduledAt: item.scheduledAt.toISOString(),
      });
    } catch (err) {
      const message =
        err instanceof BufferApiError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : "Unknown error";
      firstFailure = { postId: item.postId, error: message };
      break;
    }
  }

  if (successes.length > 0) {
    await supabase
      .from("story_series")
      .update({ status: "scheduled" })
      .eq("id", seriesId);

    const { data: series } = await supabase
      .from("story_series")
      .select("slug")
      .eq("id", seriesId)
      .single();
    if (series?.slug) {
      revalidatePath(`/dashboard/stories/${seriesId}`);
      revalidatePath(`/stories/${series.slug}`);
    }
  }

  if (firstFailure) {
    return NextResponse.json(
      {
        partial: true,
        scheduled: successes,
        skipped,
        failure: firstFailure,
      },
      { status: 207 }
    );
  }

  return NextResponse.json({
    scheduled: successes,
    skipped,
    startDate: plan.startDate.toISOString(),
    chainTailDate: plan.chainTailDate?.toISOString() ?? null,
  });
}

export async function DELETE(
  _request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const { seriesId } = await props.params;

  const { data: posts, error: postsError } = await supabase
    .from("story_posts")
    .select("id, buffer_post_id, buffer_status, status")
    .eq("series_id", seriesId)
    .not("buffer_post_id", "is", null);

  if (postsError) {
    return NextResponse.json(
      { error: postsError.message },
      { status: 500 }
    );
  }

  if (!posts || posts.length === 0) {
    return NextResponse.json({ cancelled: [], failures: [] });
  }

  const cancelled: string[] = [];
  const failures: Array<{ postId: string; error: string }> = [];

  for (const post of posts) {
    if (!post.buffer_post_id) continue;

    // Don't try to cancel posts Buffer has already published. They are
    // live on Facebook.
    if (post.buffer_status === "sent") continue;

    try {
      await bufferClient.cancelPost(post.buffer_post_id);
      await supabase
        .from("story_posts")
        .update({
          status: "draft",
          scheduled_for: null,
          buffer_post_id: null,
          buffer_status: null,
          buffer_error: null,
        })
        .eq("id", post.id);
      cancelled.push(post.id);
    } catch (err) {
      const message =
        err instanceof BufferApiError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : "Unknown error";
      failures.push({ postId: post.id, error: message });
    }
  }

  if (cancelled.length > 0) {
    revalidatePath(`/dashboard/stories/${seriesId}`);
  }

  return NextResponse.json({ cancelled, failures });
}
