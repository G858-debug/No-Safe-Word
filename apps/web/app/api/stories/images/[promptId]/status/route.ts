import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// GET /api/stories/images/[promptId]/status — Check generation status of an image prompt
export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ promptId: string }> }
) {
  const params = await props.params;
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

      // Auto-store the image if not already stored
      let finalStoredUrl = storedUrl;
      if (!storedUrl && blobUrl) {
        try {
          const filename = `stories/prompt-${promptId}-${Date.now()}.jpeg`;
          const storeRes = await fetch(
            `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/api/images/store`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                blob_url: blobUrl,
                image_id: imgPrompt.image_id,
                filename,
              }),
            }
          );

          if (storeRes.ok) {
            const storeData = await storeRes.json();
            finalStoredUrl = storeData.stored_url;
          }
        } catch (err) {
          console.warn("Failed to auto-store image:", err);
          // Continue without stored URL
        }
      }

      return NextResponse.json({
        promptId,
        status: "generated",
        jobId: job.job_id,
        blobUrl,
        storedUrl: finalStoredUrl,
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
