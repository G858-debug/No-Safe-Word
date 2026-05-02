import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import {
  buildCharacterPortraitPrompt,
  type PortraitCharacterDescription,
} from "@no-safe-word/image-gen";

// GET /api/stories/characters/[storyCharId]/default-prompt?stage=face|body
//
// Returns the auto-built prompt for the requested stage. Stage defaults to
// "face" so existing callers are unaffected; "body" is used by the body
// textarea introduced for editable per-stage prompts.
export async function GET(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const { storyCharId } = await props.params;
  const url = new URL(request.url);
  const stage: "face" | "body" =
    url.searchParams.get("stage") === "body" ? "body" : "face";

  const { data: storyChar } = await supabase
    .from("story_characters")
    .select("character_id")
    .eq("id", storyCharId)
    .single();

  if (!storyChar) {
    return NextResponse.json({ error: "Story character not found" }, { status: 404 });
  }

  const { data: character } = await supabase
    .from("characters")
    .select("description")
    .eq("id", storyChar.character_id)
    .single();

  if (!character) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  const prompt = buildCharacterPortraitPrompt(
    character.description as PortraitCharacterDescription,
    stage
  );

  return NextResponse.json({ prompt, stage });
}
