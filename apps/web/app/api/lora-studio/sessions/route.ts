import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@no-safe-word/story-engine';

// GET /api/lora-studio/sessions
// Returns all sessions ordered by created_at DESC.
export async function GET() {
  const { data, error } = await (supabase as any)
    .from('nsw_lora_sessions')
    .select('id, name, status, target_approved_count, created_at, lora_output_url, replicate_training_id')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ sessions: data ?? [] });
}

// POST /api/lora-studio/sessions
// Body: { name: string, targetCount?: number }
// Creates a new session and returns it.
export async function POST(request: NextRequest) {
  const { name, targetCount } = (await request.json()) as {
    name: string;
    targetCount?: number;
  };

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Session name is required' }, { status: 400 });
  }

  const { data, error } = await (supabase as any)
    .from('nsw_lora_sessions')
    .insert({
      name: name.trim(),
      status: 'anime_generation',
      target_approved_count: targetCount ?? 100,
    })
    .select('id, name, status, target_approved_count, created_at')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ session: data }, { status: 201 });
}
