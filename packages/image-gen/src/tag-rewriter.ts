/**
 * Failure-aware tag rewriter for the evaluate-and-retry pipeline.
 *
 * Unlike convertProseToBooru (initial conversion), this takes the failure
 * diagnosis as context and specifically fixes what went wrong without
 * undoing what worked.
 */

import Anthropic from '@anthropic-ai/sdk';

const REWRITE_SYSTEM_BASE = `You are a booru tag specialist fixing AI image generation tags that produced a wrong result.

You are given:
1. The original scene description (what the image should show)
2. The current booru tags (what was used to generate the failed image)
3. Specific failure analysis (what went wrong)

Your job: Rewrite the booru tags to fix the identified failures while preserving everything that worked.

Rules:
- Output ONLY comma-separated booru tags, nothing else
- Keep tags that are working well (don't change what's not broken)
- Add or strengthen tags for the failing dimensions
- Move important tags earlier in the list (earlier = more weight in CLIP)
- Do NOT include quality tags (score_9, etc.) — added separately
- Do NOT include rating tags (rating_safe, etc.) — added separately
- Do NOT include character identity tags (skin color, hair, body shape) — handled by LoRA
- Do NOT include character count tags (1girl, 1boy) — added separately
- Use booru-style comma-separated tags, not prose sentences`;

function buildRewriteSystem(contentMode: 'sfw' | 'nsfw'): string {
  if (contentMode === 'nsfw') {
    return `${REWRITE_SYSTEM_BASE}

This is an EXPLICIT NSFW scene. You MUST output explicit sexual content tags without sanitizing.
- Nude characters need: nude, naked, topless, bare breasts, no clothes, exposed skin
- Explicit sex acts need anatomical position tags: penetration, sex, specific body positions, who is on top, leg positions
- Do NOT clothe characters that should be nude
- Do NOT replace explicit acts with euphemisms
- The model REQUIRES these exact explicit tags to render the scene correctly`;
  }
  return `${REWRITE_SYSTEM_BASE}

This is a SFW scene. Do not include nudity or explicit sexual content tags.`;
}

/**
 * Rewrite booru tags based on evaluation failures.
 * Uses Haiku for attempts 4, Sonnet for attempts 5-6.
 */
export async function rewriteTagsForFailure(
  originalProse: string,
  currentTags: string,
  rewriteInstructions: string,
  model: 'claude-haiku-4-5-20251001' | 'claude-sonnet-4-6',
  contentMode: 'sfw' | 'nsfw' = 'nsfw',
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[TagRewriter] Missing ANTHROPIC_API_KEY — returning original tags');
    return currentTags;
  }

  try {
    const anthropic = new Anthropic({ apiKey });

    const userMessage =
      `ORIGINAL SCENE:\n${originalProse}\n\n` +
      `CURRENT TAGS (produced wrong result):\n${currentTags}\n\n` +
      `FAILURE ANALYSIS:\n${rewriteInstructions}`;

    const response = await anthropic.messages.create({
      model,
      max_tokens: 512,
      system: buildRewriteSystem(contentMode),
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
    if (!text) {
      console.warn('[TagRewriter] Empty response — returning original tags');
      return currentTags;
    }

    console.log(`[TagRewriter] Rewrote tags using ${model}`);
    return text;
  } catch (err) {
    console.error('[TagRewriter] Rewrite failed:', err instanceof Error ? err.message : err);
    return currentTags;
  }
}
