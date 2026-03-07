import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '@no-safe-word/story-engine';

const CONVERTED_BUCKET = 'lora-converted-images';

const AI_REVIEW_SYSTEM_PROMPT =
  'You are a quality assessor for a photorealistic LoRA training dataset. You are evaluating images that were converted from anime to photorealistic style. Approve the image if: (1) it looks like a real photograph, not a painting or illustration, (2) it shows a Black woman with dark skin, (3) the body is clearly curvaceous — large breasts, wide hips, thick thighs are visible, (4) anatomy is plausible (no broken limbs, floating body parts, merged fingers are acceptable), (5) the body proportions are curvy, not slim. Reject if: the image still looks illustrated/anime, the woman appears slim or average build, the skin appears white or light-skinned, anatomy is severely broken, or the body is not visible. Respond in JSON only: { "approved": true/false, "reason": "brief reason" }';

// POST /api/lora-studio/[sessionId]/ai-review-converted
// Body: { imageIds: string[] }
// Reviews a batch of human-approved converted images via Claude Vision.
// Stores ai_approved + ai_rejection_reason on each converted image row.
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

  // Fetch converted image records for this batch
  const { data: images, error: fetchErr } = await (supabase as any)
    .from('nsw_lora_images')
    .select('id, converted_image_url, status')
    .in('id', imageIds)
    .eq('session_id', sessionId)
    .eq('stage', 'converted');

  if (fetchErr || !images) {
    return NextResponse.json({ error: fetchErr?.message ?? 'Fetch failed' }, { status: 500 });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const results: { id: string; approved: boolean; reason: string }[] = [];

  await Promise.allSettled(
    (images as Record<string, any>[]).map(async (img) => {
      if (!img.converted_image_url) {
        results.push({ id: img.id, approved: false, reason: 'No converted image available' });
        return;
      }

      const { data: signed } = await (supabase as any).storage
        .from(CONVERTED_BUCKET)
        .createSignedUrl(img.converted_image_url, 300);

      if (!signed?.signedUrl) {
        results.push({ id: img.id, approved: false, reason: 'Could not generate signed URL' });
        return;
      }

      try {
        const message = await client.messages.create({
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
                  text: 'Assess this converted image for the photorealistic LoRA training dataset.',
                },
              ],
            },
          ],
        });

        const rawText =
          message.content[0]?.type === 'text' ? message.content[0].text.trim() : '';
        const jsonText = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        const parsed = JSON.parse(jsonText) as { approved: boolean; reason: string };

        const approved = Boolean(parsed.approved);
        const reason = String(parsed.reason ?? '');

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
