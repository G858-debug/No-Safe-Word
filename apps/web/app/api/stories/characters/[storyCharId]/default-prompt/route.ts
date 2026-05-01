import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import {
  buildCharacterPortraitPrompt,
  deriveBodyPromptFromFace,
  type PortraitCharacterDescription,
} from "@no-safe-word/image-gen";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const { storyCharId } = await props.params;
  const stage = (request.nextUrl.searchParams.get("stage") ?? "face") as "face" | "body";

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
    .select("description, portrait_prompt_locked")
    .eq("id", storyChar.character_id)
    .single();

  if (!character) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  // Body stage: if the face has been approved, derive the body prompt from
  // the locked face prompt so any descriptive edits the user made for the
  // face carry through. Falls back to the structured-description build when
  // no face has been approved yet (or in the face stage).
  const prompt =
    stage === "body" && character.portrait_prompt_locked
      ? deriveBodyPromptFromFace(character.portrait_prompt_locked)
      : buildCharacterPortraitPrompt(
          character.description as PortraitCharacterDescription,
          stage
        );

  return NextResponse.json({ prompt });
}
