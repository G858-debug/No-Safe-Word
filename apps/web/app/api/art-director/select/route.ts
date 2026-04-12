import { NextRequest, NextResponse } from "next/server";
import { selectReference } from "@/lib/art-director/orchestrator";

/**
 * POST /api/art-director/select
 *
 * Step 4: Record the user's reference image selection.
 */
export async function POST(request: NextRequest) {
  try {
    const { jobId, referenceId } = await request.json();

    if (!jobId || referenceId == null) {
      return NextResponse.json(
        { error: "jobId and referenceId are required" },
        { status: 400 }
      );
    }

    await selectReference(jobId, referenceId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Art Director Select] Failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Selection failed" },
      { status: 500 }
    );
  }
}
