import { NextRequest, NextResponse } from "next/server";

// POST /api/stories/characters/[storyCharId]/generate-more-dataset
// Temporarily stubbed — dataset top-up is being rebuilt for the Juggernaut Ragnarok pipeline.
export async function POST(
  _request: NextRequest,
  _props: { params: Promise<{ storyCharId: string }> }
) {
  return NextResponse.json(
    { error: "Dataset top-up is being rebuilt for Juggernaut Ragnarok pipeline" },
    { status: 501 }
  );
}
