import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// GET /api/stories — List all story series with status and counts
export async function GET() {
  const { data: series, error } = await supabase
    .from("story_series")
    .select(
      `
      *,
      story_posts (id, part_number, title, status),
      story_characters (
        id, role, approved,
        characters:character_id (id, name)
      )
    `
    )
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Enrich with image prompt counts per series
  const enriched = await Promise.all(
    (series || []).map(async (s) => {
      const postIds = (s.story_posts || []).map(
        (p: { id: string }) => p.id
      );

      let imageCounts = { total: 0, pending: 0, generated: 0, approved: 0, failed: 0 };

      if (postIds.length > 0) {
        const { data: prompts } = await supabase
          .from("story_image_prompts")
          .select("status")
          .in("post_id", postIds);

        if (prompts) {
          imageCounts = {
            total: prompts.length,
            pending: prompts.filter((p) => p.status === "pending").length,
            generated: prompts.filter((p) => p.status === "generated").length,
            approved: prompts.filter((p) => p.status === "approved").length,
            failed: prompts.filter((p) => p.status === "failed").length,
          };
        }
      }

      return {
        ...s,
        image_prompt_counts: imageCounts,
      };
    })
  );

  return NextResponse.json({ series: enriched });
}
