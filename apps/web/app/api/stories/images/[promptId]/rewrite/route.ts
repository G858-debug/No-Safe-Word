import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import {
  rewritePromptForHunyuan,
  type ImageTypeHint,
} from "@no-safe-word/image-gen";
import { buildSceneCharacterBlockFromLocked } from "@no-safe-word/image-gen/portrait-prompt-builder";

/**
 * Load the Hunyuan test-knowledge file at request time so updates to
 * hunyuan-knowledge.md take effect on the next deploy without any code
 * changes. Falls back silently if the file is missing.
 *
 * Path: packages/image-gen/src/prompts/hunyuan-knowledge.md
 * process.cwd() is apps/web in both local dev and Railway.
 */
function loadKnowledge(): string {
  const knowledgePath = path.join(
    process.cwd(),
    "../../packages/image-gen/src/prompts/hunyuan-knowledge.md"
  );
  try {
    return fs.readFileSync(knowledgePath, "utf-8");
  } catch {
    console.warn("[rewrite] hunyuan-knowledge.md not found at", knowledgePath, "— proceeding without it");
    return "";
  }
}

/**
 * POST /api/stories/images/[promptId]/rewrite
 *
 * Rewrites the scene prompt in the request body using Mistral Small.
 * Mistral receives the complete character context — gender, stripped
 * portrait description block, and (for SFW images) clothing sentence —
 * and produces the COMPLETE final prompt that goes to Replicate.
 *
 * Body: { prompt: string }
 * Returns: { rewrittenPrompt: string }
 *
 * The caller (generateOne in ImageGeneration.tsx) stores the rewritten
 * prompt back to story_image_prompts.prompt and passes suppressAssembly:true
 * to generate-image so the mechanical assembler is bypassed.
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

  const isSfw = promptRow.image_type === "facebook_sfw";
  const imageType: ImageTypeHint = isSfw ? "sfw" : "explicit";

  // Resolve full character context from the base characters table
  const charIds = [
    promptRow.character_id,
    promptRow.secondary_character_id,
  ].filter((id): id is string => Boolean(id));

  interface CharData {
    name: string;
    gender?: string;
    portraitBlock?: string;
    clothing?: string;
  }
  const charDataById: Record<string, CharData> = {};

  if (charIds.length > 0) {
    const { data: chars } = await supabase
      .from("characters")
      .select("id, name, description, portrait_prompt_locked")
      .in("id", charIds);

    for (const c of chars ?? []) {
      if (!c.id || !c.name) continue;
      const desc = (c.description as Record<string, string>) ?? {};

      const portraitBlock = c.portrait_prompt_locked
        ? buildSceneCharacterBlockFromLocked(c.name, c.portrait_prompt_locked)
        : undefined;

      const clothingRaw = desc.clothing;
      const clothing = clothingRaw
        ? `${c.name} is wearing ${clothingRaw}.`
        : undefined;

      charDataById[c.id] = {
        name: c.name,
        gender: desc.gender || undefined,
        portraitBlock,
        clothing,
      };
    }
  }

  // Resolve primary and secondary — fall back to name stored on the prompt row
  const primaryId = promptRow.character_id;
  const secondaryId = promptRow.secondary_character_id;

  const primaryData = primaryId
    ? (charDataById[primaryId] ?? {
        name: promptRow.character_name ?? primaryId,
      })
    : undefined;

  const secondaryData = secondaryId
    ? (charDataById[secondaryId] ?? {
        name: promptRow.secondary_character_name ?? secondaryId,
      })
    : undefined;

  const knowledge = loadKnowledge();

  try {
    const { rewrittenPrompt } = await rewritePromptForHunyuan(
      prompt,
      {
        primaryCharacter: primaryData,
        secondaryCharacter: secondaryData,
        isSfw,
      },
      imageType,
      { knowledge }
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
