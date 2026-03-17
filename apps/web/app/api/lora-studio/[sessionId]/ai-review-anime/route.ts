import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '@no-safe-word/story-engine';
import { anthropicCreateWithRetry } from '@no-safe-word/image-gen';

const STORAGE_BUCKET = 'lora-anime-images';

const AI_REVIEW_SYSTEM_PROMPT =
  "You are a quality assessor for a body LoRA training dataset. You are evaluating anime/illustrated images of Black women. Your job is to approve images that clearly show a curvaceous figure — specifically: large breasts, wide hips, thick thighs, small waist, hourglass proportions. The character must visibly be a Black woman with dark skin. Reject images where the body is slim or average, where anatomy is severely broken, where the character is not dark-skinned, or where the body is not visible. Respond in JSON only: { \"approved\": true/false, \"reason\": \"brief reason\" }";

// POST /api/lora-studio/[sessionId]/ai-review-anime
// Body: { imageIds: string[] }
// Reviews a batch of human-approved images via Claude Vision.
// Stores ai_approved + ai_rejection_reason on each image.
// Returns: { results: { id, approved, reason }[] }
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await props.params;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  const { imageIds } = (await request.json()) as { imageIds: string[] };

  if (!Array.isArray(imageIds) || imageIds.length === 0) {
    return NextResponse.json({ error: 'imageIds array is required' }, { status: 400 });
  }

  // Fetch image records for this batch
  const { data: images, error: fetchErr } = await (supabase as any)
    .from('nsw_lora_images')
    .select('id, anime_image_url, status')
    .in('id', imageIds)
    .eq('session_id', sessionId);

  if (fetchErr || !images) {
    return NextResponse.json({ error: fetchErr?.message ?? 'Fetch failed' }, { status: 500 });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const results: { id: string; approved: boolean; reason: string }[] = [];

  await Promise.allSettled(
    (images as Record<string, any>[]).map(async (img) => {
      if (!img.anime_image_url) {
        results.push({ id: img.id, approved: false, reason: 'No image available' });
        return;
      }

      // Create a signed URL for Claude to access
      const { data: signed } = await (supabase as any).storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(img.anime_image_url, 300); // 5-minute expiry for Claude

      if (!signed?.signedUrl) {
        results.push({ id: img.id, approved: false, reason: 'Could not generate signed URL' });
        return;
      }

      try {
        const message = await anthropicCreateWithRetry(
          client,
          {
            model: 'claude-opus-4-6',
            max_tokens: 200,
            system: AI_REVIEW_SYSTEM_PROMPT,
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image',
                    source: { type: 'url', url: signed.signedUrl },
                  },
                  {
                    type: 'text',
                    text: 'Assess this image for the LoRA training dataset.',
                  },
                ],
              },
            ],
          },
          { label: `ai-review-anime ${img.id}` },
        );

        const rawText =
          message.content[0]?.type === 'text' ? message.content[0].text.trim() : '';

        // Parse JSON — strip markdown code fences if present
        const jsonText = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        const parsed = JSON.parse(jsonText) as { approved: boolean; reason: string };

        const approved = Boolean(parsed.approved);
        const reason = String(parsed.reason ?? '');

        // Store result in DB
        await (supabase as any)
          .from('nsw_lora_images')
          .update({
            ai_approved: approved,
            ai_rejection_reason: approved ? null : reason,
          })
          .eq('id', img.id);

        results.push({ id: img.id, approved, reason });
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Claude review failed';
        await (supabase as any)
          .from('nsw_lora_images')
          .update({ ai_approved: false, ai_rejection_reason: reason })
          .eq('id', img.id);
        results.push({ id: img.id, approved: false, reason });
      }
    }),
  );

  return NextResponse.json({ results });
}
