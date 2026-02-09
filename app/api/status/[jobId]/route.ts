import { NextRequest, NextResponse } from "next/server";
import { getJobStatus, CivitaiError } from "@/lib/civitai";
import { supabase } from "@/lib/supabase";

export async function GET(
  _request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const { jobId } = params;

    if (!jobId) {
      return NextResponse.json(
        { error: "Missing jobId parameter" },
        { status: 400 }
      );
    }

    const job = await getJobStatus(jobId);

    const completed = job.result?.[0]?.available ?? false;
    const imageUrl = job.result?.[0]?.blobUrl ?? null;

    // Update Supabase job status (best-effort)
    let finalImageUrl = imageUrl;
    if (completed) {
      try {
        await supabase
          .from("generation_jobs")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
          })
          .eq("job_id", jobId);

        // Store the image URL on the parent image row
        if (imageUrl) {
          const { data: jobRow } = await supabase
            .from("generation_jobs")
            .select("image_id")
            .eq("job_id", jobId)
            .single();

          if (jobRow?.image_id) {
            await supabase
              .from("images")
              .update({ sfw_url: imageUrl })
              .eq("id", jobRow.image_id);

            // Check if this image already has a stored_url (permanent URL)
            const { data: imageRow } = await supabase
              .from("images")
              .select("stored_url")
              .eq("id", jobRow.image_id)
              .single();

            // Prefer stored_url over temporary blob URL
            if (imageRow?.stored_url) {
              finalImageUrl = imageRow.stored_url;
            }
          }
        }
      } catch {
        console.warn("Failed to update job status in Supabase");
      }
    }

    return NextResponse.json({
      jobId: job.jobId,
      cost: job.cost,
      scheduled: job.scheduled,
      completed,
      imageUrl: finalImageUrl,
      imageUrlExpiration: job.result?.[0]?.blobUrlExpirationDate ?? null,
    });
  } catch (err) {
    if (err instanceof CivitaiError) {
      return NextResponse.json(
        { error: err.message, details: err.details },
        { status: err.status }
      );
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
