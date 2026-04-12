import { NextRequest, NextResponse } from "next/server";
import { approveIteration } from "@/lib/art-director/orchestrator";

/**
 * POST /api/art-director/approve
 *
 * Approve the final image from an art director job.
 * Stores it to Supabase and updates the story_image_prompts record.
 */
export async function POST(request: NextRequest) {
  try {
    const { jobId, iterationIndex } = await request.json();

    if (!jobId) {
      return NextResponse.json(
        { error: "jobId is required" },
        { status: 400 }
      );
    }

    const result = await approveIteration(jobId, iterationIndex);

    return NextResponse.json({
      ok: true,
      imageUrl: result.imageUrl,
    });
  } catch (err) {
    console.error("[Art Director Approve] Failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Approval failed" },
      { status: 500 }
    );
  }
}
