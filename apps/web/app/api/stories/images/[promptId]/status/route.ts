import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { checkFaceSwapStatus } from "@no-safe-word/image-gen";

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
      .select("id, sfw_url, nsfw_url, stored_url, settings")
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

    // 4. Handle V4 face swap polling — check Replicate prediction status
    if (
      job?.job_id?.startsWith("replicate-faceswap-") &&
      job.status === "pending" &&
      imgPrompt.status === "generating"
    ) {
      const predictionId = job.job_id.replace("replicate-faceswap-", "");
      console.log(`[V4 Status][${promptId}] Polling face swap prediction: ${predictionId}`);

      const swapStatus = await checkFaceSwapStatus(predictionId);

      if (swapStatus.status === "succeeded" && swapStatus.imageBuffer) {
        // Face swap complete — store the final image, replacing the scene image
        const timestamp = Date.now();
        const storagePath = `stories/${imgPrompt.image_id}-${timestamp}_faceswap.png`;

        const { error: uploadError } = await supabase.storage
          .from("story-images")
          .upload(storagePath, swapStatus.imageBuffer, {
            contentType: "image/png",
            upsert: true,
          });

        if (uploadError) {
          console.error(`[V4 Status][${promptId}] Face swap image upload failed:`, uploadError.message);
          return NextResponse.json({
            promptId,
            status: "generating",
            jobId: job.job_id,
            blobUrl: null,
            storedUrl: null,
            error: `Face swap upload failed: ${uploadError.message}`,
          });
        }

        const { data: { publicUrl } } = supabase.storage
          .from("story-images")
          .getPublicUrl(storagePath);

        // Update the image record with the face-swapped version
        await supabase
          .from("images")
          .update({ stored_url: publicUrl, sfw_url: publicUrl })
          .eq("id", imgPrompt.image_id);

        // Mark job as completed
        await supabase
          .from("generation_jobs")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("job_id", job.job_id);

        // Mark prompt as generated
        await supabase
          .from("story_image_prompts")
          .update({ status: "generated" })
          .eq("id", promptId);

        console.log(`[V4 Status][${promptId}] Face swap complete, stored at ${publicUrl}`);

        return NextResponse.json({
          promptId,
          status: "generated",
          jobId: job.job_id,
          blobUrl: publicUrl,
          storedUrl: publicUrl,
        });
      }

      if (swapStatus.status === "failed" || swapStatus.status === "canceled") {
        // Face swap failed — mark as failed but keep the scene image
        console.error(`[V4 Status][${promptId}] Face swap ${swapStatus.status}: ${swapStatus.error}`);

        await supabase
          .from("generation_jobs")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("job_id", job.job_id);

        // Fall back to scene image (no face swap) — still usable
        await supabase
          .from("story_image_prompts")
          .update({ status: "generated" })
          .eq("id", promptId);

        const fallbackUrl = image?.stored_url || image?.sfw_url;

        return NextResponse.json({
          promptId,
          status: "generated",
          jobId: job.job_id,
          blobUrl: fallbackUrl,
          storedUrl: fallbackUrl,
          warning: `Face swap ${swapStatus.status}: ${swapStatus.error}. Using scene image without face swap.`,
        });
      }

      // Still processing — tell client to keep polling
      console.log(`[V4 Status][${promptId}] Face swap still ${swapStatus.status}...`);
      return NextResponse.json({
        promptId,
        status: "generating",
        jobId: job.job_id,
        blobUrl: null,
        storedUrl: null,
      });
    }

    // 5. Standard status check (V1/V2/V3 and completed V4)
    const blobUrl = image?.sfw_url || image?.nsfw_url || null;
    const storedUrl = image?.stored_url || null;

    // Sync prompt status with job status if job completed but prompt still shows generating
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
        } else {
          const errText = await storeRes.text().catch(() => "unknown");
          console.error(
            `[PromptStatus][${promptId}] Auto-store FAILED (${storeRes.status}): ${errText}`,
          );
          return NextResponse.json({
            promptId,
            status: "generating",
            jobId: job.job_id,
            blobUrl,
            storedUrl: null,
            error: `Image storage failed (${storeRes.status})`,
          });
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
