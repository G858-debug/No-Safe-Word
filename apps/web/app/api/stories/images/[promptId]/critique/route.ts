import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { critiqueGeneratedImage } from "@no-safe-word/image-gen";

/**
 * POST /api/stories/images/[promptId]/critique
 *
 * Evaluates the most recently generated image for this prompt using
 * Pixtral 12B (Mistral vision). Returns a concise factual critique
 * identifying mismatches and suggesting specific prompt fixes.
 *
 * Reads the stored image URL from `images.stored_url` via the
 * prompt's current `image_id` and the prompt text from `images.prompt`
 * (the exact assembled prompt that was sent to Replicate, not the raw
 * scene description from `story_image_prompts.prompt`).
 *
 * Persists the critique to `images.critique` for reference.
 *
 * Returns: { critique: string }
 */
export async function POST(
  _request: NextRequest,
  props: { params: Promise<{ promptId: string }> }
) {
  const { promptId } = await props.params;

  // Fetch the prompt row to get the current image_id
  const { data: promptRow, error: promptErr } = await supabase
    .from("story_image_prompts")
    .select("id, image_id, prompt")
    .eq("id", promptId)
    .single();

  if (promptErr || !promptRow) {
    return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
  }

  if (!promptRow.image_id) {
    return NextResponse.json(
      { error: "No generated image for this prompt yet" },
      { status: 404 }
    );
  }

  // Fetch the image row for the URL and the assembled prompt
  const { data: imageRow, error: imageErr } = await supabase
    .from("images")
    .select("id, stored_url, prompt")
    .eq("id", promptRow.image_id)
    .single();

  if (imageErr || !imageRow) {
    return NextResponse.json({ error: "Image record not found" }, { status: 404 });
  }

  const imageUrl = imageRow.stored_url;
  if (!imageUrl) {
    return NextResponse.json(
      { error: "Image URL not available yet — try again in a moment" },
      { status: 404 }
    );
  }

  // Use the assembled prompt from the images row (what was actually sent
  // to Replicate) rather than the raw scene description. Falls back to
  // the scene description if the images row has no prompt.
  const promptForCritic = imageRow.prompt || promptRow.prompt;

  try {
    const { critique } = await critiqueGeneratedImage(imageUrl, promptForCritic);

    // Persist critique to the images row
    await supabase
      .from("images")
      .update({ critique })
      .eq("id", imageRow.id);

    return NextResponse.json({ critique });
  } catch (err) {
    console.error("[critique] Pixtral critique failed:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Critique failed — check MISTRAL_API_KEY",
      },
      { status: 500 }
    );
  }
}
