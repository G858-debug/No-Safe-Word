import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@no-safe-word/story-engine';

// POST /api/lora-studio/[sessionId]/approve-image
// Body: { imageId: string, approved: boolean }
// Sets human_approved on the image record.
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await props.params;

  const { imageId, approved } = (await request.json()) as {
    imageId: string;
    approved: boolean;
  };

  if (!imageId || typeof approved !== 'boolean') {
    return NextResponse.json(
      { error: 'imageId and approved (boolean) are required' },
      { status: 400 },
    );
  }

  const { error } = await (supabase as any)
    .from('nsw_lora_images')
    .update({ human_approved: approved })
    .eq('id', imageId)
    .eq('session_id', sessionId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}