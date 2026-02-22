import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@no-safe-word/story-engine';
import { runPipeline } from '@no-safe-word/image-gen/server/character-lora';
import type { CharacterInput, CharacterStructured } from '@no-safe-word/image-gen';

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

    // 2. Find the approved story_character record (both portrait and full-body must be approved)
    let storyCharQuery = supabase
      .from('story_characters')
      .select('id, approved, approved_image_id, approved_seed, approved_prompt, approved_fullbody, approved_fullbody_image_id, approved_fullbody_seed')
      .eq('character_id', characterId)
      .eq('approved', true)
      .eq('approved_fullbody', true);

    if (seriesId) {
      storyCharQuery = storyCharQuery.eq('series_id', seriesId);
    }

    const { data: storyChar, error: scError } = await storyCharQuery
      .limit(1)
      .single();

    if (scError || !storyChar) {
      return NextResponse.json(
        { error: 'Both portrait and full-body must be approved before LoRA training.' },
        { status: 400 }
      );
    }

    if (!storyChar.approved_image_id || !storyChar.approved_fullbody_image_id) {
      return NextResponse.json(
        { error: 'Character is approved but missing image IDs for portrait or full-body' },
        { status: 400 }
      );
    }

    // 3. Get the approved image URLs for both portrait and full-body
    const [portraitImage, fullBodyImage] = await Promise.all([
      supabase.from('images').select('stored_url, sfw_url').eq('id', storyChar.approved_image_id).single(),
      supabase.from('images').select('stored_url, sfw_url').eq('id', storyChar.approved_fullbody_image_id).single(),
    ]);

    const portraitUrl = portraitImage.data?.stored_url || portraitImage.data?.sfw_url;
    const fullBodyUrl = fullBodyImage.data?.stored_url || fullBodyImage.data?.sfw_url;

    if (!portraitUrl || !fullBodyUrl) {
      return NextResponse.json(
        { error: 'Could not find stored URLs for approved images' },
        { status: 400 }
      );
    }

    // 4. Check for existing active/in-progress LoRA
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
    const desc = character.description as Record<string, string> | null;
    const gender = desc?.gender || 'female';

    const { data: loraRecord, error: createError } = await (supabase as any)
      .from('character_loras')
      .insert({
        character_id: characterId,
        filename: '',
        storage_path: '',
        trigger_word: 'tok',
        base_model: 'sdxl',
        training_provider: 'replicate',
        training_params: {},
        dataset_size: 0,
        training_attempts: 0,
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

    // 6. Build structured data and character input
    const structuredData: CharacterStructured = {
      gender: desc?.gender || 'female',
      ethnicity: desc?.ethnicity || '',
      bodyType: desc?.bodyType || '',
      skinTone: desc?.skinTone || '',
      hairColor: desc?.hairColor || '',
      hairStyle: desc?.hairStyle || '',
      eyeColor: desc?.eyeColor || '',
      age: desc?.age || '',
      distinguishingFeatures: desc?.distinguishingFeatures,
    };

    const characterInput: CharacterInput = {
      characterId,
      characterName: character.name,
      gender,
      approvedImageUrl: portraitUrl,
      approvedPrompt: storyChar.approved_prompt || '',
      fullBodyImageUrl: fullBodyUrl,
      fullBodySeed: storyChar.approved_fullbody_seed || 42,
      portraitSeed: storyChar.approved_seed || 42,
      structuredData,
      pipelineType: 'story_character',
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
