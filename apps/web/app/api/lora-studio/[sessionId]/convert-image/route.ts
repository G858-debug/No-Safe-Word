import { NextRequest, NextResponse } from 'next/server';
import {
  buildKontextWorkflow,
  submitRunPodJob,
  imageUrlToBase64,
} from '@no-safe-word/image-gen';
import { supabase } from '@no-safe-word/story-engine';

const ANIME_BUCKET = 'lora-anime-images';

const CONVERSION_LORAS = [
  { filename: 'flux_realism_lora.safetensors', strengthModel: 0.85, strengthClip: 0.85 },
  { filename: 'flux-add-details.safetensors', strengthModel: 0.7, strengthClip: 0.7 },
];

function buildConversionPrompt(
  poseCategory: string | null,
  clothingState: string | null,
  lightingCategory: string | null,
  angleCategory: string | null,
): string {
  const posePart = poseCategory ? `, ${poseCategory.replace(/_/g, ' ')} pose` : '';
  const clothingPart = clothingState ? `, ${clothingState.replace(/_/g, ' ')}` : '';
  const lightingPart = lightingCategory ? `, ${lightingCategory.replace(/_/g, ' ')} lighting` : '';
  const anglePart = angleCategory ? `, ${angleCategory.replace(/_/g, ' ')} angle` : '';

  return (
    'Photorealistic photograph, Black South African woman, dark brown skin, curvaceous figure, ' +
    'large breasts, wide hips, thick thighs, small waist, hourglass body proportions' +
    posePart +
    clothingPart +
    lightingPart +
    anglePart +
    ', hyperrealistic skin texture, photographic quality, shot on camera, 8k'
  );
}

// POST /api/lora-studio/[sessionId]/convert-image
// Body: { imageId: string }
// Starts a Flux Kontext img2img conversion job for a final-approved anime image.
// Creates a new nsw_lora_images row (stage='converted') linked to the source via anime_prompt.
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await props.params;

  const { imageId } = (await request.json()) as { imageId: string };
  if (!imageId) {
    return NextResponse.json({ error: 'imageId is required' }, { status: 400 });
  }

  // Fetch the source anime image record
  const { data: img, error: fetchErr } = await (supabase as any)
    .from('nsw_lora_images')
    .select('id, anime_image_url, pose_category, clothing_state, lighting_category, angle_category, human_approved, ai_approved, status')
    .eq('id', imageId)
    .eq('session_id', sessionId)
    .eq('stage', 'anime')
    .single();

  if (fetchErr || !img) {
    return NextResponse.json({ error: 'Anime image record not found' }, { status: 404 });
  }

  if (!img.anime_image_url) {
    return NextResponse.json({ error: 'Anime image has no storage URL' }, { status: 400 });
  }

  // Get a signed URL to download the anime image
  const { data: signed } = await (supabase as any).storage
    .from(ANIME_BUCKET)
    .createSignedUrl(img.anime_image_url, 120); // 2-minute window to download

  if (!signed?.signedUrl) {
    return NextResponse.json({ error: 'Failed to create signed URL for anime image' }, { status: 500 });
  }

  // Convert anime image to base64 for RunPod input
  let imageBase64: string;
  try {
    imageBase64 = await imageUrlToBase64(signed.signedUrl);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to download anime image: ${err instanceof Error ? err.message : err}` },
      { status: 502 },
    );
  }

  // Build the conversion prompt from stored metadata
  const prompt = buildConversionPrompt(
    img.pose_category,
    img.clothing_state,
    img.lighting_category,
    img.angle_category,
  );

  // Build the img2img ComfyUI workflow
  const workflow = buildKontextWorkflow({
    type: 'img2img',
    positivePrompt: prompt,
    width: 768,
    height: 1152,
    seed: Math.floor(Math.random() * 2_147_483_647),
    filenamePrefix: `lora-converted/${sessionId}/${imageId}`,
    sfwMode: true,
    loras: CONVERSION_LORAS,
    denoiseStrength: 0.72,
  });

  // Submit to RunPod (async)
  let jobId: string;
  try {
    const result = await submitRunPodJob(
      workflow,
      [{ name: 'input.jpg', image: imageBase64 }],
    );
    jobId = result.jobId;
  } catch (err) {
    return NextResponse.json(
      { error: `RunPod submission failed: ${err instanceof Error ? err.message : err}` },
      { status: 502 },
    );
  }

  // Check if a converted row already exists for this source image
  const { data: existing } = await (supabase as any)
    .from('nsw_lora_images')
    .select('id')
    .eq('session_id', sessionId)
    .eq('stage', 'converted')
    .eq('anime_prompt', imageId) // anime_prompt stores source image ID for converted rows
    .maybeSingle();

  if (existing) {
    // Retry — reset the existing converted row
    await (supabase as any)
      .from('nsw_lora_images')
      .update({
        status: 'generating',
        replicate_prediction_id: jobId,
        converted_image_url: null,
      })
      .eq('id', existing.id);

    return NextResponse.json({ jobId, convertedImageId: existing.id });
  }

  // Insert new converted row — anime_prompt holds the source image ID as the link
  const { data: inserted, error: insertErr } = await (supabase as any)
    .from('nsw_lora_images')
    .insert({
      session_id: sessionId,
      stage: 'converted',
      status: 'generating',
      anime_prompt: imageId, // stores source anime image ID
      replicate_prediction_id: jobId,
      pose_category: img.pose_category,
      lighting_category: img.lighting_category,
      clothing_state: img.clothing_state,
      angle_category: img.angle_category,
    })
    .select('id')
    .single();

  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: `DB insert failed: ${insertErr?.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ jobId, convertedImageId: inserted.id });
}
