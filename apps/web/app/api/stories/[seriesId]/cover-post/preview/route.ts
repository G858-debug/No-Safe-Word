// GET /api/stories/[seriesId]/cover-post/preview
//
// Return the assembled cover-reveal post plan WITHOUT calling Buffer
// or writing to the DB. The dashboard's "Preview Cover Post" button
// hits this so the operator can sanity-check the body, hashtags, and
// first comment before scheduling.

import { NextRequest, NextResponse } from "next/server";
import {
  buildCoverPostPlan,
  CoverPostPlanError,
} from "@/lib/server/cover-post";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const { seriesId } = await props.params;
  const url = new URL(request.url);
  const scheduledAtParam = url.searchParams.get("scheduledAt");
  const ctaLineParam = url.searchParams.get("ctaLine");

  if (!scheduledAtParam) {
    return NextResponse.json(
      { error: "scheduledAt is required" },
      { status: 400 }
    );
  }
  if (!ctaLineParam) {
    return NextResponse.json(
      { error: "ctaLine is required" },
      { status: 400 }
    );
  }

  const scheduledAt = new Date(scheduledAtParam);
  if (Number.isNaN(scheduledAt.getTime())) {
    return NextResponse.json(
      { error: "scheduledAt is not a valid datetime" },
      { status: 400 }
    );
  }

  try {
    const plan = await buildCoverPostPlan(seriesId, scheduledAt, ctaLineParam);
    return NextResponse.json({
      seriesId: plan.seriesId,
      scheduledAt: plan.scheduledAt.toISOString(),
      text: plan.text,
      imageUrl: plan.imageUrl,
      firstComment: plan.firstComment,
    });
  } catch (err) {
    if (err instanceof CoverPostPlanError) {
      return NextResponse.json(
        { error: "Cover post not ready", details: err.message },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        error: "Failed to build cover post preview",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
