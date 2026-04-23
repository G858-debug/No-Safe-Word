import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { composeCover, type CoverSize } from "@/lib/server/cover-compositor";

// sharp, satori, and resvg all require native bindings and fs access —
// Node.js runtime only, never edge.
export const runtime = "nodejs";
// Compositing is bursty and can take 15–30s for the full 4-size pass;
// don't let Vercel/Railway inactivity auto-timeouts cut us off.
export const maxDuration = 120;

// ============================================================
// POST /api/stories/[seriesId]/composite-cover
// ============================================================
// Typography compositing: takes the approved cover base image
// (cover_base_url, 1024×1536) and produces 4 sized/typography-
// composited JPEGs: hero (1600×2400), card (600×900), og (1200×630),
// email (1200×600).
//
// Triggered fire-and-forget by the approve-cover endpoint after the
// user selects a variant. State machine:
//
//   approved → compositing → complete       (success)
//   approved → compositing → approved       (failure, cover_error set)
//
// Re-running on cover_status='complete' is supported — produces fresh
// content-hashed filenames and updates cover_sizes to point at them.
//
// Compositing is SEQUENTIAL across sizes, not parallel. sharp + resvg +
// satori together can spike memory; 4 concurrent composites of a
// 1600×2400 canvas risks OOM on smaller Railway instances. Sequential
// takes ~15-30s total and runs fire-and-forget, so UX is unaffected.
// ============================================================

const BUCKET = "story-covers";
const SIZES: CoverSize[] = ["hero", "card", "og", "email"];
const AUTHOR_NAME = "Nontsikelelo Mabaso";

export async function POST(
  _request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const { seriesId } = await props.params;

  const { data: series, error: seriesErr } = await supabase
    .from("story_series")
    .select(
      "id, slug, title, cover_base_url, cover_status, cover_sizes, blurb_short_variants, blurb_short_selected"
    )
    .eq("id", seriesId)
    .single();

  if (seriesErr || !series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  if (series.cover_status !== "approved" && series.cover_status !== "complete") {
    return NextResponse.json(
      {
        error: `Cannot composite cover while status is '${series.cover_status}'. Must be 'approved' or 'complete'.`,
      },
      { status: 400 }
    );
  }

  if (!series.cover_base_url) {
    return NextResponse.json(
      { error: "Cover base image URL is missing. Approve a cover variant first." },
      { status: 400 }
    );
  }

  if (!series.title) {
    return NextResponse.json(
      { error: "Series title is missing — required for compositing." },
      { status: 400 }
    );
  }

  // ── State: approved/complete → compositing ──
  {
    const { error: transErr } = await supabase
      .from("story_series")
      .update({ cover_status: "compositing", cover_error: null })
      .eq("id", seriesId);
    if (transErr) {
      return NextResponse.json(
        { error: `Failed to transition to compositing: ${transErr.message}` },
        { status: 500 }
      );
    }
  }

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
    await revertToApproved(seriesId, `Failed to fetch cover base image: ${message}`);
    return NextResponse.json(
      { error: `Failed to fetch cover base image: ${message}` },
      { status: 500 }
    );
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
        author: AUTHOR_NAME,
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
      console.error(`[composite-cover] size='${size}' failed:`, message);
      await revertToApproved(seriesId, `Compositing failed at size '${size}': ${message}`);
      return NextResponse.json(
        { error: `Compositing failed at size '${size}': ${message}` },
        { status: 500 }
      );
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
    await revertToApproved(
      seriesId,
      `Composites uploaded but DB update failed: ${completeErr.message}`
    );
    return NextResponse.json(
      {
        error: `Composites uploaded but DB update failed: ${completeErr.message}`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    coverStatus: "complete",
    coverSizes: newCoverSizes,
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

