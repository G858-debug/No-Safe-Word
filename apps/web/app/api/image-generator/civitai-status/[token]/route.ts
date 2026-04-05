import { NextRequest, NextResponse } from "next/server";
import { Civitai, JobEventType } from "civitai";

const FAILURE_EVENTS = new Set([
  JobEventType.FAILED,
  JobEventType.REJECTED,
  JobEventType.LATE_REJECTED,
  JobEventType.DELETED,
  JobEventType.EXPIRED,
]);

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const civitaiToken = process.env.CIVITAI_API_KEY;
  if (!civitaiToken) {
    return NextResponse.json({ error: "CIVITAI_API_KEY not configured" }, { status: 500 });
  }

  try {
    const { token } = await params;
    const civitai = new Civitai({ auth: civitaiToken });

    const result = await civitai.jobs.getByToken(token);

    if (!result.jobs || result.jobs.length === 0) {
      return NextResponse.json({ status: "pending" });
    }

    const job = result.jobs[0];

    console.log("[CivitAI status] job:", JSON.stringify({
      jobId: job.jobId,
      scheduled: job.scheduled,
      cost: job.cost,
      result: job.result,
      lastEvent: job.lastEvent,
    }, null, 2));

    // result is an array of blob objects: [{ blobUrl, blobKey, available, seed }]
    const resultItems: any[] = Array.isArray(job.result)
      ? job.result
      : job.result
        ? [(job.result as any)]
        : [];

    const completedItems = resultItems.filter((r) => r?.blobUrl);
    if (completedItems.length > 0) {
      const cost = job.cost ?? 0;
      return NextResponse.json({
        status: "completed",
        images: completedItems.map((r) => ({
          url: r.blobUrl as string,
          seed: r.seed ?? -1,
          cost,
        })),
      });
    }

    // Only treat as failed if CivitAI sent an explicit failure event
    const eventType = job.lastEvent?.type;
    if (eventType && FAILURE_EVENTS.has(eventType)) {
      const context = job.lastEvent?.context ? JSON.stringify(job.lastEvent.context) : "";
      return NextResponse.json({
        status: "failed",
        error: `Generation rejected by CivitAI (event: ${eventType}${context ? `, details: ${context}` : ""})`,
      });
    }

    // Still initialising or in queue
    return NextResponse.json({ status: "processing" });
  } catch (err) {
    console.error("[ImageGenerator] Status check failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Status check failed" },
      { status: 500 }
    );
  }
}
