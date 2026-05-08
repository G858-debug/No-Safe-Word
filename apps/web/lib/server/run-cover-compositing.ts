import { supabase } from "@no-safe-word/story-engine";
import { composeCover, type CoverSize } from "@/lib/server/cover-compositor";
import { logEvent } from "@/lib/server/events";

// ============================================================
// runCoverCompositing(seriesId)
// ============================================================
// Pure server-side function — owns the full cover compositing state
// machine + 4-size pipeline. Both /composite-cover and /recompose-cover
// are thin HTTP wrappers around this. Logs cover.composite_* events
// itself; recomposite intent markers are logged by the recompose route.
//
// State transitions:
//   approved/complete → compositing → complete   (success)
//   approved/complete → compositing → approved   (failure, cover_error set)
//
// Compositing is SEQUENTIAL across sizes (not parallel). sharp + resvg +
// satori together spike memory; 4 concurrent composites of a 1600×2400
// canvas risks OOM on smaller Railway instances.
// ============================================================

const BUCKET = "story-covers";
const SIZES: CoverSize[] = ["hero", "card", "og", "email"];

export type RunCoverCompositingResult =
  | { ok: true; coverSizes: Record<CoverSize, string> }
  | { ok: false; error: string; status: number };

export async function runCoverCompositing(
  seriesId: string
): Promise<RunCoverCompositingResult> {
  const { data: series, error: seriesErr } = await supabase
    .from("story_series")
    .select(
      "id, slug, title, cover_base_url, cover_status, cover_sizes, blurb_short_variants, blurb_short_selected, author:authors!story_series_author_id_fkey ( name )"
    )
    .eq("id", seriesId)
    .single();

  if (seriesErr || !series) {
    return { ok: false, error: "Series not found", status: 404 };
  }

  // The FK is NOT NULL post-migration, so this should never fail in
  // practice. We still fail loudly rather than render an empty author
  // credit — anonymous covers would be a serious branding regression.
  const authorRow = series.author as { name: string } | null;
  const authorName = authorRow?.name;
  if (!authorName) {
    return {
      ok: false,
      error: "Series has no resolvable author — cannot composite cover.",
      status: 500,
    };
  }

  if (series.cover_status !== "approved" && series.cover_status !== "complete") {
    return {
      ok: false,
      error: `Cannot composite cover while status is '${series.cover_status}'. Must be 'approved' or 'complete'.`,
      status: 400,
    };
  }

  if (!series.cover_base_url) {
    return {
      ok: false,
      error: "Cover base image URL is missing. Approve a cover variant first.",
      status: 400,
    };
  }

  if (!series.title) {
    return {
      ok: false,
      error: "Series title is missing — required for compositing.",
      status: 400,
    };
  }

  // ── State: approved/complete → compositing (compare-and-swap) ──
  // The CAS predicate `.in("cover_status", ["approved", "complete"])`
  // guarantees only one concurrent caller wins the transition. Without
  // it, two tabs (or a polling-side trigger racing the manual Retry
  // button) could both pass the SELECT validation above and both run
  // the 4-size pipeline — wasting Railway compute and producing noisy
  // duplicate composite_* events. Whoever loses the race gets a 409.
  {
    const { data: updated, error: transErr } = await supabase
      .from("story_series")
      .update({ cover_status: "compositing", cover_error: null })
      .eq("id", seriesId)
      .in("cover_status", ["approved", "complete"])
      .select("id")
      .maybeSingle();
    if (transErr) {
      return {
        ok: false,
        error: `Failed to transition to compositing: ${transErr.message}`,
        status: 500,
      };
    }
    if (!updated) {
      return {
        ok: false,
        error:
          "Compositing already in progress (status changed between read and write).",
        status: 409,
      };
    }
  }

  await logEvent({
    eventType: "cover.composite_started",
    metadata: { series_id: seriesId, slug: series.slug },
  });

  // ── Resolve blurb (Prompt 4 hook — may be null) ──
  const blurbVariants = (series.blurb_short_variants as string[] | null) ?? null;
  const blurbIdx = series.blurb_short_selected;
  const blurbShort =
    blurbVariants && blurbIdx !== null && blurbIdx !== undefined
      ? blurbVariants[blurbIdx] ?? undefined
      : undefined;

  // ── Fetch base image into Buffer ──
  let baseImageBuffer: Buffer;
  try {
    const res = await fetch(series.cover_base_url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${series.cover_base_url}`);
    }
    baseImageBuffer = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown fetch error";
    const errorMsg = `Failed to fetch cover base image: ${message}`;
    await logCompositeFailed(seriesId, series.slug, errorMsg, "fetch_base");
    await revertToApproved(seriesId, errorMsg);
    return { ok: false, error: errorMsg, status: 500 };
  }

  // ── Sequentially composite each size + upload ──
  const newCoverSizes: Record<CoverSize, string> = {
    hero: "",
    card: "",
    og: "",
    email: "",
  };

  for (const size of SIZES) {
    try {
      const { buffer, width, height, contentHash } = await composeCover({
        baseImageBuffer,
        title: series.title,
        author: authorName,
        blurbShort,
        size,
      });

      const storagePath = `${series.slug}/${size}-${width}x${height}-${contentHash}.jpg`;

      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, buffer, {
          contentType: "image/jpeg",
          upsert: true,
          // Composite filenames are content-hashed → immutable per
          // content. Aggressive caching is safe; regeneration produces
          // a different filename. See docs/deployment-notes.md for a
          // Cloudflare Page Rule recommendation that would layer on
          // top of these bucket-level headers at the CDN edge.
          cacheControl: "public, max-age=31536000, immutable",
        });

      if (uploadErr) {
        throw new Error(`storage upload: ${uploadErr.message}`);
      }

      const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
      newCoverSizes[size] = publicUrlData.publicUrl;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown compositing error";
      const errorMsg = `Compositing failed at size '${size}': ${message}`;
      console.error(`[run-cover-compositing] size='${size}' failed:`, message);
      await logCompositeFailed(seriesId, series.slug, errorMsg, size);
      await revertToApproved(seriesId, errorMsg);
      return { ok: false, error: errorMsg, status: 500 };
    }
  }

  // ── All 4 succeeded: state → complete ──
  const { error: completeErr } = await supabase
    .from("story_series")
    .update({
      cover_sizes: newCoverSizes,
      cover_status: "complete",
      cover_error: null,
    })
    .eq("id", seriesId);

  if (completeErr) {
    const errorMsg = `Composites uploaded but DB update failed: ${completeErr.message}`;
    await logCompositeFailed(seriesId, series.slug, errorMsg, "db_finalize");
    await revertToApproved(seriesId, errorMsg);
    return { ok: false, error: errorMsg, status: 500 };
  }

  await logEvent({
    eventType: "cover.composite_completed",
    metadata: { series_id: seriesId, slug: series.slug },
  });

  return { ok: true, coverSizes: newCoverSizes };
}

async function logCompositeFailed(
  seriesId: string,
  slug: string,
  error: string,
  failedAt: string
): Promise<void> {
  await logEvent({
    eventType: "cover.composite_failed",
    metadata: { series_id: seriesId, slug, error, failed_at: failedAt },
  });
}

/**
 * On failure, revert status to 'approved' so the UI surfaces a retry
 * affordance without losing the approved variant. cover_sizes is NOT
 * cleared — a prior successful composite remains usable until the next
 * successful pass overwrites it.
 */
async function revertToApproved(seriesId: string, errorMessage: string): Promise<void> {
  await supabase
    .from("story_series")
    .update({
      cover_status: "approved",
      cover_error: errorMessage,
    })
    .eq("id", seriesId);
}
