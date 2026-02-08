import { NextRequest, NextResponse } from "next/server";

const CIVITAI_ORCHESTRATION_BASE = "https://orchestration.civitai.com/v1";

export async function GET(
  _request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const apiKey = process.env.CIVITAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "CIVITAI_API_KEY is not configured" },
      { status: 500 }
    );
  }

  const response = await fetch(
    `${CIVITAI_ORCHESTRATION_BASE}/consumer/jobs/${params.jobId}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );

  if (!response.ok) {
    return NextResponse.json(
      { error: `Civitai API error: ${response.statusText}` },
      { status: response.status }
    );
  }

  const data = await response.json();
  return NextResponse.json(data);
}
