import { NextRequest, NextResponse } from 'next/server';
import { getRunPodJobStatus, base64ToBuffer } from '@no-safe-word/image-gen';
import { supabase } from '@no-safe-word/story-engine';

const CONVERTED_BUCKET = 'lora-converted-images';

// POST /api/lora-studio/[sessionId]/store-converted-image
// Body: { imageId: string }
// Manually triggers storage for a specific converted image.
// Looks up the RunPod job ID from the DB, fetches the output, uploads to storage.
// Useful for retrying failed storage after a RunPod job succeeded.
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await props.params;

  const { imageId } = (await request.json()) as { imageId: string };
  if (!imageId) {
    return NextResponse.json({ error: 'imageId is required' }, { status: 400 });
  }

  const { data: img, error: fetchErr } = await (supabase as any)
    .from('nsw_lora_images')
    .select('id, replicate_prediction_id, converted_image_url, status, session_id')
    .eq('id', imageId)
    .eq('session_id', sessionId)
    .eq('stage', 'converted')
    .single();

  if (fetchErr || !img) {
    return NextResponse.json({ error: 'Converted image record not found' }, { status: 404 });
  }

  if (!img.replicate_prediction_id) {
    return NextResponse.json({ error: 'No RunPod job ID on record' }, { status: 400 });
  }

  // Already stored — return existing signed URL
  if (img.status === 'ready' && img.converted_image_url) {
    const { data: signed } = await (supabase as any).storage
      .from(CONVERTED_BUCKET)
      .createSignedUrl(img.converted_image_url, 3600);
    return NextResponse.json({ storagePath: img.converted_image_url, signedUrl: signed?.signedUrl });
  }

  // Fetch job status from RunPod
  let jobStatus;
  try {
    jobStatus = await getRunPodJobStatus(img.replicate_prediction_id);
  } catch (err) {
    return NextResponse.json(
      { error: `RunPod status fetch failed: ${err instanceof Error ? err.message : err}` },
      { status: 502 },
    );
  }

  if (jobStatus.status !== 'COMPLETED' || !jobStatus.output?.images?.[0]) {
    return NextResponse.json(
      { error: `Job not ready (status: ${jobStatus.status})` },
      { status: 409 },
    );
  }

  const rawData: string = jobStatus.output.images[0].data;
  const base64Data = rawData.includes(',') ? rawData.split(',')[1] : rawData;
  const imageBuffer = base64ToBuffer(base64Data);

  const storagePath = `sessions/${sessionId}/${imageId}.jpg`;
  const { error: uploadErr } = await (supabase as any).storage
    .from(CONVERTED_BUCKET)
    .upload(storagePath, imageBuffer, { contentType: 'image/jpeg', upsert: true });

  if (uploadErr) {
    return NextResponse.json(
      { error: `Storage upload failed: ${uploadErr.message}` },
      { status: 500 },
    );
  }

  await (supabase as any)
    .from('nsw_lora_images')
    .update({ status: 'ready', converted_image_url: storagePath })
    .eq('id', imageId);

  const { data: signed } = await (supabase as any).storage
    .from(CONVERTED_BUCKET)
    .createSignedUrl(storagePath, 3600);

  return NextResponse.json({ storagePath, signedUrl: signed?.signedUrl });
}
