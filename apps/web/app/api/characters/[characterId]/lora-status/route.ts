import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@no-safe-word/story-engine';

// GET /api/characters/[characterId]/lora-status
// Returns current pipeline progress for the character's most recent LoRA training.
export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ characterId: string }> }
) {
  const { characterId } = await props.params;

  try {
    const { data: lora, error: loraError } = await supabase
      .from('character_loras')
      .select('id, status, error, created_at, updated_at')
      .eq('character_id', characterId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (loraError || !lora) {
      return NextResponse.json(
        { error: 'No LoRA training found for this character' },
        { status: 404 }
      );
    }

    return NextResponse.json(lora);
  } catch (error) {
    console.error('[lora-status] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
