import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { submitRunPodJob, submitFaceSwap } from "@no-safe-word/image-gen";
import { buildSceneGenerationPayload, fetchCharacterDataMap } from "@/lib/server/generate-scene-image";
import { generateV2Scene, buildRefUrlMap } from "@/lib/server/generate-scene-image-v2";
import { buildV3SceneGenerationPayload } from "@/lib/server/generate-scene-image-v3";
import { generateSceneImageV4 } from "@/lib/server/generate-scene-image-v4";

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

    if (!post) {
      throw new Error(`Post ${imgPrompt.post_id} not found — cannot determine series`);
    }

    const seriesId = post.series_id;

    // Check series image engine for V1/V2 dispatch
    const { data: series } = await (supabase as any)
      .from("story_series")
      .select("image_engine, inpaint_prompt, sfw_inpaint_prompt")
      .eq("id", seriesId)
      .single() as { data: { image_engine: string; inpaint_prompt: string | null; sfw_inpaint_prompt: string | null } | null };

    const isV2 = series?.image_engine === "nb2_uncanny";
    const isV3 = series?.image_engine === "flux_pulid";
    const isV4 = series?.image_engine === "flux2_pro";
    const seed = Math.floor(Math.random() * 2_147_483_647) + 1;

    if (isV4) {
      // ── V4 Pipeline: Multi-LoRA scene (sync) + Face Swap (async) ──
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

      // Submit face swap AFTER upload — uses the permanent Supabase URL, not Replicate's temp URL
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
        console.log(`[V4][${promptId}] Face swap submitted: ${faceSwapPredictionId}`);
      }

      // Create image record with scene image (face-swapped version replaces it when ready)
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

      // Create generation job — pending if face swap is running, completed if no swap needed
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
        .eq("id", promptId);

      if (hasFaceSwap) {
        // Face swap is running async — client polls /api/status/{jobId}
        return NextResponse.json({
          jobId,
          imageId: imageRow.id,
          completed: false,
        });
      }

      // No face swap needed — image is complete
      return NextResponse.json({
        jobId,
        imageId: imageRow.id,
        imageUrl: publicUrl,
        completed: true,
      });
    }

    if (isV3) {
      // ── V3 Pipeline: Flux Krea + PuLID (no character LoRAs) ──
      const characterIds = [imgPrompt.character_id, imgPrompt.secondary_character_id].filter(
        (id): id is string => id !== null,
      );
      const characterDataMap = await fetchCharacterDataMap(characterIds);

      const result = await buildV3SceneGenerationPayload({
        imgPrompt,
        seriesId,
        characterDataMap,
        seed,
      });

      console.log(
        `[V3][${promptId}] Regenerate: type=${result.effectiveKontextType}, sfw=${result.mode === "sfw"}, dims=${result.width}x${result.height}, refs=${result.images.length}`,
      );

      // Submit to RunPod (no character LoRA downloads in V3)
      const { jobId: kontextJobId } = await submitRunPodJob(
        result.workflow,
        result.images.length > 0 ? result.images : undefined,
      );

      const { data: imageRow, error: imgError } = await supabase
        .from("images")
        .insert({
          character_id: imgPrompt.character_id || null,
          prompt: result.assembledPrompt,
          negative_prompt: "",
          settings: {
            width: result.width,
            height: result.height,
            steps: 20,
            cfg: 3.5,
            seed: result.seed,
            engine: "runpod-v3-flux-pulid",
            workflowType: result.effectiveKontextType,
          },
          mode: result.mode,
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
    }

    if (isV2) {
      // ── V2 Pipeline: NB2 → Florence-2/SAM2 → UnCanny ──
      const refUrlMap = await buildRefUrlMap(seriesId);
      const inpaintPrompt = series?.inpaint_prompt || "bare skin, natural body, photorealistic skin texture";

      const v2Result = await generateV2Scene({
        imgPrompt,
        seriesId,
        refUrlMap,
        seed,
        inpaintPrompt,
      });

      await (supabase as any)
        .from("story_image_prompts")
        .update({
          image_id: v2Result.enhancedImageId,
          sfw_image_id: v2Result.nb2ImageId,
        })
        .eq("id", promptId);

      return NextResponse.json({
        jobId: v2Result.runpodJobId,
        imageId: v2Result.enhancedImageId,
      });
    }

    // ── V1 Pipeline: Flux Kontext + PuLID + Character LoRAs ──

    // 5. Fetch character data for identity prefix + LoRA selection
    const characterIds = [imgPrompt.character_id, imgPrompt.secondary_character_id].filter(
      (id): id is string => id !== null,
    );
    const characterDataMap = await fetchCharacterDataMap(characterIds);

    // 6. Build full generation payload via shared pipeline
    const body = await request.json().catch(() => ({}));
    const diagnosticFlags = body?.diagnosticFlags ?? undefined;

    if (diagnosticFlags) {
      const disabledFlags = Object.entries(diagnosticFlags).filter(([, v]) => !v).map(([k]) => k);
      if (disabledFlags.length > 0) {
        console.log(`[Kontext][${promptId}] Diagnostic mode — disabled: ${disabledFlags.join(', ')}`);
      }
    }

    const result = await buildSceneGenerationPayload({
      imgPrompt,
      seriesId,
      characterDataMap,
      seed,
      diagnosticFlags,
    });

    console.log(
      `[Kontext][${promptId}] Regenerate: type=${result.effectiveKontextType}, sfw=${result.mode === "sfw"}, dims=${result.width}x${result.height}, refs=${result.images.length}`,
    );

    // 7. Submit to RunPod
    const { jobId: kontextJobId } = await submitRunPodJob(
      result.workflow,
      result.images.length > 0 ? result.images : undefined,
      result.characterLoraDownloads.length > 0 ? result.characterLoraDownloads : undefined,
    );

    // 8. Create image record
    const { data: imageRow, error: imgError } = await supabase
      .from("images")
      .insert({
        character_id: imgPrompt.character_id || null,
        prompt: result.assembledPrompt,
        negative_prompt: "",
        settings: {
          width: result.width,
          height: result.height,
          steps: 20,
          cfg: result.effectiveKontextType === "portrait" ? 1.0 : 2.5,
          seed: result.seed,
          engine: "runpod-kontext",
          workflowType: result.effectiveKontextType,
        },
        mode: result.mode,
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
