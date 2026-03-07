import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@no-safe-word/story-engine';

// Replicate SDXL model with LoRA weights URL support.
// RealVisXL V2 base — realistic proportions, accepts lora_weights URL parameter.
const REPLICATE_MODEL = 'lucataco/realvisxl-v2-with-lora';
const VENUS_BODY_LORA_URL = 'https://civitai.com/api/download/models/136081';

// POST /api/lora-studio/[sessionId]/generate-anime
// Triggers a single Replicate prediction for one anime training image.
// Creates (or updates on retry) an nsw_lora_images record.
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await props.params;

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'REPLICATE_API_TOKEN not set' }, { status: 500 });
  }

  const body = await request.json() as {
    prompt: string;
    negativePrompt: string;
    poseCategory: string;
    lightingCategory: string;
    clothingState: string;
    angleCategory: string;
  };

  const { prompt, negativePrompt, poseCategory, lightingCategory, clothingState, angleCategory } = body;

  if (!prompt) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
  }

  // Verify session exists
  const { data: session, error: sessionErr } = await (supabase as any)
    .from('nsw_lora_sessions')
    .select('id, status')
    .eq('id', sessionId)
    .single();

  if (sessionErr || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // Create the Replicate prediction (async — does not wait for completion)
  const replicateRes = await fetch(
    `https://api.replicate.com/v1/models/${REPLICATE_MODEL}/predictions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'respond-async',
      },
      body: JSON.stringify({
        input: {
          prompt,
          negative_prompt: negativePrompt,
          lora_weights: VENUS_BODY_LORA_URL,
          lora_scale: 0.75,
          width: 768,
          height: 1152,
          num_inference_steps: 30,
          guidance_scale: 7.5,
          seed: Math.floor(Math.random() * 2_147_483_647),
        },
      }),
    },
  );

  if (!replicateRes.ok) {
    const errText = await replicateRes.text();
    console.error('[lora-studio/generate-anime] Replicate error:', errText);
    return NextResponse.json(
      { error: `Replicate API error: ${replicateRes.status}`, detail: errText },
      { status: 502 },
    );
  }

  const prediction = await replicateRes.json();
  const predictionId: string = prediction.id;

  // Upsert the nsw_lora_images record (handles retries cleanly)
  const { data: existing } = await (supabase as any)
    .from('nsw_lora_images')
    .select('id')
    .eq('session_id', sessionId)
    .eq('anime_prompt', prompt)
    .maybeSingle();

  let imageId: string;

  if (existing) {
    await (supabase as any)
      .from('nsw_lora_images')
      .update({
        status: 'generating',
        replicate_prediction_id: predictionId,
        anime_image_url: null,
      })
      .eq('id', existing.id);
    imageId = existing.id;
  } else {
    const { data: inserted, error: insertErr } = await (supabase as any)
      .from('nsw_lora_images')
      .insert({
        session_id: sessionId,
        stage: 'anime',
        status: 'generating',
        anime_prompt: prompt,
        replicate_prediction_id: predictionId,
        pose_category: poseCategory,
        lighting_category: lightingCategory,
        clothing_state: clothingState,
        angle_category: angleCategory,
      })
      .select('id')
      .single();

    if (insertErr || !inserted) {
      return NextResponse.json(
        { error: `DB insert failed: ${insertErr?.message}` },
        { status: 500 },
      );
    }
    imageId = inserted.id;
  }

  return NextResponse.json({ imageId, predictionId });
}
