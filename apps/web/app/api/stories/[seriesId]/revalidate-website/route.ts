// POST /api/stories/[seriesId]/revalidate-website
//
// On-demand revalidation for a series's public website pages. The chapter
// detail page sets `export const revalidate = 3600`, which means edits to
// chapter rows or hero-flag toggles take up to an hour to surface for
// readers. This route forces an immediate refresh by calling
// revalidatePath() for the series root + each chapter's URL.
//
// Read-only beyond cache invalidation; safe to call repeatedly.
//
// Auth: middleware (apps/web/middleware.ts) gates every /api/stories/*
// route on the admin session cookie.

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { supabase } from "@no-safe-word/story-engine";

export async function POST(
  _request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const { seriesId } = await props.params;

  const { data: series, error: seriesErr } = await supabase
    .from("story_series")
    .select("id, slug")
    .eq("id", seriesId)
    .single();

  if (seriesErr || !series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  const { data: posts, error: postsErr } = await supabase
    .from("story_posts")
    .select("part_number")
    .eq("series_id", seriesId)
    .order("part_number", { ascending: true });

  if (postsErr) {
    return NextResponse.json(
      { error: `Failed to load posts: ${postsErr.message}` },
      { status: 500 }
    );
  }

  const paths: string[] = [];

  // Library + landing.
  paths.push("/stories");
  paths.push("/");

  // Series detail page.
  paths.push(`/stories/${series.slug}`);

  // Per-chapter detail pages.
  for (const post of posts ?? []) {
    paths.push(`/stories/${series.slug}/${post.part_number}`);
  }

  for (const path of paths) {
    revalidatePath(path);
  }

  return NextResponse.json({
    revalidated: paths,
    seriesSlug: series.slug,
    chapterCount: (posts ?? []).length,
  });
}
