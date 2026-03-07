import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@no-safe-word/story-engine';

const STORAGE_BUCKET = 'lora-anime-images';
// Process at most this many generating images per poll to stay within timeout
const MAX_TO_PROCESS = 5;

// GET /api/lora-studio/[sessionId]/anime-status
// Returns all nsw_lora_images for the session (anime stage).
// For images in 'generating' status, checks Replicate and completes
// storage when predictions succeed. Returns signed URLs for ready images.
export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await props.params;

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'REPLICATE_API_TOKEN not set' }, { status: 500 });
  }

  // Fetch all anime images for this session
  const { data: images, error } = await (supabase as any)
    .from('nsw_lora_images')
    .select('*')
    .eq('session_id', sessionId)
    .eq('stage', 'anime')
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const imageList = (images ?? []) as Record<string, any>[];

  // Find generating images with a prediction ID to check
  const toCheck = imageList
    .filter((img) => img.status === 'generating' && img.replicate_prediction_id)
    .slice(0, MAX_TO_PROCESS);

  if (toCheck.length > 0) {
    await Promise.allSettled(
      toCheck.map(async (img) => {
        try {
          const predRes = await fetch(
            `https://api.replicate.com/v1/predictions/${img.replicate_prediction_id}`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (!predRes.ok) return;

          const pred = await predRes.json();

          if (pred.status === 'succeeded' && pred.output) {
            // Replicate output is a URL string or array of URL strings
            const replicateUrl: string = Array.isArray(pred.output)
              ? pred.output[0]
              : pred.output;

            if (!replicateUrl) return;

            // Download from Replicate
            const imgRes = await fetch(replicateUrl);
            if (!imgRes.ok) return;
            const imgBuffer = await imgRes.arrayBuffer();
            const contentType = imgRes.headers.get('content-type') ?? 'image/jpeg';
            const ext = contentType.includes('png') ? 'png' : 'jpg';

            // Upload to Supabase Storage (private bucket)
            const storagePath = `sessions/${sessionId}/${img.id}.${ext}`;
            const { error: uploadErr } = await (supabase as any).storage
              .from(STORAGE_BUCKET)
              .upload(storagePath, imgBuffer, { contentType, upsert: true });

            if (uploadErr) {
              console.error('[anime-status] Storage upload failed:', uploadErr.message);
              return;
            }

            // Update DB: mark ready with storage path
            await (supabase as any)
              .from('nsw_lora_images')
              .update({ status: 'ready', anime_image_url: storagePath })
              .eq('id', img.id);

            // Patch the in-memory record so we include signed URL in this response
            img.status = 'ready';
            img.anime_image_url = storagePath;
          } else if (
            pred.status === 'failed' ||
            pred.status === 'canceled'
          ) {
            await (supabase as any)
              .from('nsw_lora_images')
              .update({
                status: 'rejected',
                ai_rejection_reason: pred.error ?? `Prediction ${pred.status}`,
              })
              .eq('id', img.id);

            img.status = 'rejected';
            img.ai_rejection_reason = pred.error ?? `Prediction ${pred.status}`;
          }
        } catch (err) {
          console.error('[anime-status] Check failed for', img.id, err);
        }
      }),
    );
  }

  // Generate signed URLs for all ready/approved images that have a storage path
  const signedUrls: Record<string, string> = {};
  const readyImages = imageList.filter(
    (img) => img.anime_image_url && (img.status === 'ready' || img.status === 'approved'),
  );

  if (readyImages.length > 0) {
    await Promise.allSettled(
      readyImages.map(async (img) => {
        try {
          const { data } = await (supabase as any).storage
            .from(STORAGE_BUCKET)
            .createSignedUrl(img.anime_image_url, 3600); // 1-hour expiry
          if (data?.signedUrl) {
            signedUrls[img.id] = data.signedUrl;
          }
        } catch {
          // Non-fatal — image will show without thumbnail this poll
        }
      }),
    );
  }

  // Counts for progress tracking
  const counts = {
    total: imageList.length,
    generating: imageList.filter((i) => i.status === 'generating').length,
    ready: imageList.filter((i) => i.status === 'ready' || i.status === 'approved').length,
    failed: imageList.filter((i) => i.status === 'rejected').length,
  };

  // Auto-advance session status to anime_approval when all images are settled
  const allSettled =
    counts.total === 200 &&
    counts.generating === 0;

  if (allSettled && counts.ready > 0) {
    const { data: sess } = await (supabase as any)
      .from('nsw_lora_sessions')
      .select('status')
      .eq('id', sessionId)
      .single();
    if (sess?.status === 'anime_generation') {
      await (supabase as any)
        .from('nsw_lora_sessions')
        .update({ status: 'anime_approval' })
        .eq('id', sessionId);
    }
  }

  return NextResponse.json({ images: imageList, signedUrls, counts });
}
