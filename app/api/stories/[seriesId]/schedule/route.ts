import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// POST /api/stories/[seriesId]/schedule — Schedule all posts in a series
export async function POST(
  request: NextRequest,
  { params }: { params: { seriesId: string } }
) {
  const { seriesId } = params;

  try {
    const body = await request.json();
    const { start_date, interval_days, time } = body as {
      start_date: string;
      interval_days: number;
      time: string; // HH:MM
    };

    if (!start_date || !interval_days || !time) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: start_date (ISO date), interval_days (number), time (HH:MM)",
        },
        { status: 400 }
      );
    }

    // Validate time format
    if (!/^\d{2}:\d{2}$/.test(time)) {
      return NextResponse.json(
        { error: "time must be in HH:MM format" },
        { status: 400 }
      );
    }

    // Fetch all posts in the series, ordered by part number
    const { data: posts, error: postsError } = await supabase
      .from("story_posts")
      .select("id, part_number, status")
      .eq("series_id", seriesId)
      .order("part_number", { ascending: true });

    if (postsError) {
      return NextResponse.json(
        { error: postsError.message },
        { status: 500 }
      );
    }

    if (!posts || posts.length === 0) {
      return NextResponse.json(
        { error: "No posts found for this series" },
        { status: 404 }
      );
    }

    // Calculate scheduled dates for each post
    const [hours, minutes] = time.split(":").map(Number);
    const baseDate = new Date(start_date);
    baseDate.setUTCHours(hours, minutes, 0, 0);

    const schedule: { part_number: number; scheduled_for: string }[] = [];

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];

      // Skip already-published posts
      if (post.status === "published") {
        continue;
      }

      const scheduledDate = new Date(baseDate);
      scheduledDate.setUTCDate(scheduledDate.getUTCDate() + i * interval_days);
      const scheduledFor = scheduledDate.toISOString();

      const { error: updateError } = await supabase
        .from("story_posts")
        .update({
          scheduled_for: scheduledFor,
          status: "scheduled",
        })
        .eq("id", post.id);

      if (updateError) {
        console.error(
          `Failed to schedule post ${post.part_number}:`,
          updateError.message
        );
        continue;
      }

      schedule.push({
        part_number: post.part_number,
        scheduled_for: scheduledFor,
      });
    }

    // Update series status
    await supabase
      .from("story_series")
      .update({ status: "scheduled" })
      .eq("id", seriesId);

    return NextResponse.json({ schedule });
  } catch (err) {
    console.error("Scheduling failed:", err);
    return NextResponse.json(
      {
        error: "Scheduling failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
