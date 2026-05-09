import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// PATCH /api/stories/characters/[storyCharId]/patch-prompt
// Directly updates portrait_prompt_locked on the base character row.
// Used by the CharacterCard "Edit prompt" UI after portrait approval.
export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const { storyCharId } = await props.params;

  let portrait_prompt_locked: string;
  try {
    const body = await request.json();
    portrait_prompt_locked = body?.portrait_prompt_locked;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof portrait_prompt_locked !== "string" || portrait_prompt_locked.trim().length === 0) {
    return NextResponse.json(
      { error: "portrait_prompt_locked must be a non-empty string" },
      { status: 400 }
    );
  }

  if (portrait_prompt_locked.length > 2000) {
    return NextResponse.json(
      { error: "portrait_prompt_locked must be 2000 characters or fewer" },
      { status: 400 }
    );
  }

  const trimmed = portrait_prompt_locked.trim();

  // Resolve storyCharId → base character_id
  const { data: storyChar, error: scError } = await supabase
    .from("story_characters")
    .select("character_id")
    .eq("id", storyCharId)
    .single();

  if (scError || !storyChar) {
    return NextResponse.json({ error: "Story character not found" }, { status: 404 });
  }

  const { error: updateError } = await supabase
    .from("characters")
    .update({ portrait_prompt_locked: trimmed })
    .eq("id", storyChar.character_id);

  if (updateError) {
    return NextResponse.json(
      { error: `Failed to update prompt: ${updateError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ portrait_prompt_locked: trimmed });
}
