/**
 * Failure-aware prompt rewriter for the evaluate-and-retry pipeline.
 *
 * Takes the failure diagnosis as context and specifically fixes what went wrong
 * in the generation prompt without undoing what worked.
 */

import Anthropic from '@anthropic-ai/sdk';

const REWRITE_SYSTEM_BASE = `You are an image generation prompt specialist fixing prompts that produced a wrong result for Juggernaut XL Ragnarok (a photorealistic SDXL model).

You are given:
1. The original scene description (what the image should show)
2. The current prompt (what was used to generate the failed image)
3. Specific failure analysis (what went wrong)

Your job: Rewrite the prompt to fix the identified failures while preserving everything that worked.

Rules:
- Output ONLY the rewritten prompt, nothing else
- Keep elements that are working well (don't change what's not broken)
- Add or strengthen descriptors for the failing dimensions
- Place the most important elements early (earlier = more weight in CLIP)
- Stay under 75 tokens total
- Do NOT include quality tags (photograph, cinematic, etc.) — added separately
- Do NOT include character identity (skin color, hair, body shape) — handled by LoRA`;

function buildRewriteSystem(contentMode: 'sfw' | 'nsfw'): string {
  if (contentMode === 'nsfw') {
    return `${REWRITE_SYSTEM_BASE}

This is an EXPLICIT NSFW scene. You MUST output explicit content without sanitizing.
- Nude characters need explicit descriptors: nude, naked, topless, bare breasts, no clothes
- Explicit acts need anatomical positioning: specific body positions, who is on top, leg positions
- Do NOT clothe characters that should be nude
- Do NOT replace explicit acts with euphemisms
- The model REQUIRES specific content descriptors to render the scene correctly`;
  }
  return `${REWRITE_SYSTEM_BASE}

This is a SFW scene. Do not include nudity or explicit content.
CRITICAL: Always include specific clothing descriptions — the model defaults toward nudity without them.`;
}

/**
 * Rewrite a prompt based on evaluation failures.
 * Uses Haiku for attempt 4, Sonnet for attempts 5-6.
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
      `CURRENT PROMPT (produced wrong result):\n${currentTags}\n\n` +
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

    console.log(`[TagRewriter] Rewrote prompt using ${model}`);
    return text;
  } catch (err) {
    console.error('[TagRewriter] Rewrite failed:', err instanceof Error ? err.message : err);
    return currentTags;
  }
}
