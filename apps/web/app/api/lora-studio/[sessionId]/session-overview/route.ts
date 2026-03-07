import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@no-safe-word/story-engine';

// GET /api/lora-studio/[sessionId]/session-overview
// Returns session metadata + image counts at each pipeline stage.
export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await props.params;

  const [sessionResult, imagesResult] = await Promise.all([
    (supabase as any)
      .from('nsw_lora_sessions')
      .select('id, name, status, replicate_training_id, replicate_training_url, lora_output_url, dataset_zip_url, created_at')
      .eq('id', sessionId)
      .single(),
    (supabase as any)
      .from('nsw_lora_images')
      .select('id, stage, status, human_approved, ai_approved, caption')
      .eq('session_id', sessionId),
  ]);

  if (sessionResult.error) {
    return NextResponse.json({ error: sessionResult.error.message }, { status: 404 });
  }

  if (imagesResult.error) {
    return NextResponse.json({ error: imagesResult.error.message }, { status: 500 });
  }

  const session = sessionResult.data;
  const images = (imagesResult.data ?? []) as Record<string, any>[];

  const anime = images.filter((i) => i.stage === 'anime');
  const converted = images.filter((i) => i.stage === 'converted');

  // Determine "final approved" count for converted stage
  const hasAiReview = converted.some((i) => i.ai_approved !== null);
  const finalApproved = hasAiReview
    ? converted.filter((i) => i.human_approved === true && i.ai_approved === true).length
    : converted.filter((i) => i.human_approved === true).length;

  const captioned = converted.filter(
    (i) => i.human_approved === true && i.caption,
  ).length;

  return NextResponse.json({
    session,
    counts: {
      animeTotal: anime.length,
      animeReady: anime.filter((i) => i.status === 'ready' || i.status === 'approved').length,
      animeApproved: anime.filter((i) => i.human_approved === true).length,
      convertedTotal: converted.length,
      convertedReady: converted.filter((i) => i.status === 'ready').length,
      convertedApproved: converted.filter((i) => i.human_approved === true).length,
      finalApproved,
      captioned,
    },
  });
}
