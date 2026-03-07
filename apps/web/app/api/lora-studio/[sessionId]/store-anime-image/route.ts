import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@no-safe-word/story-engine';

const STORAGE_BUCKET = 'lora-anime-images';

// POST /api/lora-studio/[sessionId]/store-anime-image
// Manually triggers storage for a specific image — useful for retrying
// failed storage after the Replicate prediction succeeded.
// Looks up the prediction ID from the DB, fetches the output URL from
// Replicate, downloads the image, uploads to Supabase Storage.
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await props.params;

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'REPLICATE_API_TOKEN not set' }, { status: 500 });
  }

  const { imageId } = await request.json() as { imageId: string };

  if (!imageId) {
    return NextResponse.json({ error: 'imageId is required' }, { status: 400 });
  }

  // Fetch the image record
  const { data: img, error: fetchErr } = await (supabase as any)
    .from('nsw_lora_images')
    .select('id, replicate_prediction_id, anime_image_url, status, session_id')
    .eq('id', imageId)
    .eq('session_id', sessionId)
    .single();

  if (fetchErr || !img) {
    return NextResponse.json({ error: 'Image record not found' }, { status: 404 });
  }

  if (!img.replicate_prediction_id) {
    return NextResponse.json({ error: 'No Replicate prediction ID on record' }, { status: 400 });
  }

  // Already stored — return existing path
  if (img.status === 'ready' && img.anime_image_url) {
    const { data: signed } = await (supabase as any).storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(img.anime_image_url, 3600);
    return NextResponse.json({ storagePath: img.anime_image_url, signedUrl: signed?.signedUrl });
  }

  // Fetch prediction from Replicate
  const predRes = await fetch(
    `https://api.replicate.com/v1/predictions/${img.replicate_prediction_id}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!predRes.ok) {
    return NextResponse.json(
      { error: `Replicate fetch failed: ${predRes.status}` },
      { status: 502 },
    );
  }

  const pred = await predRes.json();

  if (pred.status !== 'succeeded' || !pred.output) {
    return NextResponse.json(
      { error: `Prediction is not ready (status: ${pred.status})` },
      { status: 409 },
    );
  }

  const replicateUrl: string = Array.isArray(pred.output) ? pred.output[0] : pred.output;

  // Download image from Replicate
  const imgRes = await fetch(replicateUrl);
  if (!imgRes.ok) {
    return NextResponse.json(
      { error: `Failed to download from Replicate: ${imgRes.status}` },
      { status: 502 },
    );
  }

  const imgBuffer = await imgRes.arrayBuffer();
  const contentType = imgRes.headers.get('content-type') ?? 'image/jpeg';
  const ext = contentType.includes('png') ? 'png' : 'jpg';

  // Upload to Supabase Storage
  const storagePath = `sessions/${sessionId}/${imageId}.${ext}`;
  const { error: uploadErr } = await (supabase as any).storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, imgBuffer, { contentType, upsert: true });

  if (uploadErr) {
    return NextResponse.json(
      { error: `Storage upload failed: ${uploadErr.message}` },
      { status: 500 },
    );
  }

  // Update DB record
  await (supabase as any)
    .from('nsw_lora_images')
    .update({ status: 'ready', anime_image_url: storagePath })
    .eq('id', imageId);

  // Return signed URL for immediate display
  const { data: signed } = await (supabase as any).storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(storagePath, 3600);

  return NextResponse.json({ storagePath, signedUrl: signed?.signedUrl });
}
