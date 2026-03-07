import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@no-safe-word/story-engine';

const ALLOWED_STATUSES = [
  'anime_generation',
  'anime_approval',
  'flux_conversion',
  'flux_approval',
  'captioning',
  'training',
  'complete',
] as const;

type SessionStatus = (typeof ALLOWED_STATUSES)[number];

// POST /api/lora-studio/[sessionId]/advance-session
// Body: { status: SessionStatus }
// Updates nsw_lora_sessions.status to the requested value.
// Only allows forward progression through the pipeline statuses.
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await props.params;

  const { status } = (await request.json()) as { status: SessionStatus };

  if (!ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `Invalid status '${status}'. Must be one of: ${ALLOWED_STATUSES.join(', ')}` },
      { status: 400 },
    );
  }

  const { error } = await (supabase as any)
    .from('nsw_lora_sessions')
    .update({ status })
    .eq('id', sessionId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status });
}
