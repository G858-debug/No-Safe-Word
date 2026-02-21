import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@no-safe-word/story-engine';
import { getPipelineProgress } from '@no-safe-word/image-gen';

// GET /api/characters/[characterId]/lora-status
// Returns current pipeline progress for the character's most recent LoRA training.
export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ characterId: string }> }
) {
  const { characterId } = await props.params;

  try {
    const progress = await getPipelineProgress(characterId, { supabase });

    if (!progress) {
      return NextResponse.json(
        { error: 'No LoRA training found for this character' },
        { status: 404 }
      );
    }

    return NextResponse.json(progress);
  } catch (error) {
    console.error('[lora-status] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
