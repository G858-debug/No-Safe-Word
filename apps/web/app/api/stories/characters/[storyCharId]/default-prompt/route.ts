import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import {
  buildCharacterPortraitPrompt,
  type PortraitCharacterDescription,
} from "@no-safe-word/image-gen";

export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const { storyCharId } = await props.params;

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
    character.description as PortraitCharacterDescription
  );

  return NextResponse.json({ prompt });
}
