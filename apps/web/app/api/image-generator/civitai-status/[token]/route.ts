import { NextRequest, NextResponse } from "next/server";
import { Civitai } from "civitai";

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

    // Job has a completed image
    if (job.result && (job.result as any).blobUrl) {
      const blobUrl = (job.result as any).blobUrl as string;
      const seed = (job.job as any)?.params?.seed ?? -1;
      const cost = job.cost ?? 0;

      return NextResponse.json({
        status: "completed",
        images: [{ url: blobUrl, seed, cost }],
      });
    }

    // Job is no longer scheduled and has no result — it failed
    if (job.scheduled === false) {
      const eventType = job.lastEvent?.type ?? "unknown";
      const context = job.lastEvent?.context ? JSON.stringify(job.lastEvent.context) : "";
      return NextResponse.json({
        status: "failed",
        error: `Job ended without an image (event: ${eventType}${context ? `, context: ${context}` : ""})`,
      });
    }

    // Still in progress
    return NextResponse.json({ status: "processing" });
  } catch (err) {
    console.error("[ImageGenerator] Status check failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Status check failed" },
      { status: 500 }
    );
  }
}
