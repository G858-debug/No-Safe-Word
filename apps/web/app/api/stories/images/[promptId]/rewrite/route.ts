import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import {
  rewritePromptForHunyuan,
  type ImageTypeHint,
} from "@no-safe-word/image-gen";

/**
 * POST /api/stories/images/[promptId]/rewrite
 *
 * Rewrites the scene prompt in the request body using Mistral Small,
 * applying the HunyuanImage 3.0 known-working composition patterns.
 *
 * Body: { prompt: string }
 *
 * Reads character data (names only — identity is injected by the
 * assembler) from the base `characters` table.
 *
 * Returns: { rewrittenPrompt: string }
 */
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ promptId: string }> }
) {
  const { promptId } = await props.params;

  let prompt: string;
  try {
    const body = await request.json();
    if (typeof body?.prompt !== "string" || !body.prompt.trim()) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }
    prompt = body.prompt.trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Load the prompt row to get image_type and linked character IDs
  const { data: promptRow, error: promptErr } = await supabase
    .from("story_image_prompts")
    .select(
      "id, image_type, character_id, secondary_character_id, character_name, secondary_character_name"
    )
    .eq("id", promptId)
    .single();

  if (promptErr || !promptRow) {
    return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
  }

  // Resolve character names from the base characters table
  const charIds = [
    promptRow.character_id,
    promptRow.secondary_character_id,
  ].filter((id): id is string => Boolean(id));

  const nameById: Record<string, string> = {};
  if (charIds.length > 0) {
    const { data: chars } = await supabase
      .from("characters")
      .select("id, name")
      .in("id", charIds);
    for (const c of chars ?? []) {
      if (c.id && c.name) nameById[c.id] = c.name;
    }
  }

  const primaryName = promptRow.character_id
    ? (nameById[promptRow.character_id] ?? promptRow.character_name ?? undefined)
    : undefined;
  const secondaryName = promptRow.secondary_character_id
    ? (nameById[promptRow.secondary_character_id] ?? promptRow.secondary_character_name ?? undefined)
    : undefined;

  // Map image_type to the rewriter's hint
  const imageType: ImageTypeHint =
    promptRow.image_type === "facebook_sfw" ? "sfw" : "explicit";

  try {
    const { rewrittenPrompt } = await rewritePromptForHunyuan(
      prompt,
      {
        primaryCharacter: primaryName ? { name: primaryName } : undefined,
        secondaryCharacter: secondaryName ? { name: secondaryName } : undefined,
      },
      imageType
    );

    return NextResponse.json({ rewrittenPrompt });
  } catch (err) {
    console.error("[rewrite] Mistral rewrite failed:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Rewriter failed — check MISTRAL_API_KEY",
      },
      { status: 500 }
    );
  }
}
