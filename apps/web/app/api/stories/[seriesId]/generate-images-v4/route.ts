import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { submitFaceSwap } from "@no-safe-word/image-gen";
import {
  generateSceneImageV4,
  fetchCharacterDataMap,
} from "@/lib/server/generate-scene-image-v4";

interface GeneratedImage {
  promptId: string;
  imageId: string;
  storedUrl: string;
  seed: number;
}

interface FailedImage {
  promptId: string;
  error: string;
}

// POST /api/stories/[seriesId]/generate-images-v4 — Batch generate V4 scene images (Flux 2 Pro)
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ seriesId: string }> },
) {
  const params = await props.params;
  const { seriesId } = params;

  try {
    const body = await request.json().catch(() => ({}));
    const { post_id, regenerate } = body as { post_id?: string; regenerate?: boolean };

    // 1. Verify series uses flux2_pro engine
    const { data: series } = await (supabase as any)
      .from("story_series")
      .select("image_engine")
      .eq("id", seriesId)
      .single() as { data: { image_engine: string } | null };

    if (series?.image_engine !== "flux2_pro") {
      return NextResponse.json(
        { error: `Series engine is "${series?.image_engine}", not "flux2_pro". Use the correct batch endpoint.` },
        { status: 400 },
      );
    }

    // 2. Find target posts
    let postIds: string[];
    if (post_id) {
      const { data: post } = await supabase
        .from("story_posts")
        .select("id")
        .eq("id", post_id)
        .eq("series_id", seriesId)
        .single();

      if (!post) {
        return NextResponse.json({ error: "Post not found in this series" }, { status: 404 });
      }
      postIds = [post_id];
    } else {
      const { data: posts } = await supabase
        .from("story_posts")
        .select("id")
        .eq("series_id", seriesId);
      postIds = (posts || []).map((p) => p.id);
    }

    if (postIds.length === 0) {
      return NextResponse.json({ pipeline: "v4-flux2-pro", generated: 0, failed: 0, results: [] });
    }

    // 3. Reset generated prompts if regenerate flag
    if (regenerate) {
      await supabase
        .from("story_image_prompts")
        .update({ status: "pending", image_id: null })
        .in("post_id", postIds)
        .eq("status", "generated");
    }

    // 4. Fetch pending/stuck image prompts
    const { data: prompts, error: promptsError } = await supabase
      .from("story_image_prompts")
      .select("id, post_id, image_type, position, character_name, character_id, secondary_character_name, secondary_character_id, prompt")
      .in("post_id", postIds)
      .in("status", ["pending", "generating", "failed"]);

    if (promptsError) {
      return NextResponse.json({ error: promptsError.message }, { status: 500 });
    }

    if (!prompts || prompts.length === 0) {
      return NextResponse.json({ pipeline: "v4-flux2-pro", generated: 0, failed: 0, results: [] });
    }

    // 5. Generate each image sequentially (respect Replicate rate limits)
    const generated: GeneratedImage[] = [];
    const failed: FailedImage[] = [];

    for (let i = 0; i < prompts.length; i++) {
      const imgPrompt = prompts[i];
      try {
        await supabase
          .from("story_image_prompts")
          .update({ status: "generating" })
          .eq("id", imgPrompt.id);

        const seed = Math.floor(Math.random() * 2_147_483_647) + 1;

        // Generate scene (sync ~30s)
        const result = await generateSceneImageV4({
          imgPrompt,
          seriesId,
          seed,
        });

        const hasFaceSwap = !!result.faceSwapConfig;

        // Store the scene image to Supabase (permanent URL needed for face swap)
        const timestamp = Date.now();
        const imageId = crypto.randomUUID();
        const storagePath = `stories/${imageId}-${timestamp}.png`;

        const { error: uploadError } = await supabase.storage
          .from("story-images")
          .upload(storagePath, result.sceneImageBuffer, { contentType: "image/png", upsert: true });

        if (uploadError) {
          throw new Error(`Image storage failed: ${uploadError.message}`);
        }

        const { data: { publicUrl } } = supabase.storage
          .from("story-images")
          .getPublicUrl(storagePath);

        // Submit face swap AFTER upload — uses permanent Supabase URL
        let faceSwapPredictionId: string | null = null;
        if (result.faceSwapConfig) {
          faceSwapPredictionId = await submitFaceSwap({
            targetImageUrl: publicUrl,
            primaryFaceUrl: result.faceSwapConfig.primaryFaceUrl,
            primaryGender: result.faceSwapConfig.primaryGender,
            secondaryFaceUrl: result.faceSwapConfig.secondaryFaceUrl,
            secondaryGender: result.faceSwapConfig.secondaryGender,
            hairSource: "target",
          });
          console.log(`[V4] Face swap submitted for prompt ${imgPrompt.id}: ${faceSwapPredictionId}`);
        }

        // Create image record with scene image
        const { data: imageRow, error: imgError } = await supabase
          .from("images")
          .insert({
            id: imageId,
            character_id: imgPrompt.character_id || null,
            prompt: result.assembledPrompt,
            negative_prompt: "",
            settings: {
              seed: result.seed,
              engine: "replicate-v4-multi-lora-faceswap",
              mode: result.mode,
              hasFaceSwap,
              faceSwapPredictionId,
              pipelineSteps: ["multi-lora-scene", hasFaceSwap ? "easel-face-swap" : "no-face-swap"],
            },
            mode: result.mode,
            stored_url: publicUrl,
            sfw_url: publicUrl,
          })
          .select("id")
          .single();

        if (imgError || !imageRow) {
          throw new Error(`Failed to create image record: ${imgError?.message}`);
        }

        // Create generation job — pending if face swap running, completed otherwise
        const jobId = hasFaceSwap
          ? `replicate-faceswap-${faceSwapPredictionId}`
          : `replicate-v4-${imageId}`;

        await supabase.from("generation_jobs").insert({
          job_id: jobId,
          image_id: imageRow.id,
          status: hasFaceSwap ? "pending" : "completed",
          completed_at: hasFaceSwap ? null : new Date().toISOString(),
          cost: 0,
        });

        // Link image to prompt
        await supabase
          .from("story_image_prompts")
          .update({
            image_id: imageRow.id,
            status: hasFaceSwap ? "generating" : "generated",
          })
          .eq("id", imgPrompt.id);

        generated.push({
          promptId: imgPrompt.id,
          imageId: imageRow.id,
          storedUrl: publicUrl,
          seed: result.seed,
        });

        console.log(`[V4] Image ${i + 1}/${prompts.length}: ${imageRow.id} (${Math.round(result.sceneImageBuffer.length / 1024)}KB scene${hasFaceSwap ? ', face swap pending' : ''})`);

        // Brief pause between generations to respect rate limits
        if (i < prompts.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (err) {
        await supabase
          .from("story_image_prompts")
          .update({ status: "failed" })
          .eq("id", imgPrompt.id);

        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(`[V4] Failed to generate image for prompt ${imgPrompt.id}:`, message);
        failed.push({ promptId: imgPrompt.id, error: message });

        if (i < prompts.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }

    return NextResponse.json({
      pipeline: "v4-flux2-pro",
      generated: generated.length,
      failed: failed.length,
      results: generated,
      errors: failed.length > 0 ? failed : undefined,
    });
  } catch (err) {
    console.error("[V4] Batch image generation failed:", err);
    return NextResponse.json(
      {
        error: "V4 batch generation failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
