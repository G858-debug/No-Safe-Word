// GET /api/cron/buffer-sync?secret=<CRON_SECRET>
//
// Daily reconciliation job. For every post we believe was supposed to
// publish (status='scheduled', buffer_post_id set, scheduled_for in the
// past), ask Buffer what actually happened.
//
// Decision matrix per Buffer's reported status:
//   sent       -> mark our post 'published', persist facebook_post_id +
//                 published_at, log buffer.publish_synced, revalidate
//                 the public story path.
//   error      -> persist buffer_error, log buffer.publish_failed.
//                 Local status stays 'scheduled' so the operator sees
//                 the failure on the dashboard until they investigate.
//   scheduled  -> Buffer hasn't published yet. Skip silently and log
//   sending      buffer.publish_pending so dashboards can see the
//                 cron observed it. No DB write.
//   draft      -> shouldn't happen for our automation, log+skip.
//   needs_approval
//
// Auth: middleware does NOT cover /api/cron, so this route validates
// CRON_SECRET on its own. No JSON body, no parameters except `secret`.

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { supabase } from "@no-safe-word/story-engine";
import { bufferClient, BufferApiError } from "@/lib/server/buffer-client";
import { logEvent } from "@/lib/server/events";

interface PendingPostRow {
  id: string;
  series_id: string;
  buffer_post_id: string;
  scheduled_for: string | null;
  status: string;
}

interface PendingCoverPostRow {
  id: string;
  slug: string | null;
  cover_post_buffer_id: string;
  cover_post_status: string | null;
  cover_post_scheduled_for: string | null;
}

