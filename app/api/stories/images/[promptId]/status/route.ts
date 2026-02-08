import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/stories/images/[promptId]/status — Check generation status of an image prompt
export async function GET(
  _request: NextRequest,
  { params }: { params: { promptId: string } }
) {
  const { promptId } = params;

  try {
    // 1. Fetch the image prompt
    const { data: imgPrompt, error: fetchError } = await supabase
      .from("story_image_prompts")
      .select("id, image_id, status")
      .eq("id", promptId)
      .single();

    if (fetchError || !imgPrompt) {
      return NextResponse.json(
        { error: "Image prompt not found" },
        { status: 404 }
      );
    }

    // If no image linked yet, return current status
    if (!imgPrompt.image_id) {
      return NextResponse.json({
        promptId,
        status: imgPrompt.status,
        jobId: null,
        blobUrl: null,
        storedUrl: null,
      });
    }

    // 2. Fetch the image record
    const { data: image } = await supabase
      .from("images")
      .select("id, sfw_url, nsfw_url, stored_url")
      .eq("id", imgPrompt.image_id)
      .single();

    // 3. Fetch the latest generation job for this image
    const { data: job } = await supabase
      .from("generation_jobs")
      .select("job_id, status, completed_at")
      .eq("image_id", imgPrompt.image_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // 4. Determine blob URL from the image record
    const blobUrl = image?.sfw_url || image?.nsfw_url || null;
    const storedUrl = image?.stored_url || null;

    // 5. Sync prompt status with job status if job completed but prompt still shows generating
    if (
      job?.status === "completed" &&
      blobUrl &&
      imgPrompt.status === "generating"
    ) {
      await supabase
        .from("story_image_prompts")
        .update({ status: "generated" })
        .eq("id", promptId);

      return NextResponse.json({
        promptId,
        status: "generated",
        jobId: job.job_id,
        blobUrl,
        storedUrl,
      });
    }

    return NextResponse.json({
      promptId,
      status: imgPrompt.status,
      jobId: job?.job_id || null,
      blobUrl,
      storedUrl,
    });
  } catch (err) {
    console.error("Failed to fetch image prompt status:", err);
    return NextResponse.json(
      {
        error: "Status check failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
