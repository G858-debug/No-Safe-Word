import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// GET /api/stories/characters/[storyCharId]/dataset-images/[imageId]/regenerate-status
// Poll for the result of a fire-and-forget dataset image regeneration.
// [imageId] here is the placeholder ID returned by the POST regenerate endpoint.
export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ storyCharId: string; imageId: string }> }
) {
  const params = await props.params;
  const { imageId: placeholderId } = params;

  try {
    // Check if the placeholder still exists
    const { data: placeholder, error } = await supabase
      .from("lora_dataset_images")
      .select("id, eval_status, eval_details")
      .eq("id", placeholderId)
      .single();

    if (error || !placeholder) {
      // Placeholder was deleted = generation succeeded.
      // Find the newest non-replaced image for this LoRA (the one just created).
      // We use created_at desc to get the most recent.
      // The caller already knows the lora_id context, but we need the actual new image.
      // Since the placeholder is gone, the new image is the latest one created after it.
      return NextResponse.json({
        status: "completed",
      });
    }

    if (placeholder.eval_status === "generating") {
      return NextResponse.json({
        status: "generating",
      });
    }

    if (placeholder.eval_status === "failed") {
      // Clean up the failed placeholder
      await supabase
        .from("lora_dataset_images")
        .delete()
        .eq("id", placeholderId);

      return NextResponse.json({
        status: "failed",
        error: placeholder.eval_details || "Generation failed",
      });
    }

    // Unexpected status — treat as still generating
    return NextResponse.json({
      status: "generating",
    });
  } catch (err) {
    console.error("[Regenerate Status] Failed:", err);
    return NextResponse.json(
      { error: "Status check failed" },
      { status: 500 }
    );
  }
}
