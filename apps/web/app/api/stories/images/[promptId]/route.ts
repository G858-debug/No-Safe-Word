import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// GET /api/stories/images/[promptId] — Fetch full image prompt data
export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ promptId: string }> }
) {
  const params = await props.params;
  const { promptId } = params;

  try {
    const { data: imgPrompt, error } = await supabase
      .from("story_image_prompts")
      .select("*")
      .eq("id", promptId)
      .single();

    if (error || !imgPrompt) {
      return NextResponse.json(
        { error: "Image prompt not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(imgPrompt);
  } catch (err) {
    console.error("Failed to fetch image prompt:", err);
    return NextResponse.json(
      {
        error: "Fetch failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// PATCH /api/stories/images/[promptId] — Update the prompt text for a story image prompt
export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ promptId: string }> }
) {
  const params = await props.params;
  const { promptId } = params;

  try {
    const body = await request.json();
    const { prompt } = body as { prompt: string };

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "prompt is required and must be a string" },
        { status: 400 }
      );
    }

    // Fetch current row to check existing status
    const { data: existing, error: fetchError } = await supabase
      .from("story_image_prompts")
      .select("id, status")
      .eq("id", promptId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: "Image prompt not found" },
        { status: 404 }
      );
    }

    // If already generated/approved, reset to pending so it can be regenerated
    const resetStatus =
      existing.status === "generated" || existing.status === "approved";

    const updates: Record<string, unknown> = { prompt };
    if (resetStatus) {
      updates.status = "pending";
    }

    const { data: updated, error: updateError } = await supabase
      .from("story_image_prompts")
      .update(updates)
      .eq("id", promptId)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ image_prompt: updated });
  } catch (err) {
    console.error("Failed to update image prompt:", err);
    return NextResponse.json(
      {
        error: "Update failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
