import { NextRequest, NextResponse } from "next/server";
import { Civitai, JobEventType } from "civitai";

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

    // Check if any job is still processing
    const allDone = result.jobs.every((job) => {
      const event = job.lastEvent;
      if (!event) return false;
      return event.type === JobEventType.SUCCEEDED || event.type === JobEventType.FAILED || event.type === JobEventType.DELETED;
    });

    if (!allDone) {
      return NextResponse.json({ status: "processing" });
    }

    // Check for failures
    const failed = result.jobs.some((job) => job.lastEvent?.type === JobEventType.FAILED || job.lastEvent?.type === JobEventType.DELETED);
    if (failed) {
      return NextResponse.json({ status: "failed", error: "CivitAI generation failed" });
    }

    // Extract image URLs from completed jobs
    const images = result.jobs
      .filter((job) => job.result)
      .flatMap((job) => {
        const jobResult = job.result as { blobKey?: string; available?: boolean } | undefined;
        if (jobResult?.blobKey) {
          return [{
            url: `https://orchestration.civitai.com/v1/consumer/jobs/${job.jobId}/result`,
            seed: (job.job as any)?.params?.seed || -1,
            cost: job.cost || 0,
          }];
        }
        return [];
      });

    return NextResponse.json({
      status: "completed",
      images,
      token: civitaiToken, // needed for auth header on blob download
    });
  } catch (err) {
    console.error("[ImageGenerator] Status check failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Status check failed" },
      { status: 500 }
    );
  }
}
