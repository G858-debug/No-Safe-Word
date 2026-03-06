import { NextRequest, NextResponse } from "next/server";
import { getRunPodJobStatus } from "@no-safe-word/image-gen";

// GET /api/image-generator/status/[jobId]
// Returns: { completed: boolean, imageBase64?: string, error?: string, status?: string }
export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await props.params;

    const result = await getRunPodJobStatus(jobId);

    if (result.status === "COMPLETED") {
      if (!result.output?.images?.[0]) {
        return NextResponse.json({ completed: false, error: "No image returned" });
      }
      const imageData = result.output.images[0].data;
      const base64Data = imageData.includes(",") ? imageData.split(",")[1] : imageData;
      return NextResponse.json({ completed: true, imageBase64: base64Data });
    }

    if (result.status === "FAILED") {
      return NextResponse.json({ completed: false, error: result.error || "Job failed" });
    }

    if (result.status === "TIMED_OUT" || result.status === "CANCELLED") {
      return NextResponse.json({ completed: false, error: `Job ${result.status.toLowerCase()}` });
    }

    return NextResponse.json({ completed: false, status: result.status });
  } catch (err) {
    console.error("[ImageGenerator] Status check failed:", err);
    return NextResponse.json(
      { completed: false, error: err instanceof Error ? err.message : "Status check failed" },
      { status: 500 }
    );
  }
}