export async function GET(request: NextRequest) {
  const secret = new URL(request.url).searchParams.get("secret");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET is not set on the server" },
      { status: 500 }
    );
  }
  if (secret !== expected) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const nowIso = new Date().toISOString();

  const { data: rawPending, error: pendingError } = await supabase
    .from("story_posts")
    .select("id, series_id, buffer_post_id, scheduled_for, status")
    .eq("status", "scheduled")
    .not("buffer_post_id", "is", null)
    .lte("scheduled_for", nowIso);

  if (pendingError) {
    return NextResponse.json(
      { error: pendingError.message },
      { status: 500 }
    );
  }
  const pending = (rawPending ?? []) as PendingPostRow[];

  let synced = 0;
  let failed = 0;
  let skipped = 0;
  const errors: Array<{ postId: string; error: string }> = [];
  const seriesIdsToRevalidate = new Set<string>();

  for (const post of pending) {
    let bufferStatus;
    try {
      bufferStatus = await bufferClient.getPostStatus(post.buffer_post_id);
    } catch (err) {
      const message =
        err instanceof BufferApiError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : "Unknown error";
      errors.push({ postId: post.id, error: message });
      continue;
    }

    // Only act on sent | error. scheduled / sending / draft /
    // needs_approval are skipped silently — they'll be reconsidered on
    // the next daily run. We log buffer.publish_pending so dashboards
    // can show "the cron observed it" without acting.
    if (
      bufferStatus.status === "scheduled" ||
      bufferStatus.status === "sending" ||
      bufferStatus.status === "draft" ||
      bufferStatus.status === "needs_approval"
    ) {
      skipped++;
      void logEvent({
        eventType: "buffer.publish_pending",
        metadata: {
          post_id: post.id,
          buffer_post_id: post.buffer_post_id,
          buffer_status: bufferStatus.status,
        },
      });
      continue;
    }

    if (bufferStatus.status === "sent") {
      const facebookPostId = parseFacebookPostId(bufferStatus.externalLink);
      const publishedAt =
        bufferStatus.sentAt ?? new Date().toISOString();

      const { error: updateError } = await supabase
        .from("story_posts")
        .update({
          status: "published",
          published_at: publishedAt,
          facebook_post_id: facebookPostId,
          buffer_status: "sent",
          buffer_error: null,
        })
        .eq("id", post.id);

      if (updateError) {
        errors.push({ postId: post.id, error: updateError.message });
        continue;
      }

      synced++;
      seriesIdsToRevalidate.add(post.series_id);
      void logEvent({
        eventType: "buffer.publish_synced",
        metadata: {
          post_id: post.id,
          buffer_post_id: post.buffer_post_id,
          facebook_post_id: facebookPostId,
          external_link: bufferStatus.externalLink,
        },
      });
      continue;
    }

    if (bufferStatus.status === "error") {
      const { error: updateError } = await supabase
        .from("story_posts")
        .update({
          buffer_status: "error",
          buffer_error: bufferStatus.error ?? "Buffer reported error with no message",
        })
        .eq("id", post.id);

      if (updateError) {
        errors.push({ postId: post.id, error: updateError.message });
        continue;
      }

      failed++;
      void logEvent({
        eventType: "buffer.publish_failed",
        metadata: {
          post_id: post.id,
          buffer_post_id: post.buffer_post_id,
          error: bufferStatus.error,
        },
      });
    }
  }

  // ----- Cover-reveal post sync -----
  //
  // The cover-reveal post is a one-off per-series Facebook post stored
  // on story_series.cover_post_*. Same decision matrix as chapter posts.
  const { data: rawPendingCovers, error: pendingCoverError } = await supabase
    .from("story_series")
    .select(
      "id, slug, cover_post_buffer_id, cover_post_status, cover_post_scheduled_for"
    )
    .not("cover_post_buffer_id", "is", null)
    .in("cover_post_status", ["pending", "sending", "scheduled"])
    .lte("cover_post_scheduled_for", nowIso);

  let coversChecked = 0;
  let coversSynced = 0;
  let coversFailed = 0;
  let coversSkipped = 0;
  const coverErrors: Array<{ seriesId: string; error: string }> = [];

  if (pendingCoverError) {
    coverErrors.push({
      seriesId: "<query>",
      error: pendingCoverError.message,
    });
  } else {
    const pendingCovers = (rawPendingCovers ?? []) as PendingCoverPostRow[];
    coversChecked = pendingCovers.length;

    for (const series of pendingCovers) {
      let bufferStatus;
      try {
        bufferStatus = await bufferClient.getPostStatus(
          series.cover_post_buffer_id
        );
      } catch (err) {
        const message =
          err instanceof BufferApiError
            ? `${err.code}: ${err.message}`
            : err instanceof Error
              ? err.message
              : "Unknown error";
        coverErrors.push({ seriesId: series.id, error: message });
        continue;
      }

      if (
        bufferStatus.status === "scheduled" ||
        bufferStatus.status === "sending" ||
        bufferStatus.status === "draft" ||
        bufferStatus.status === "needs_approval"
      ) {
        coversSkipped++;
        void logEvent({
          eventType: "buffer.cover_publish_pending",
          metadata: {
            series_id: series.id,
            buffer_post_id: series.cover_post_buffer_id,
            buffer_status: bufferStatus.status,
          },
        });
        continue;
      }

      if (bufferStatus.status === "sent") {
        const facebookPostId = parseFacebookPostId(bufferStatus.externalLink);
        const publishedAt =
          bufferStatus.sentAt ?? new Date().toISOString();

        const { error: updateError } = await supabase
          .from("story_series")
          .update({
            cover_post_status: "sent",
            cover_post_published_at: publishedAt,
            cover_post_facebook_id: facebookPostId,
            cover_post_error: null,
          })
          .eq("id", series.id);

        if (updateError) {
          coverErrors.push({ seriesId: series.id, error: updateError.message });
          continue;
        }

        coversSynced++;
        seriesIdsToRevalidate.add(series.id);
        void logEvent({
          eventType: "buffer.cover_publish_synced",
          metadata: {
            series_id: series.id,
            buffer_post_id: series.cover_post_buffer_id,
            facebook_post_id: facebookPostId,
            external_link: bufferStatus.externalLink,
          },
        });
        continue;
      }

      if (bufferStatus.status === "error") {
        const { error: updateError } = await supabase
          .from("story_series")
          .update({
            cover_post_status: "error",
            cover_post_error:
              bufferStatus.error ?? "Buffer reported error with no message",
          })
          .eq("id", series.id);

        if (updateError) {
          coverErrors.push({ seriesId: series.id, error: updateError.message });
          continue;
        }

        coversFailed++;
        void logEvent({
          eventType: "buffer.cover_publish_failed",
          metadata: {
            series_id: series.id,
            buffer_post_id: series.cover_post_buffer_id,
            error: bufferStatus.error,
          },
        });
      }
    }
  }

  // Auto-flip story_series.status to 'published' the first time a chapter
  // or cover-reveal post on that series actually goes live. Without this,
  // the series row stays at 'scheduled' until an operator manually clicks
  // "Publish website" — and the public /stories listing keeps hiding the
  // story even though Facebook has started dripping chapters. The
  // .neq("status", "published") predicate makes this idempotent: only the
  // first run that observes a live chapter performs the flip.
  let seriesAutoPublished = 0;
  const seriesPublishErrors: Array<{ seriesId: string; error: string }> = [];
  if (seriesIdsToRevalidate.size > 0) {
    const { data: flipped, error: flipErr } = await supabase
      .from("story_series")
      .update({
        status: "published",
        published_at: new Date().toISOString(),
      })
      .in("id", Array.from(seriesIdsToRevalidate))
      .neq("status", "published")
      .select("id, slug");

    if (flipErr) {
      seriesPublishErrors.push({ seriesId: "<batch>", error: flipErr.message });
    } else {
      seriesAutoPublished = flipped?.length ?? 0;
      for (const row of flipped ?? []) {
        void logEvent({
          eventType: "buffer.series_published",
          metadata: { series_id: row.id, slug: row.slug },
        });
      }
    }
  }

  // Revalidate every story that had at least one chapter (or the cover
  // post) flip to published. We need the slug for the public path.
  if (seriesIdsToRevalidate.size > 0) {
    const { data: seriesRows } = await supabase
      .from("story_series")
      .select("id, slug")
      .in("id", Array.from(seriesIdsToRevalidate));
    for (const row of seriesRows ?? []) {
      if (row.slug) revalidatePath(`/stories/${row.slug}`);
    }
    revalidatePath("/stories");
    revalidatePath("/");
  }

  return NextResponse.json({
    checked: pending.length,
    synced,
    failed,
    skipped,
    errors,
    coversChecked,
    coversSynced,
    coversFailed,
    coversSkipped,
    coverErrors,
    seriesAutoPublished,
    seriesPublishErrors,
  });
}

/**
 * Buffer's Post.externalLink is a full Facebook URL like
 * `https://www.facebook.com/<page>/posts/<post_id>` or
 * `https://www.facebook.com/<post_id>`. The trailing path segment is
 * the post id. Returns null if we can't parse it — the URL is still
 * useful to the operator even without a parsed id.
 */
function parseFacebookPostId(externalLink: string | null): string | null {
  if (!externalLink) return null;
  try {
    const url = new URL(externalLink);
    const segments = url.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    return last ?? null;
  } catch {
    return null;
  }
}
