import { NextRequest, NextResponse } from 'next/server';

// LEGACY ROUTE — replaced by /api/stories/characters/[storyCharId]/train-lora
export async function POST(
  _request: NextRequest,
  _props: { params: Promise<{ characterId: string }> }
) {
  return NextResponse.json(
    {
      error: 'This endpoint has been removed. Use /api/stories/characters/[storyCharId]/train-lora instead.',
    },
    { status: 410 }
  );
}
