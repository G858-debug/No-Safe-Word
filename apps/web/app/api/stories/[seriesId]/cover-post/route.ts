// POST   /api/stories/[seriesId]/cover-post
// DELETE /api/stories/[seriesId]/cover-post
//
// POST: schedule the one-off cover-reveal Facebook post on Buffer.
// Idempotent — refuses to re-schedule a series that already has a
// non-error cover_post_buffer_id (operator must DELETE first to retry).
// On 'error', clears state before scheduling so retries work.
//
// DELETE: cancel the cover-reveal post on Buffer (if not yet sent) and
// clear all 7 cover_post_* columns.
//
// Auth: middleware (apps/web/middleware.ts) gates every /api/stories/*
// route with the admin session cookie, so no per-route auth check is
// needed here.

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { supabase } from "@no-safe-word/story-engine";
import { bufferClient, BufferApiError } from "@/lib/server/buffer-client";
import {
  buildCoverPostPlan,
  CoverPostPlanError,
} from "@/lib/server/cover-post";
import { logEvent } from "@/lib/server/events";

interface CoverPostRequestBody {
  scheduledAt?: string;
  ctaLine?: string;
}

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const { seriesId } = await props.params;

  let body: CoverPostRequestBody = {};
  try {
    body = (await request.json()) as CoverPostRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (!body.scheduledAt) {
    return NextResponse.json(
      { error: "scheduledAt is required" },
      { status: 400 }
    );
  }
  if (!body.ctaLine || !body.ctaLine.trim()) {
    return NextResponse.json(
      { error: "ctaLine is required" },
      { status: 400 }
    );
  }

  const scheduledAt = new Date(body.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) {
    return NextResponse.json(
      { error: "scheduledAt is not a valid datetime" },
      { status: 400 }
    );
  }
  if (scheduledAt.getTime() < Date.now()) {
    return NextResponse.json(
      { error: "scheduledAt is in the past" },
      { status: 400 }
    );
  }

  // Idempotency: refuse if a cover post is already in flight (not
  // 'error'). Operator must DELETE first to schedule a fresh one.
  const { data: current, error: currentErr } = await supabase
    .from("story_series")
    .select(
      "cover_post_buffer_id, cover_post_status, slug"
    )
    .eq("id", seriesId)
    .single();

  if (currentErr || !current) {
    return NextResponse.json(
      {
        error: "Series not found",
        details: currentErr?.message ?? "no row",
      },
      { status: 404 }
    );
  }

  if (
    current.cover_post_buffer_id != null &&
    current.cover_post_status !== "error"
  ) {
    return NextResponse.json(
      {
        error: "Cover post already scheduled",
        details:
          "Cancel the existing cover post first (DELETE) before scheduling a new one.",
        bufferPostId: current.cover_post_buffer_id,
        coverPostStatus: current.cover_post_status,
      },
      { status: 409 }
    );
  }

  // Retry path: clear stale error state before re-scheduling.
  if (current.cover_post_status === "error") {
    const { error: clearErr } = await supabase
      .from("story_series")
      .update({
        cover_post_buffer_id: null,
        cover_post_status: null,
        cover_post_error: null,
      })
      .eq("id", seriesId);
    if (clearErr) {
      return NextResponse.json(
        {
          error: "Failed to clear failed Buffer state",
          details: clearErr.message,
        },
        { status: 500 }
      );
    }
  }

  // Build the plan.
  let plan;
  try {
    plan = await buildCoverPostPlan(seriesId, scheduledAt, body.ctaLine);
  } catch (err) {
    if (err instanceof CoverPostPlanError) {
      return NextResponse.json(
        { error: "Cover post not ready", details: err.message },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        error: "Failed to build cover post plan",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }

  // Resolve channel.
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

  // Schedule on Buffer.
  let result;
  try {
    result = await bufferClient.schedulePost({
      channelId,
      text: plan.text,
      scheduledAt: plan.scheduledAt,
      imageUrls: [plan.imageUrl],
      firstComment: plan.firstComment,
    });
  } catch (err) {
    const message =
      err instanceof BufferApiError
        ? `${err.code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : "Unknown error";
    return NextResponse.json(
      { error: "Buffer createPost failed", details: message },
      { status: 502 }
    );
  }

  // Persist Buffer state on story_series.
  const { error: updateErr } = await supabase
    .from("story_series")
    .update({
      cover_post_buffer_id: result.id,
      cover_post_status: result.status,
      cover_post_error: null,
      cover_post_scheduled_for: plan.scheduledAt.toISOString(),
      cover_post_cta_line: body.ctaLine,
    })
    .eq("id", seriesId);

  if (updateErr) {
    // The post is on Buffer but our DB write failed. Surface the
    // failure with the Buffer id so the operator can reconcile manually.
    console.error(
      `[cover-post] Buffer scheduled (${result.id}) but DB write failed: ${updateErr.message}`
    );
    return NextResponse.json(
      {
        partial: true,
        bufferPostId: result.id,
        bufferStatus: result.status,
        error: "Scheduled on Buffer but failed to persist locally",
        details: updateErr.message,
      },
      { status: 500 }
    );
  }

  void logEvent({
    eventType: "buffer.cover_scheduled",
    metadata: {
      series_id: seriesId,
      buffer_post_id: result.id,
      due_at: plan.scheduledAt.toISOString(),
      image_url: plan.imageUrl,
    },
  });

  revalidatePath(`/dashboard/stories/${seriesId}`);

  return NextResponse.json({
    bufferPostId: result.id,
    bufferStatus: result.status,
    scheduledAt: plan.scheduledAt.toISOString(),
  });
}

export async function DELETE(
  _request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const { seriesId } = await props.params;

  const { data: series, error: readErr } = await supabase
    .from("story_series")
    .select("cover_post_buffer_id, cover_post_status")
    .eq("id", seriesId)
    .single();

  if (readErr || !series) {
    return NextResponse.json(
      { error: "Series not found", details: readErr?.message ?? "no row" },
      { status: 404 }
    );
  }

  if (!series.cover_post_buffer_id) {
    return NextResponse.json(
      { error: "No cover post is scheduled for this series" },
      { status: 404 }
    );
  }

  // Don't try to cancel a post Buffer has already published. Clearing
  // local state in that case would lose the link to the live FB post.
  if (series.cover_post_status === "sent") {
    return NextResponse.json(
      {
        error: "Cover post is already published on Facebook",
        details:
          "Buffer reports the post as 'sent'. It's live on Facebook and cannot be cancelled.",
      },
      { status: 409 }
    );
  }

  try {
    await bufferClient.cancelPost(series.cover_post_buffer_id);
  } catch (err) {
    const message =
      err instanceof BufferApiError
        ? `${err.code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : "Unknown error";
    return NextResponse.json(
      { error: "Buffer cancelPost failed", details: message },
      { status: 502 }
    );
  }

  const { error: clearErr } = await supabase
    .from("story_series")
    .update({
      cover_post_buffer_id: null,
      cover_post_status: null,
      cover_post_error: null,
      cover_post_scheduled_for: null,
      cover_post_published_at: null,
      cover_post_facebook_id: null,
      cover_post_cta_line: null,
    })
    .eq("id", seriesId);

  if (clearErr) {
    return NextResponse.json(
      {
        error: "Cancelled on Buffer but failed to clear local state",
        details: clearErr.message,
      },
      { status: 500 }
    );
  }

  void logEvent({
    eventType: "buffer.cover_cancelled",
    metadata: {
      series_id: seriesId,
      buffer_post_id: series.cover_post_buffer_id,
    },
  });

  revalidatePath(`/dashboard/stories/${seriesId}`);

  return NextResponse.json({ cancelled: true });
}
