import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { submitRunPodJob, imageUrlToBase64, buildKontextWorkflow } from "@no-safe-word/image-gen";
import { concatImagesHorizontally } from "@/lib/server/image-concat";
import type { KontextWorkflowType } from "@no-safe-word/image-gen";

// POST /api/stories/images/[promptId]/regenerate — Regenerate a single story image
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ promptId: string }> }
) {
  const params = await props.params;
  const { promptId } = params;

  try {
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

    // 2. Clean up old image from storage if it exists
    try {
      if (imgPrompt.image_id) {
        const { data: oldImage } = await supabase
          .from("images")
          .select("stored_url")
          .eq("id", imgPrompt.image_id)
          .single();

        if (oldImage?.stored_url) {
          const urlParts = oldImage.stored_url.split("/story-images/");
          if (urlParts.length === 2) {
            const storagePath = urlParts[1];
            await supabase.storage.from("story-images").remove([storagePath]);
            console.log(`Deleted old story image from storage: ${storagePath}`);
          }
        }
      }
    } catch (err) {
      console.warn("Failed to clean up old story image:", err);
    }

    // 3. Mark as generating
    await supabase
      .from("story_image_prompts")
      .update({ status: "generating" })
      .eq("id", promptId);

    // 4. Fetch series info via post
    const { data: post } = await supabase
      .from("story_posts")
      .select("series_id")
      .eq("id", imgPrompt.post_id)
      .single();

    // 5. Determine mode
    const isNsfw = imgPrompt.image_type === "website_nsfw_paired";
    const mode: "sfw" | "nsfw" = isNsfw ? "nsfw" : "sfw";

    // 6. Generate via RunPod (Kontext)
    const seed = Math.floor(Math.random() * 2_147_483_647) + 1;
    const hasSecondary = !!imgPrompt.secondary_character_id;

    const kontextType: KontextWorkflowType = !imgPrompt.character_id
      ? "portrait"
      : hasSecondary
        ? "dual"
        : "single";

    const sfwMode = imgPrompt.image_type !== "website_nsfw_paired";

    // Fetch reference images
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
        kontextImages = [kontextImages[0]]; // fall back to primary only
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
      seed,
      filenamePrefix: `kontext_${imgPrompt.id.substring(0, 8)}`,
      sfwMode,
      primaryRefImageName: refImageName,
    });

    console.log(`[Kontext][${promptId}] Regenerate: type=${kontextType}, sfw=${sfwMode}, dims=${kontextWidth}x${kontextHeight}, refs=${kontextImages.length}`);

    const { jobId: kontextJobId } = await submitRunPodJob(
      kontextWorkflow,
      kontextImages.length > 0 ? kontextImages : undefined,
    );

    const { data: imageRow, error: imgError } = await supabase
      .from("images")
      .insert({
        character_id: imgPrompt.character_id || null,
        prompt: imgPrompt.prompt,
        negative_prompt: "none",
        settings: {
          width: kontextWidth,
          height: kontextHeight,
          steps: 20,
          cfg: kontextType === "portrait" ? 1.0 : 2.5,
          seed,
          engine: "runpod-kontext",
          workflowType: kontextType,
        },
        mode,
      })
      .select("id")
      .single();

    if (imgError || !imageRow) {
      throw new Error(`Failed to create image record: ${imgError?.message}`);
    }

    await supabase.from("generation_jobs").insert({
      job_id: `runpod-${kontextJobId}`,
      image_id: imageRow.id,
      status: "pending",
      cost: 0,
    });

    await supabase
      .from("story_image_prompts")
      .update({ image_id: imageRow.id })
      .eq("id", promptId);

    return NextResponse.json({
      jobId: `runpod-${kontextJobId}`,
      imageId: imageRow.id,
    });
  } catch (err) {
    // Mark as failed on error
    await supabase
      .from("story_image_prompts")
      .update({ status: "failed" })
      .eq("id", promptId);

    console.error("Image regeneration failed:", err);
    return NextResponse.json(
      {
        error: "Regeneration failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
