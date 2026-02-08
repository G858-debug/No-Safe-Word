import { NextRequest, NextResponse } from "next/server";

const CIVITAI_API_BASE = "https://civitai.com/api/v1";

export async function GET(request: NextRequest) {
  const apiKey = process.env.CIVITAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "CIVITAI_API_KEY is not configured" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get("endpoint") || "models";
  const limit = searchParams.get("limit") || "10";
  const query = searchParams.get("query") || "";

  const params = new URLSearchParams({ limit });
  if (query) params.set("query", query);

  const response = await fetch(`${CIVITAI_API_BASE}/${endpoint}?${params}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: `Civitai API error: ${response.statusText}` },
      { status: response.status }
    );
  }

  const data = await response.json();
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.CIVITAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "CIVITAI_API_KEY is not configured" },
      { status: 500 }
    );
  }

  const body = await request.json();

  const response = await fetch(`${CIVITAI_API_BASE}/consumer/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return NextResponse.json(
      { error: `Civitai API error: ${response.statusText}`, details: errorText },
      { status: response.status }
    );
  }

  const data = await response.json();
  return NextResponse.json(data);
}
