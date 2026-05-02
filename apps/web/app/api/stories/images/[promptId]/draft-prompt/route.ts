import { NextRequest, NextResponse } from "next/server";
import { draftAndPersistScenePrompt } from "@/lib/server/draft-scene-prompt-from-db";

/**
 * POST /api/stories/images/[promptId]/draft-prompt
 *
 * Draft (or re-draft) the final scene prompt with Mistral Large for the
 * given prompt row. Persists the result to story_image_prompts.final_prompt
 * and returns the new text.
 *
 * Hunyuan-only for now. Returns 400 for flux2_dev series.
 */
export async function POST(
  _request: NextRequest,
  props: { params: Promise<{ promptId: string }> }
) {
  const { promptId } = await props.params;

  if (!promptId) {
    return NextResponse.json({ error: "promptId is required" }, { status: 400 });
  }

  try {
    const { finalPrompt, draftedAt } = await draftAndPersistScenePrompt(promptId);
    return NextResponse.json({
      success: true,
      promptId,
      final_prompt: finalPrompt,
      final_prompt_drafted_at: draftedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Drafting failed";
    const status = /not supported|not found|approve/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message, promptId }, { status });
  }
}
