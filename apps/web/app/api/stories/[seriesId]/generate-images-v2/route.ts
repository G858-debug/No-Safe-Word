/**
 * V2 Scene Image Generation Route
 *
 * POST /api/stories/[seriesId]/generate-images-v2
 *
 * Full end-to-end pipeline:
 *   Stage A: NB2 on Replicate generates base scene with character reference images
 *   Stage B: Florence-2 + SAM2 detect and mask clothing regions
 *   Stage C: UnCanny (Chroma) inpaints the masked region
 *
 * Guarded by SCENE_PIPELINE_VERSION=v2 env var.
 * This route is completely independent from the V1 generate-images route.
 *
 * Request body:
 * {
 *   "post_id": "optional-target-post",
 *   "regenerate": false,
 *   "inpaint_prompt": "bare skin, natural body, photorealistic skin texture",
 *   "mask_query": "clothing",           // default: "clothing"
 *   "denoise_strength": 0.90,           // default: 0.90
 *   "aspect_ratio": "3:4"               // default: "3:4"
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import {
  submitUncannyInpaintJob,
  runNb2Scene,
  imageUrlToBase64,
} from "@no-safe-word/image-gen";

interface QueuedJob {
  promptId: string;
  jobId: string;
  nb2ImageBase64Length: number;
}

interface FailedJob {
  promptId: string;
  error: string;
}

// POST /api/stories/[seriesId]/generate-images-v2
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  // ── Feature flag guard ──
  if (process.env.SCENE_PIPELINE_VERSION !== "v2") {
    return NextResponse.json(
      { error: "V2 pipeline not enabled. Set SCENE_PIPELINE_VERSION=v2 to activate." },
      { status: 404 }
    );
  }

  const params = await props.params;
  const { seriesId } = params;

  try {
    const body = await request.json().catch(() => ({}));
    const {
      post_id,
      regenerate,
      mask_query,
      inpaint_prompt,
      denoise_strength,
      aspect_ratio,
    } = body as {
      post_id?: string;
      regenerate?: boolean;
      mask_query?: string;
      inpaint_prompt?: string;
      denoise_strength?: number;
      aspect_ratio?: string;
    };

    if (!inpaint_prompt) {
      return NextResponse.json(
        { error: "inpaint_prompt is required — describe what should replace the masked region" },
        { status: 400 }
      );
    }

    // 1. Fetch story characters and their reference images
    const { data: storyChars, error: charsError } = await (supabase as any)
      .from("story_characters")
      .select("id, character_id, approved_seed, face_url, approved_image_id, approved_fullbody_image_id")
      .eq("series_id", seriesId) as {
        data: Array<{
          id: string;
          character_id: string;
          approved_seed: number | null;
          face_url: string | null;
          approved_image_id: string | null;
          approved_fullbody_image_id: string | null;
        }> | null;
        error: any;
      };

    if (charsError) {
      return NextResponse.json({ error: charsError.message }, { status: 500 });
    }

    if (!storyChars || storyChars.length === 0) {
      return NextResponse.json(
        { error: "No characters found for this series" },
        { status: 400 }
      );
    }

    // Build seed map and reference URL map
    const seedMap = new Map<string, number | null>();
    const refUrlMap = new Map<string, string[]>();

    for (const sc of storyChars) {
      seedMap.set(sc.character_id, sc.approved_seed);

      // Collect reference image URLs for NB2 character consistency
      const urls: string[] = [];

      // Face URL (direct link — fastest)
      if (sc.face_url) {
        urls.push(sc.face_url);
      }

      // Approved face portrait
      if (sc.approved_image_id) {
        const { data: faceImg } = await supabase
          .from("images")
          .select("stored_url, sfw_url")
          .eq("id", sc.approved_image_id)
          .single();
        const url = faceImg?.stored_url || faceImg?.sfw_url;
        if (url) urls.push(url);
      }

      // Approved body portrait
      if (sc.approved_fullbody_image_id) {
        const { data: bodyImg } = await supabase
          .from("images")
          .select("stored_url, sfw_url")
          .eq("id", sc.approved_fullbody_image_id)
          .single();
        const url = bodyImg?.stored_url || bodyImg?.sfw_url;
        if (url) urls.push(url);
      }

      refUrlMap.set(sc.character_id, urls);
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
        return NextResponse.json(
          { error: "Post not found in this series" },
          { status: 404 }
        );
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
      return NextResponse.json({ queued: 0, skipped: 0, jobs: [] });
    }

    // 3. If regenerate, reset generated prompts back to pending
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
      .select(
        "id, post_id, image_type, position, character_name, character_id, " +
        "secondary_character_name, secondary_character_id, prompt"
      )
      .in("post_id", postIds)
      .in("status", ["pending", "generating", "failed"]);

    if (promptsError) {
      return NextResponse.json(
        { error: promptsError.message },
        { status: 500 }
      );
    }

    if (!prompts || prompts.length === 0) {
      return NextResponse.json({ queued: 0, skipped: 0, jobs: [] });
    }

    // 5. Full V2 Pipeline: NB2 (Stage A) → Masking + Inpainting (Stage B+C)
    const jobs: QueuedJob[] = [];
    const failed: FailedJob[] = [];
    let skipped = 0;

    for (let i = 0; i < prompts.length; i++) {
      const imgPrompt = prompts[i];
      try {
        // Mark as generating
        await supabase
          .from("story_image_prompts")
          .update({ status: "generating" })
          .eq("id", imgPrompt.id);

        // Collect character reference URLs for NB2
        const referenceImageUrls: string[] = [];
        if (imgPrompt.character_id) {
          const urls = refUrlMap.get(imgPrompt.character_id);
          if (urls) referenceImageUrls.push(...urls);
        }
        if (imgPrompt.secondary_character_id) {
          const urls = refUrlMap.get(imgPrompt.secondary_character_id);
          if (urls) referenceImageUrls.push(...urls);
        }

        // Calculate seed
        let seed = -1;
        if (imgPrompt.character_id) {
          const approvedSeed = seedMap.get(imgPrompt.character_id);
          if (approvedSeed != null && approvedSeed > 0) {
            seed = approvedSeed + imgPrompt.position;
          }
        }
        if (seed === -1) {
          seed = Math.floor(Math.random() * 2_147_483_647) + 1;
        }

        // ── Stage A: Generate base scene via NB2 on Replicate ──
        console.log(
          `[V2 Pipeline][${imgPrompt.id}] Stage A: NB2 generation with ` +
          `${referenceImageUrls.length} reference images...`
        );

        const nb2Result = await runNb2Scene({
          prompt: imgPrompt.prompt,
          referenceImageUrls,
          aspectRatio: aspect_ratio || "3:4",
          seed,
          safetyTolerance: 6,
        });

        console.log(
          `[V2 Pipeline][${imgPrompt.id}] Stage A complete: ` +
          `${Math.round(nb2Result.imageBuffer.length / 1024)}KB`
        );

        // Store NB2 base image as a record (for comparison and debugging)
        const { data: nb2ImageRow, error: nb2ImgError } = await supabase
          .from("images")
          .insert({
            character_id: imgPrompt.character_id || null,
            prompt: imgPrompt.prompt,
            negative_prompt: "",
            settings: {
              seed,
              engine: "replicate-nb2",
              pipelineVersion: "v2-stage-a",
              aspectRatio: aspect_ratio || "3:4",
              referenceImageCount: referenceImageUrls.length,
            },
            mode: imgPrompt.image_type === "website_nsfw_paired" ? "nsfw" : "sfw",
          })
          .select("id")
          .single();

        if (nb2ImgError || !nb2ImageRow) {
          throw new Error(`Failed to create NB2 image record: ${nb2ImgError?.message}`);
        }

        // Upload NB2 image to Supabase Storage for reference
        const nb2StoragePath = `story-images/v2-nb2/${nb2ImageRow.id}.png`;
        const { error: uploadError } = await supabase.storage
          .from("images")
          .upload(nb2StoragePath, nb2Result.imageBuffer, {
            contentType: "image/png",
            upsert: true,
          });

        let nb2StoredUrl: string | null = null;
        if (!uploadError) {
          const { data: publicUrl } = supabase.storage
            .from("images")
            .getPublicUrl(nb2StoragePath);
          nb2StoredUrl = publicUrl.publicUrl;

          await supabase
            .from("images")
            .update({ stored_url: nb2StoredUrl })
            .eq("id", nb2ImageRow.id);
        } else {
          console.warn(
            `[V2 Pipeline][${imgPrompt.id}] NB2 image upload failed: ${uploadError.message}. ` +
            `Continuing with base64 — inpainting will still work.`
          );
        }

        // ── Stage B+C: Submit masking + inpainting to RunPod ──
        // Use the NB2 stored URL if available, otherwise convert base64 to a data URL
        const baseImageUrl = nb2StoredUrl || `data:image/png;base64,${nb2Result.imageBase64}`;

        const { jobId, seed: inpaintSeed } = await submitUncannyInpaintJob({
          baseImageUrl,
          maskQuery: mask_query || "clothing",
          inpaintPrompt: inpaint_prompt,
          seed: seed + 1000, // Offset inpaint seed from NB2 seed
          denoiseStrength: denoise_strength,
          filenamePrefix: `uncanny_v2_${imgPrompt.id.substring(0, 8)}`,
        });

        console.log(
          `[V2 Pipeline][${imgPrompt.id}] Stage B+C submitted: job=${jobId}, ` +
          `inpaintSeed=${inpaintSeed}`
        );

        // Create image record for the inpainted result
        const { data: imageRow, error: imgError } = await supabase
          .from("images")
          .insert({
            character_id: imgPrompt.character_id || null,
            prompt: inpaint_prompt,
            negative_prompt: "",
            settings: {
              width: 0,
              height: 0,
              steps: 20,
              cfg: 1.0,
              seed: inpaintSeed,
              engine: "runpod-uncanny-v2",
              pipelineVersion: "v2",
              maskQuery: mask_query || "clothing",
              denoiseStrength: denoise_strength || 0.90,
              nb2ImageId: nb2ImageRow.id,
              nb2Seed: seed,
            },
            mode: imgPrompt.image_type === "website_nsfw_paired" ? "nsfw" : "sfw",
          })
          .select("id")
          .single();

        if (imgError || !imageRow) {
          throw new Error(`Failed to create image record: ${imgError?.message}`);
        }

        await supabase.from("generation_jobs").insert({
          job_id: `runpod-${jobId}`,
          image_id: imageRow.id,
          status: "pending",
          cost: 0,
        });

        await supabase
          .from("story_image_prompts")
          .update({ image_id: imageRow.id })
          .eq("id", imgPrompt.id);

        jobs.push({
          promptId: imgPrompt.id,
          jobId: `runpod-${jobId}`,
          nb2ImageBase64Length: nb2Result.imageBase64.length,
        });

        if (i < prompts.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (err) {
        await supabase
          .from("story_image_prompts")
          .update({ status: "failed" })
          .eq("id", imgPrompt.id);

        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(
          `[V2 Pipeline] Failed to generate image for prompt ${imgPrompt.id}:`,
          message
        );
        failed.push({ promptId: imgPrompt.id, error: message });

        if (i < prompts.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }

    return NextResponse.json({
      pipeline: "v2-uncanny-full",
      queued: jobs.length,
      skipped,
      failed: failed.length,
      jobs,
      errors: failed.length > 0 ? failed : undefined,
    });
  } catch (err) {
    console.error("[V2 Pipeline] Batch generation failed:", err);
    return NextResponse.json(
      {
        error: "V2 batch generation failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
