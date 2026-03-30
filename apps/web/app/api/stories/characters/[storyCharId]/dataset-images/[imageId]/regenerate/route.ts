import { NextRequest, NextResponse } from "next/server";

// POST /api/stories/characters/[storyCharId]/dataset-images/[imageId]/regenerate
// Temporarily stubbed — dataset image regeneration is being rebuilt for the Pony pipeline.
export async function POST(
  _request: NextRequest,
  _props: { params: Promise<{ storyCharId: string; imageId: string }> }
) {
  return NextResponse.json(
    { error: "Dataset image regeneration is being rebuilt for Pony pipeline" },
    { status: 501 }
  );
}
