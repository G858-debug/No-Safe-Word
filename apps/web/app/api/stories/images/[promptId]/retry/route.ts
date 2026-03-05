import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { submitRunPodJob, imageUrlToBase64, buildKontextWorkflow } from "@no-safe-word/image-gen";
import { concatImagesHorizontally } from "@/lib/server/image-concat";
import type { KontextWorkflowType } from "@no-safe-word/image-gen";

// POST /api/stories/images/[promptId]/retry — Internal retry for failed person validation
// Called by the status route when dual-character validation detects wrong person count.
// Rebuilds the workflow with a new seed and resubmits to RunPod.
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ promptId: string }> }
) {
  const params = await props.params;
  const { promptId } = params;

  try {
    const body = await request.json();
    const { newSeed, jobId: oldJobId } = body as { newSeed: number; jobId: string };

    if (!newSeed || !oldJobId) {
      return NextResponse.json(
        { error: "Missing newSeed or jobId" },
        { status: 400 }
      );
    }

    // 1. Fetch the image prompt
    const { data: imgPrompt, error: fetchError } = await supabase
      .from("story_image_prompts")
      .select("id, post_id, image_type, position, character_name, character_id, secondary_character_name, secondary_character_id, prompt, image_id")
      .eq("id", promptId)
      .single();

    if (fetchError || !imgPrompt) {
      return NextResponse.json(
        { error: "Image prompt not found" },
        { status: 404 }
      );
    }

    // 2. Fetch series info via post
    const { data: post } = await supabase
      .from("story_posts")
      .select("series_id")
      .eq("id", imgPrompt.post_id)
      .single();

    const hasSecondary = !!imgPrompt.secondary_character_id;

    // 3. Build Kontext workflow
    const kontextType: KontextWorkflowType = !imgPrompt.character_id
      ? "portrait"
      : hasSecondary
        ? "dual"
        : "single";

    const sfwMode = imgPrompt.image_type !== "website_nsfw_paired";
    let kontextImages: Array<{ name: string; image: string }> = [];

    if (kontextType !== "portrait" && imgPrompt.character_id && post) {
      const { data: sc } = await supabase
        .from("story_characters")
        .select("approved_image_id")
        .eq("series_id", post.series_id)
        .eq("character_id", imgPrompt.character_id)
        .single();

      if (sc?.approved_image_id) {
        const { data: img } = await supabase
          .from("images")
          .select("stored_url, sfw_url")
          .eq("id", sc.approved_image_id)
          .single();

        const primaryRefUrl = img?.stored_url || img?.sfw_url;
        if (primaryRefUrl) {
          try {
            kontextImages.push({ name: "primary_ref.png", image: await imageUrlToBase64(primaryRefUrl) });
          } catch (err) {
            console.warn(`[Kontext][${promptId}] Failed to fetch primary ref image, proceeding without it:`, err instanceof Error ? err.message : err);
          }
        }
      }
    }

    if (kontextType === "dual" && imgPrompt.secondary_character_id && post) {
      const { data: sc2 } = await supabase
        .from("story_characters")
        .select("approved_image_id")
        .eq("series_id", post.series_id)
        .eq("character_id", imgPrompt.secondary_character_id)
        .single();

      if (sc2?.approved_image_id) {
        const { data: img2 } = await supabase
          .from("images")
          .select("stored_url, sfw_url")
          .eq("id", sc2.approved_image_id)
          .single();

        const secondaryRefUrl = img2?.stored_url || img2?.sfw_url;
        if (secondaryRefUrl) {
          try {
            kontextImages.push({ name: "secondary_ref.png", image: await imageUrlToBase64(secondaryRefUrl) });
          } catch (err) {
            console.warn(`[Kontext][${promptId}] Failed to fetch secondary ref image, proceeding without it:`, err instanceof Error ? err.message : err);
          }
        }
      }
    }

    // For dual scenes: combine both ref images into one server-side
    if (kontextType === "dual" && kontextImages.length === 2) {
      try {
        const combined = await concatImagesHorizontally(kontextImages[0].image, kontextImages[1].image);
        kontextImages = [{ name: "combined_ref.png", image: combined }];
        console.log(`[Kontext][${promptId}] Combined primary + secondary ref images server-side`);
      } catch (err) {
        console.warn(`[Kontext][${promptId}] Failed to combine ref images, using primary only:`, err instanceof Error ? err.message : err);
        kontextImages = [kontextImages[0]];
      }
    }

    const isLandscape = /\b(wide|establishing|panoram)/i.test(imgPrompt.prompt);
    const kontextWidth = isLandscape ? 1216 : 832;
    const kontextHeight = isLandscape ? 832 : 1216;

    const refImageName = kontextType === "dual"
      ? (kontextImages[0]?.name || "combined_ref.png")
      : kontextType !== "portrait" ? "primary_ref.png" : undefined;

    const kontextWorkflow = buildKontextWorkflow({
      type: kontextType,
      positivePrompt: imgPrompt.prompt,
      width: kontextWidth,
      height: kontextHeight,
      seed: newSeed,
      filenamePrefix: `kontext_${imgPrompt.id.substring(0, 8)}`,
      sfwMode,
      primaryRefImageName: refImageName,
    });

    const { jobId: runpodJobId } = await submitRunPodJob(
      kontextWorkflow,
      kontextImages.length > 0 ? kontextImages : undefined,
    );

    const newJobId = `runpod-${runpodJobId}`;

    await supabase
      .from("generation_jobs")
      .update({ job_id: newJobId, status: "pending", completed_at: null })
      .eq("job_id", oldJobId);

    console.log(`[Retry/Kontext][${promptId}] Resubmitted with seed ${newSeed}, new job: ${newJobId}`);

    return NextResponse.json({ jobId: newJobId, seed: newSeed });
  } catch (err) {
    console.error("[Retry] Failed:", err);
    return NextResponse.json(
      {
        error: "Retry failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
