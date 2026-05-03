import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COVER_READY_STATUSES = ["approved", "compositing", "complete"];

// A pre-publish check that failed. Surfaced verbatim to the client so
// the Publish panel can render a checklist of what's still missing.
interface PreconditionFailure {
  key: string;
  message: string;
}

// POST /api/stories/[seriesId]/publish-website
//
// Flips the series and every still-unpublished post to status='published'
// + published_at=now() in a single Postgres transaction (see the
// publish_story_to_website RPC). Decoupled from the Facebook publishing
// flow — no Graph API calls, no schedule writes.
//
// Auth: middleware (apps/web/middleware.ts) gates every /api/stories/*
// route with the admin session cookie, so no per-route auth check is
// needed here.
export async function POST(
  _request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const { seriesId } = await props.params;

  if (!UUID_RE.test(seriesId)) {
    return NextResponse.json(
      { error: "Invalid seriesId" },
      { status: 400 }
    );
  }

  try {
    // 1. Load the series and confirm it isn't already published.
    const { data: series, error: seriesErr } = await supabase
      .from("story_series")
      .select(
        "id, status, cover_status, blurb_short_selected, blurb_long_selected"
      )
      .eq("id", seriesId)
      .single();

    if (seriesErr || !series) {
      return NextResponse.json({ error: "Series not found" }, { status: 404 });
    }

    if (series.status === "published") {
      return NextResponse.json(
        { error: "Series is already published" },
        { status: 409 }
      );
    }

    // 2. Run every precondition in parallel and aggregate failures.
    //    We collect ALL failures rather than short-circuiting so the
    //    editor sees the complete checklist in one round-trip.
    const [postsRes, charsRes] = await Promise.all([
      supabase
        .from("story_posts")
        .select("id, part_number, status, website_content")
        .eq("series_id", seriesId)
        .order("part_number", { ascending: true }),
      supabase
        .from("story_characters")
        .select("character_id, role")
        .eq("series_id", seriesId)
        .eq("role", "protagonist"),
    ]);

    if (postsRes.error) {
      console.error("publish-website: posts query failed", postsRes.error);
      return NextResponse.json(
        { error: "Publish failed", details: "Could not load posts" },
        { status: 500 }
      );
    }
    if (charsRes.error) {
      console.error("publish-website: characters query failed", charsRes.error);
      return NextResponse.json(
        { error: "Publish failed", details: "Could not load characters" },
        { status: 500 }
      );
    }

    const posts = postsRes.data ?? [];
    const protagonistLinks = charsRes.data ?? [];

    const failures: PreconditionFailure[] = [];

    // Cover approved (cover_status ∈ approved/compositing/complete).
    if (!COVER_READY_STATUSES.includes(series.cover_status)) {
      failures.push({
        key: "cover",
        message: "Cover has not been approved.",
      });
    }

    // Blurbs selected.
    if (
      series.blurb_short_selected === null ||
      series.blurb_short_selected === undefined
    ) {
      failures.push({
        key: "short_blurb",
        message: "Short blurb has not been selected.",
      });
    }
    if (
      series.blurb_long_selected === null ||
      series.blurb_long_selected === undefined
    ) {
      failures.push({
        key: "long_blurb",
        message: "Long blurb has not been selected.",
      });
    }

    // Protagonist with an approved portrait. Identity + approval live on
    // the base `characters` row; story_characters is just a link.
    if (protagonistLinks.length === 0) {
      failures.push({
        key: "protagonist",
        message:
          "No protagonist character is linked to this series.",
      });
    } else {
      const characterIds = protagonistLinks.map((c) => c.character_id);
      const { data: baseChars, error: baseCharsErr } = await supabase
        .from("characters")
        .select("id, approved_image_id")
        .in("id", characterIds);

      if (baseCharsErr) {
        console.error(
          "publish-website: base characters query failed",
          baseCharsErr
        );
        return NextResponse.json(
          {
            error: "Publish failed",
            details: "Could not verify protagonist approval",
          },
          { status: 500 }
        );
      }

      const approvedProtagonist = (baseChars ?? []).some(
        (c) => c.approved_image_id !== null
      );
      if (!approvedProtagonist) {
        failures.push({
          key: "protagonist",
          message:
            "At least one protagonist character must have an approved portrait.",
        });
      }
    }

    // All chapters have website_content populated.
    if (posts.length === 0) {
      failures.push({
        key: "posts",
        message: "Series has no posts.",
      });
    } else {
      const missing = posts.filter(
        (p) => !p.website_content || p.website_content.trim().length === 0
      );
      if (missing.length > 0) {
        failures.push({
          key: "website_content",
          message: `Missing website content for ${missing
            .map((p) => `Part ${p.part_number}`)
            .join(", ")}.`,
        });
      }
    }

    // All scene images approved (excluded rows don't gate publish — same
    // rule the per-post Publish to Facebook button uses).
    if (posts.length > 0) {
      const postIds = posts.map((p) => p.id);
      const { data: prompts, error: promptsErr } = await supabase
        .from("story_image_prompts")
        .select("id, status, excluded_from_publish, post_id")
        .in("post_id", postIds);

      if (promptsErr) {
        console.error(
          "publish-website: image prompts query failed",
          promptsErr
        );
        return NextResponse.json(
          {
            error: "Publish failed",
            details: "Could not verify image approval",
          },
          { status: 500 }
        );
      }

      const unapproved = (prompts ?? []).filter(
        (p) => !p.excluded_from_publish && p.status !== "approved"
      );
      if (unapproved.length > 0) {
        failures.push({
          key: "images",
          message: `${unapproved.length} scene image${
            unapproved.length === 1 ? "" : "s"
          } not yet approved.`,
        });
      }
    }

    if (failures.length > 0) {
      return NextResponse.json(
        { error: "Preconditions not met", failures },
        { status: 422 }
      );
    }

    // 3. Atomic publish. The RPC wraps both UPDATEs in one transaction;
    //    if the post update fails the series update rolls back.
    const { data: rpcData, error: rpcErr } = await supabase.rpc(
      "publish_story_to_website",
      { p_series_id: seriesId }
    );

    if (rpcErr) {
      console.error(
        "publish-website: publish_story_to_website RPC failed",
        rpcErr
      );
      return NextResponse.json(
        { error: "Publish failed", details: "Database error" },
        { status: 500 }
      );
    }

    const result = rpcData?.[0];

    return NextResponse.json({
      series_id: result?.out_series_id ?? seriesId,
      status: "published",
      published_at: result?.out_published_at ?? null,
      posts_updated: result?.out_posts_updated ?? 0,
    });
  } catch (err) {
    console.error("publish-website: unhandled error", err);
    return NextResponse.json(
      { error: "Publish failed" },
      { status: 500 }
    );
  }
}
