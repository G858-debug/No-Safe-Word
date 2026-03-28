import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
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

        // Generate image synchronously via Replicate
        const result = await generateSceneImageV4({
          imgPrompt,
          seriesId,
          seed,
        });

        // Store image in Supabase Storage
        const timestamp = Date.now();
        const imageId = crypto.randomUUID();
        const storagePath = `stories/${imageId}-${timestamp}.png`;

        const { error: uploadError } = await supabase.storage
          .from("story-images")
          .upload(storagePath, result.imageBuffer, { contentType: "image/png", upsert: true });

        if (uploadError) {
          throw new Error(`Image storage failed: ${uploadError.message}`);
        }

        const { data: { publicUrl } } = supabase.storage
          .from("story-images")
          .getPublicUrl(storagePath);

        // Store pre-face-swap scene image for debugging/comparison
        if (result.sceneImageBase64) {
          const sceneStoragePath = `stories/${imageId}-${timestamp}_scene.png`;
          const sceneBuffer = Buffer.from(result.sceneImageBase64, "base64");
          await supabase.storage
            .from("story-images")
            .upload(sceneStoragePath, sceneBuffer, { contentType: "image/png", upsert: true });
        }

        // Create image record
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
              hasFaceSwap: result.hasFaceSwap,
              pipelineSteps: ["multi-lora-scene", result.hasFaceSwap ? "easel-face-swap" : "no-face-swap"],
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

        // Create generation job record (completed immediately — no async polling)
        await supabase.from("generation_jobs").insert({
          job_id: `replicate-v4-${imageId}`,
          image_id: imageRow.id,
          status: "completed",
          completed_at: new Date().toISOString(),
          cost: 0,
        });

        // Link image to prompt and mark as generated
        await supabase
          .from("story_image_prompts")
          .update({ image_id: imageRow.id, status: "generated" })
          .eq("id", imgPrompt.id);

        generated.push({
          promptId: imgPrompt.id,
          imageId: imageRow.id,
          storedUrl: publicUrl,
          seed: result.seed,
        });

        console.log(`[V4] Generated image ${i + 1}/${prompts.length}: ${imageRow.id} (${Math.round(result.imageBuffer.length / 1024)}KB)`);

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
