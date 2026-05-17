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
import {
  buildScheduleForStory,
  ScheduleStartDateError,
} from "@/lib/server/schedule-chain";

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
    if (err instanceof ScheduleStartDateError) {
      return NextResponse.json(
        { error: "Invalid startDate", details: err.message },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        error: "Failed to build schedule plan",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }

  if (plan.plan.length === 0 && plan.authorNote == null) {
    return NextResponse.json(
      {
        error:
          "Nothing available to schedule on Buffer. Every chapter (and the author note) is already scheduled or sent.",
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

  // Author-note scheduling. Skipped on a chapter failure so we don't
  // land the note ahead of a chapter that didn't make it onto Buffer.
  // Idempotent: re-reads the series row and skips if the note is
  // already on Buffer (post_id set + status not 'error'), and clears
  // any prior 'error' state before re-scheduling.
  let authorNoteResult:
    | { bufferPostId: string; scheduledAt: string }
    | null = null;
  let authorNoteFailure: { error: string } | null = null;
  let authorNoteSkipped: { reason: string } | null = null;

  if (firstFailure == null && plan.authorNote != null) {
    const { data: seriesRow, error: seriesReadErr } = await supabase
      .from("story_series")
      .select("author_note_buffer_post_id, author_note_buffer_status")
      .eq("id", seriesId)
      .single();

    if (seriesReadErr || !seriesRow) {
      authorNoteFailure = {
        error: seriesReadErr?.message ?? "Series row not found",
      };
    } else {
      const noteAlreadyScheduled =
        seriesRow.author_note_buffer_post_id != null &&
        seriesRow.author_note_buffer_status !== "error";

      if (noteAlreadyScheduled) {
        authorNoteSkipped = { reason: "already_scheduled" };
      } else {
        if (seriesRow.author_note_buffer_status === "error") {
          await supabase
            .from("story_series")
            .update({
              author_note_buffer_post_id: null,
              author_note_buffer_status: null,
              author_note_buffer_error: null,
            })
            .eq("id", seriesId);
        }

        try {
          const result = await bufferClient.schedulePost({
            channelId,
            text: plan.authorNote.socialCaption,
            scheduledAt: plan.authorNote.scheduledAt,
            imageUrls: [plan.authorNote.imageUrl],
          });

          const scheduledAtIso = plan.authorNote.scheduledAt.toISOString();
          const { error: updateErr } = await supabase
            .from("story_series")
            .update({
              author_note_buffer_post_id: result.id,
              author_note_buffer_status: result.status,
              author_note_buffer_error: null,
              author_note_scheduled_for: scheduledAtIso,
            })
            .eq("id", seriesId);

          if (updateErr) {
            console.error(
              `[buffer-schedule] author note: persisted Buffer post but DB write failed for series ${seriesId}: ${updateErr.message}`
            );
          }

          authorNoteResult = {
            bufferPostId: result.id,
            scheduledAt: scheduledAtIso,
          };
        } catch (err) {
          const message =
            err instanceof BufferApiError
              ? `${err.code}: ${err.message}`
              : err instanceof Error
                ? err.message
                : "Unknown error";
          authorNoteFailure = { error: message };
          await supabase
            .from("story_series")
            .update({
              author_note_buffer_status: "error",
              author_note_buffer_error: message,
            })
            .eq("id", seriesId);
        }
      }
    }
  }

  if (successes.length > 0 || authorNoteResult != null) {
    // Only nudge a non-published series. A series that's already 'published'
    // (after publish_story_to_website) must NOT be downgraded just because
    // the operator pushed more posts — e.g. scheduling the author-note add-on
    // or re-scheduling a stuck chapter. Doing so silently hides a live story
    // from /stories until someone notices.
    await supabase
      .from("story_series")
      .update({ status: "scheduled" })
      .eq("id", seriesId)
      .neq("status", "published");

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

  if (firstFailure || authorNoteFailure) {
    return NextResponse.json(
      {
        partial: true,
        scheduled: successes,
        skipped,
        failure: firstFailure,
        authorNote: authorNoteResult,
        authorNoteSkipped,
        authorNoteFailure,
      },
      { status: 207 }
    );
  }

  return NextResponse.json({
    scheduled: successes,
    skipped,
    authorNote: authorNoteResult,
    authorNoteSkipped,
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

  // Author-note Buffer state on the series row. Mirrors the per-post
  // cancel logic — skip if the note has already been sent ('sent' from
  // Buffer means it's live on Facebook), otherwise cancel + clear.
  const { data: seriesRow, error: seriesErr } = await supabase
    .from("story_series")
    .select(
      "author_note_buffer_post_id, author_note_buffer_status"
    )
    .eq("id", seriesId)
    .single();

  if (seriesErr) {
    return NextResponse.json(
      { error: seriesErr.message },
      { status: 500 }
    );
  }

  const cancelled: string[] = [];
  const failures: Array<{ postId: string; error: string }> = [];
  let authorNoteCancelled = false;
  let authorNoteFailure: { error: string } | null = null;

  for (const post of posts ?? []) {
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

  if (
    seriesRow?.author_note_buffer_post_id &&
    seriesRow.author_note_buffer_status !== "sent"
  ) {
    try {
      await bufferClient.cancelPost(seriesRow.author_note_buffer_post_id);
      await supabase
        .from("story_series")
        .update({
          author_note_buffer_post_id: null,
          author_note_buffer_status: null,
          author_note_buffer_error: null,
          author_note_scheduled_for: null,
        })
        .eq("id", seriesId);
      authorNoteCancelled = true;
    } catch (err) {
      const message =
        err instanceof BufferApiError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : "Unknown error";
      authorNoteFailure = { error: message };
    }
  }

  if (cancelled.length > 0 || authorNoteCancelled) {
    revalidatePath(`/dashboard/stories/${seriesId}`);
  }

  return NextResponse.json({
    cancelled,
    failures,
    authorNoteCancelled,
    authorNoteFailure,
  });
}
