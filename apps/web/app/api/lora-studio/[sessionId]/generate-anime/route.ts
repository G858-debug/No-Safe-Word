import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@no-safe-word/story-engine';
import { submitRunPodJob } from '@no-safe-word/image-gen/runpod';

// ComfyUI workflow template for RealVisXL V5.0 + Curvy body SDXL LoRA.
// Runs on existing RunPod ComfyUI serverless endpoint.
function buildWorkflow(prompt: string, negativePrompt: string, seed: number) {
  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: 'realvisxlV50_v50Bakedvae.safetensors' },
    },
    '2': {
      class_type: 'LoraLoader',
      inputs: {
        lora_name: 'curvy-body-sdxl.safetensors',
        strength_model: 0.85,
        strength_clip: 0.85,
        model: ['1', 0],
        clip: ['1', 1],
      },
    },
    // Skin realism LoRA — adds pores, imperfections, natural skin texture
    '9': {
      class_type: 'LoraLoader',
      inputs: {
        lora_name: 'skin-realism-sdxl.safetensors',
        strength_model: 0.35,
        strength_clip: 0.35,
        model: ['2', 0],
        clip: ['2', 1],
      },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: prompt, clip: ['9', 1] },
    },
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: { text: negativePrompt, clip: ['9', 1] },
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { width: 768, height: 1152, batch_size: 1 },
    },
    '6': {
      class_type: 'KSampler',
      inputs: {
        model: ['9', 0],
        positive: ['3', 0],
        negative: ['4', 0],
        latent_image: ['5', 0],
        seed,
        steps: 35,
        cfg: 5.0,
        sampler_name: 'dpmpp_sde',
        scheduler: 'karras',
        denoise: 1.0,
      },
    },
    '7': {
      class_type: 'VAEDecode',
      inputs: { samples: ['6', 0], vae: ['1', 2] },
    },
    '8': {
      class_type: 'SaveImage',
      inputs: { images: ['7', 0], filename_prefix: 'body_gen' },
    },
  };
}

// POST /api/lora-studio/[sessionId]/generate-anime
// Triggers a RunPod ComfyUI job for one body training image.
// Creates (or updates on retry) an nsw_lora_images record.
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await props.params;

  console.log('[generate-anime] POST hit, sessionId:', sessionId);

  const body = await request.json() as {
    prompt: string;
    negativePrompt: string;
    poseCategory: string;
    lightingCategory: string;
    clothingState: string;
    angleCategory: string;
    promptIndex?: number;
  };

  const { prompt, negativePrompt, poseCategory, lightingCategory, clothingState, angleCategory, promptIndex } = body;

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
    console.error('[generate-anime] Session not found:', sessionId, sessionErr?.message);
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  console.log('[generate-anime] Session found, submitting RunPod job...');

  const seed = Math.floor(Math.random() * 2_147_483_647);
  const workflow = buildWorkflow(prompt, negativePrompt, seed);

  let jobId: string;
  try {
    const result = await submitRunPodJob(workflow);
    jobId = result.jobId;
  } catch (err: any) {
    console.error('[generate-anime] RunPod submit error:', err.message);
    return NextResponse.json(
      { error: `RunPod API error: ${err.message}` },
      { status: 502 },
    );
  }

  // Upsert the nsw_lora_images record (handles retries cleanly)
  // Store RunPod job ID in replicate_prediction_id column (reused for polling)
  // Match by prompt_index (preferred) or fall back to anime_prompt for old records
  let existingQuery = (supabase as any)
    .from('nsw_lora_images')
    .select('id')
    .eq('session_id', sessionId);

  if (promptIndex != null) {
    existingQuery = existingQuery.eq('prompt_index', promptIndex);
  } else {
    existingQuery = existingQuery.eq('anime_prompt', prompt);
  }

  const { data: existing } = await existingQuery.maybeSingle();

  let imageId: string;

  if (existing) {
    await (supabase as any)
      .from('nsw_lora_images')
      .update({
        status: 'generating',
        replicate_prediction_id: jobId,
        anime_image_url: null,
        anime_prompt: prompt,
        ...(promptIndex != null ? { prompt_index: promptIndex } : {}),
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
        replicate_prediction_id: jobId,
        pose_category: poseCategory,
        lighting_category: lightingCategory,
        clothing_state: clothingState,
        angle_category: angleCategory,
        ...(promptIndex != null ? { prompt_index: promptIndex } : {}),
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

  console.log('[generate-anime] imageId:', imageId, 'runpodJobId:', jobId);
  return NextResponse.json({ imageId, predictionId: jobId });
}
