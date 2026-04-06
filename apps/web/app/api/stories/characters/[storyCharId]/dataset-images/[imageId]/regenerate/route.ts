import { NextRequest, NextResponse } from "next/server";

// POST /api/stories/characters/[storyCharId]/dataset-images/[imageId]/regenerate
// Temporarily stubbed — dataset image regeneration is being rebuilt for the Juggernaut Ragnarok pipeline.
export async function POST(
  _request: NextRequest,
  _props: { params: Promise<{ storyCharId: string; imageId: string }> }
) {
  return NextResponse.json(
    { error: "Dataset image regeneration is being rebuilt for Juggernaut Ragnarok pipeline" },
    { status: 501 }
  );
}
