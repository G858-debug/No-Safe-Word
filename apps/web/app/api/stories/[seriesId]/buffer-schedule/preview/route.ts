// GET /api/stories/[seriesId]/buffer-schedule/preview
//
// Compute the publish-schedule plan WITHOUT calling Buffer or writing
// to the DB. The dashboard's "Preview Schedule" button hits this and
// renders the per-chapter dates so the operator can sanity-check
// before pulling the trigger on POST /buffer-schedule.

import { NextRequest, NextResponse } from "next/server";
import {
  buildScheduleForStory,
  ScheduleStartDateError,
} from "@/lib/server/schedule-chain";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const { seriesId } = await props.params;
  const url = new URL(request.url);
  const startDateParam = url.searchParams.get("startDate");

  try {
    const result = await buildScheduleForStory(seriesId, {
      startDate: startDateParam ? new Date(startDateParam) : undefined,
    });
    return NextResponse.json({
      plan: result.plan.map((p) => ({
        postId: p.postId,
        partNumber: p.partNumber,
        title: p.title,
        scheduledAt: p.scheduledAt.toISOString(),
        imageCount: p.imageUrls.length,
        hasFirstComment: !!p.firstComment,
      })),
      authorNote: result.authorNote
        ? {
            scheduledAt: result.authorNote.scheduledAt.toISOString(),
            socialCaption: result.authorNote.socialCaption,
            imageUrl: result.authorNote.imageUrl,
          }
        : null,
      startDate: result.startDate.toISOString(),
      chainTailDate: result.chainTailDate?.toISOString() ?? null,
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
        error: "Failed to build schedule preview",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
