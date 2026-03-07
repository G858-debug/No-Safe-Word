import { NextRequest, NextResponse } from 'next/server';
import { getRunPodJobStatus, base64ToBuffer } from '@no-safe-word/image-gen';
import { supabase } from '@no-safe-word/story-engine';

const CONVERTED_BUCKET = 'lora-converted-images';
// Max generating rows to check per poll — keep within request timeout
const MAX_TO_CHECK = 6;

// GET /api/lora-studio/[sessionId]/conversion-status
// Returns all converted-stage images for this session.
// For rows in 'generating' status: polls RunPod and stores the result when complete.
// Returns signed URLs for all ready images.
export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await props.params;

  const { data: images, error } = await (supabase as any)
    .from('nsw_lora_images')
    .select('*')
    .eq('session_id', sessionId)
    .eq('stage', 'converted')
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const imageList = (images ?? []) as Record<string, any>[];

  // Check RunPod status for generating rows
  const toCheck = imageList
    .filter((img) => img.status === 'generating' && img.replicate_prediction_id)
    .slice(0, MAX_TO_CHECK);

  if (toCheck.length > 0) {
    await Promise.allSettled(
      toCheck.map(async (img) => {
        try {
          const jobStatus = await getRunPodJobStatus(img.replicate_prediction_id);

          if (jobStatus.status === 'COMPLETED') {
            const imageOutput = jobStatus.output?.images?.[0];
            if (!imageOutput?.data) {
              await (supabase as any)
                .from('nsw_lora_images')
                .update({ status: 'rejected', ai_rejection_reason: 'No image data in RunPod output' })
                .eq('id', img.id);
              img.status = 'rejected';
              return;
            }

            // Decode base64 image from RunPod output
            const rawData: string = imageOutput.data;
            const base64Data = rawData.includes(',') ? rawData.split(',')[1] : rawData;
            const imageBuffer = base64ToBuffer(base64Data);

            // Upload to Supabase Storage
            const storagePath = `sessions/${sessionId}/${img.id}.jpg`;
            const { error: uploadErr } = await (supabase as any).storage
              .from(CONVERTED_BUCKET)
              .upload(storagePath, imageBuffer, { contentType: 'image/jpeg', upsert: true });

            if (uploadErr) {
              console.error('[conversion-status] Upload failed:', uploadErr.message);
              return; // Leave as 'generating' — will retry next poll
            }

            await (supabase as any)
              .from('nsw_lora_images')
              .update({ status: 'ready', converted_image_url: storagePath })
              .eq('id', img.id);

            img.status = 'ready';
            img.converted_image_url = storagePath;

          } else if (
            jobStatus.status === 'FAILED' ||
            jobStatus.status === 'CANCELLED' ||
            jobStatus.status === 'TIMED_OUT'
          ) {
            const reason = jobStatus.error ?? `Job ${jobStatus.status.toLowerCase()}`;
            await (supabase as any)
              .from('nsw_lora_images')
              .update({ status: 'rejected', ai_rejection_reason: reason })
              .eq('id', img.id);
            img.status = 'rejected';
            img.ai_rejection_reason = reason;
          }
        } catch (err) {
          console.error('[conversion-status] RunPod check failed for', img.id, err);
        }
      }),
    );
  }

  // Generate signed URLs for all ready converted images
  const signedUrls: Record<string, string> = {};
  const readyImages = imageList.filter((img) => img.status === 'ready' && img.converted_image_url);

  if (readyImages.length > 0) {
    await Promise.allSettled(
      readyImages.map(async (img) => {
        try {
          const { data } = await (supabase as any).storage
            .from(CONVERTED_BUCKET)
            .createSignedUrl(img.converted_image_url, 3600);
          if (data?.signedUrl) {
            signedUrls[img.id] = data.signedUrl;
          }
        } catch {
          // Non-fatal
        }
      }),
    );
  }

  const counts = {
    total: imageList.length,
    generating: imageList.filter((i) => i.status === 'generating').length,
    ready: imageList.filter((i) => i.status === 'ready').length,
    failed: imageList.filter((i) => i.status === 'rejected').length,
  };

  // Auto-advance session to flux_approval when all conversions are settled
  const allSettled = counts.total > 0 && counts.generating === 0;
  if (allSettled && counts.ready > 0) {
    const { data: sess } = await (supabase as any)
      .from('nsw_lora_sessions')
      .select('status')
      .eq('id', sessionId)
      .single();
    if (sess?.status === 'flux_conversion') {
      await (supabase as any)
        .from('nsw_lora_sessions')
        .update({ status: 'flux_approval' })
        .eq('id', sessionId);
    }
  }

  return NextResponse.json({ images: imageList, signedUrls, counts });
}
