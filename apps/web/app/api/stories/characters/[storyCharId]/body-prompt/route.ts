import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// PATCH /api/stories/characters/[storyCharId]/body-prompt
// Save and optionally approve the body prompt text for V3 pipeline.
// Body: { body_prompt: string, approve?: boolean }
export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> },
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    const { body_prompt, approve } = await request.json();

    if (typeof body_prompt !== "string" || !body_prompt.trim()) {
      return NextResponse.json(
        { error: "body_prompt is required and must be non-empty" },
        { status: 400 },
      );
    }

    const update: Record<string, string> = {
      body_prompt: body_prompt.trim(),
    };

    if (approve) {
      update.body_prompt_status = "approved";
    }

    const { error } = await (supabase as any)
      .from("story_characters")
      .update(update)
      .eq("id", storyCharId);

    if (error) {
      throw new Error(`Failed to update body prompt: ${error.message}`);
    }

    return NextResponse.json({
      success: true,
      body_prompt: update.body_prompt,
      body_prompt_status: update.body_prompt_status || "pending",
    });
  } catch (err) {
    console.error("[BodyPrompt] Update failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 500 },
    );
  }
}
