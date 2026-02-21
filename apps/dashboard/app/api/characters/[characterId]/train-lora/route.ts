import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@no-safe-word/story-engine';
import { runPipeline } from '@no-safe-word/image-gen';
import type { CharacterInput } from '@no-safe-word/image-gen';

// POST /api/characters/[characterId]/train-lora
// Kicks off the full LoRA training pipeline. Returns immediately with a loraId.
// Query params: ?seriesId=xxx (to find the story_character record with approved portrait)
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ characterId: string }> }
) {
  const { characterId } = await props.params;
  const seriesId = request.nextUrl.searchParams.get('seriesId');

  try {
    // 1. Fetch the character
    const { data: character, error: charError } = await supabase
      .from('characters')
      .select('id, name, description')
      .eq('id', characterId)
      .single();

    if (charError || !character) {
      return NextResponse.json(
        { error: 'Character not found' },
        { status: 404 }
      );
    }

    // 2. Find the approved story_character record
    let storyCharQuery = supabase
      .from('story_characters')
      .select('id, approved, approved_image_id, approved_prompt')
      .eq('character_id', characterId)
      .eq('approved', true);

    if (seriesId) {
      storyCharQuery = storyCharQuery.eq('series_id', seriesId);
    }

    const { data: storyChar, error: scError } = await storyCharQuery
      .limit(1)
      .single();

    if (scError || !storyChar) {
      return NextResponse.json(
        { error: 'No approved portrait found for this character. Approve a portrait first.' },
        { status: 400 }
      );
    }

    if (!storyChar.approved_image_id) {
      return NextResponse.json(
        { error: 'Character is approved but has no approved image ID' },
        { status: 400 }
      );
    }

    // 3. Get the approved image URL
    const { data: image, error: imgError } = await supabase
      .from('images')
      .select('id, stored_url, sfw_url')
      .eq('id', storyChar.approved_image_id)
      .single();

    if (imgError || !image) {
      return NextResponse.json(
        { error: 'Approved image not found in database' },
        { status: 404 }
      );
    }

    const approvedImageUrl = image.stored_url || image.sfw_url;
    if (!approvedImageUrl) {
      return NextResponse.json(
        { error: 'Approved image has no URL' },
        { status: 400 }
      );
    }

    // 4. Check for existing active/in-progress LoRA
    // Note: character_loras table is not in auto-generated types yet, so we use 'as any'
    const { data: existingLora } = await (supabase as any)
      .from('character_loras')
      .select('id, status')
      .eq('character_id', characterId)
      .in('status', ['pending', 'generating_dataset', 'evaluating', 'captioning', 'training', 'validating'])
      .limit(1)
      .single() as { data: { id: string; status: string } | null };

    if (existingLora) {
      return NextResponse.json(
        {
          error: `LoRA training already in progress (status: ${existingLora.status})`,
          loraId: existingLora.id,
        },
        { status: 409 }
      );
    }

    // 5. Create the character_loras record
    const description = character.description as Record<string, string> | null;
    const gender = description?.gender || 'female';

    const { data: loraRecord, error: createError } = await (supabase as any)
      .from('character_loras')
      .insert({
        character_id: characterId,
        filename: '',
        storage_path: '',
        trigger_word: 'tok',
        base_model: 'lustify-v5-endgame',
        training_provider: 'replicate',
        status: 'pending',
      })
      .select()
      .single() as { data: { id: string } | null; error: any };

    if (createError || !loraRecord) {
      return NextResponse.json(
        { error: `Failed to create LoRA record: ${createError?.message}` },
        { status: 500 }
      );
    }

    // 6. Build character input
    const characterInput: CharacterInput = {
      characterId,
      characterName: character.name,
      gender,
      approvedImageUrl,
      approvedPrompt: storyChar.approved_prompt || '',
    };

    // 7. Fire off pipeline (no await — runs in background)
    runPipeline(characterInput, loraRecord.id, { supabase }).catch((err) => {
      console.error(`[train-lora] Background pipeline error: ${err}`);
    });

    return NextResponse.json({
      loraId: loraRecord.id,
      status: 'generating_dataset',
      message: 'LoRA training pipeline started',
    });
  } catch (error) {
    console.error('[train-lora] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
