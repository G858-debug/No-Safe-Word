import { NextRequest, NextResponse } from "next/server";
import { getJobStatus, CivitaiError } from "@/lib/civitai";

export async function GET(
  _request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const { jobId } = params;

    if (!jobId) {
      return NextResponse.json(
        { error: "Missing jobId parameter" },
        { status: 400 }
      );
    }

    const job = await getJobStatus(jobId);

    return NextResponse.json({
      jobId: job.jobId,
      cost: job.cost,
      scheduled: job.scheduled,
      completed: job.result?.available ?? false,
      imageUrl: job.result?.blobUrl ?? null,
      imageUrlExpiration: job.result?.blobUrlExpirationDate ?? null,
    });
  } catch (err) {
    if (err instanceof CivitaiError) {
      return NextResponse.json(
        { error: err.message, details: err.details },
        { status: err.status }
      );
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
