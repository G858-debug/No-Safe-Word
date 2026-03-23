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
      .select("id, eval_status, eval_details, image_url")
      .eq("id", placeholderId)
      .single();

    if (error || !placeholder) {
      // Placeholder was deleted = generation succeeded
      return NextResponse.json({ status: "completed" });
    }

    if (placeholder.eval_status === "failed") {
      // Extract error message from eval_details (stored as JSON object)
      const details = placeholder.eval_details as Record<string, unknown> | null;
      const errorMsg = details?.error || "Generation failed";

      // Clean up the failed placeholder
      await supabase
        .from("lora_dataset_images")
        .delete()
        .eq("id", placeholderId);

      return NextResponse.json({
        status: "failed",
        error: errorMsg,
      });
    }

    // Placeholder exists with pending/other status and empty image_url = still generating
    if (!placeholder.image_url) {
      return NextResponse.json({ status: "generating" });
    }

    // Has an image_url but not failed — unexpected, treat as completed
    return NextResponse.json({ status: "completed" });
  } catch (err) {
    console.error("[Regenerate Status] Failed:", err);
    return NextResponse.json(
      { error: "Status check failed" },
      { status: 500 }
    );
  }
}
