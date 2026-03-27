import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { submitRunPodJob } from "@no-safe-word/image-gen";
import { buildSceneGenerationPayload, fetchCharacterDataMap } from "@/lib/server/generate-scene-image";
import { generateV2Scene, buildRefUrlMap } from "@/lib/server/generate-scene-image-v2";

interface QueuedJob {
  promptId: string;
  jobId: string | null;
  completed?: boolean;
}

interface FailedJob {
  promptId: string;
  error: string;
}

// POST /api/stories/[seriesId]/generate-images — Batch generate story images
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const params = await props.params;
  const { seriesId } = params;

  try {
    const body = await request.json().catch(() => ({}));
    const { post_id, regenerate } = body as { post_id?: string; regenerate?: boolean };

    // 1. Verify all characters in the series are approved
    const { data: storyChars, error: charsError } = await (supabase as any)
      .from("story_characters")
      .select("id, character_id, approved, approved_seed")
      .eq("series_id", seriesId) as {
        data: Array<{
          id: string;
          character_id: string;
          approved: boolean;
          approved_seed: number | null;
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

    // Approval is editorial only — no longer gates scene generation

    // Check series image engine for V1/V2 dispatch
    const { data: series } = await (supabase as any)
      .from("story_series")
      .select("image_engine, inpaint_prompt, sfw_inpaint_prompt")
      .eq("id", seriesId)
      .single() as { data: { image_engine: string; inpaint_prompt: string | null; sfw_inpaint_prompt: string | null } | null };

    const isV2 = series?.image_engine === "nb2_uncanny";

    // Build character_id → approved_seed map
    const seedMap = new Map<string, number | null>();
    storyChars.forEach((sc) => {
      seedMap.set(sc.character_id, sc.approved_seed);
    });

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

    // 3a. If regenerate flag is set, reset "generated" prompts back to "pending"
    if (regenerate) {
      await supabase
        .from("story_image_prompts")
        .update({ status: "pending", image_id: null })
        .in("post_id", postIds)
        .eq("status", "generated");
    }

    // 3. Fetch pending/stuck image prompts for those posts
    const { data: prompts, error: promptsError } = await supabase
      .from("story_image_prompts")
      .select("id, post_id, image_type, position, character_name, character_id, secondary_character_name, secondary_character_id, prompt")
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

    // 4. Pre-fetch all linked characters
    const characterIds = Array.from(
      new Set(
        prompts
          .flatMap((p) => [p.character_id, p.secondary_character_id])
          .filter((id): id is string => id !== null)
      )
    );

    const characterDataMap = await fetchCharacterDataMap(characterIds);

    // V2: build reference URL map for NB2 character consistency
    const refUrlMap = isV2 ? await buildRefUrlMap(seriesId) : null;

    // 5. Generate each image sequentially with delays
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

        // Calculate seed: approved_seed + position for consistency, or random
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

        if (isV2 && refUrlMap) {
          // ── V2 Pipeline: NB2 → Florence-2/SAM2 → UnCanny ──
          const inpaintPrompt = series?.inpaint_prompt || "bare skin, natural body, photorealistic skin texture";

          const v2Result = await generateV2Scene({
            imgPrompt,
            seriesId,
            refUrlMap,
            seed,
            inpaintPrompt,
            sfwInpaintPrompt: series?.sfw_inpaint_prompt || undefined,
          });

          // All V2 images go through inpainting — store NB2 base as sfw_image_id
          await (supabase as any)
            .from("story_image_prompts")
            .update({
              image_id: v2Result.inpaintedImageId,
              sfw_image_id: v2Result.nb2ImageId,
            })
            .eq("id", imgPrompt.id);

          jobs.push({
            promptId: imgPrompt.id,
            jobId: v2Result.runpodJobId,
          });
        } else {
          // ── V1 Pipeline: Flux Kontext + PuLID + Character LoRAs ──
          const result = await buildSceneGenerationPayload({
            imgPrompt,
            seriesId,
            characterDataMap,
            seed,
          });

          // NOTE: Do NOT persist the assembled prompt back to the DB.
          // The DB stores scene-only text; identity prefix + atmosphere suffix
          // are injected at generation time.

          // Submit to RunPod
          const { jobId: kontextJobId } = await submitRunPodJob(
            result.workflow,
            result.images.length > 0 ? result.images : undefined,
            result.characterLoraDownloads.length > 0 ? result.characterLoraDownloads : undefined,
          );

          // Create image record
          const { data: kontextImageRow, error: kontextImgError } = await supabase
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

          if (kontextImgError || !kontextImageRow) {
            throw new Error(`Failed to create image record: ${kontextImgError?.message}`);
          }

          await supabase.from("generation_jobs").insert({
            job_id: `runpod-${kontextJobId}`,
            image_id: kontextImageRow.id,
            status: "pending",
            cost: 0,
          });

          await supabase
            .from("story_image_prompts")
            .update({ image_id: kontextImageRow.id })
            .eq("id", imgPrompt.id);

          jobs.push({
            promptId: imgPrompt.id,
            jobId: `runpod-${kontextJobId}`,
          });
        }

        if (i < prompts.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (err) {
        // Mark as failed and continue with the rest
        await supabase
          .from("story_image_prompts")
          .update({ status: "failed" })
          .eq("id", imgPrompt.id);

        const message = err instanceof Error ? err.message : "Unknown error";

        console.error(
          `Failed to generate image for prompt ${imgPrompt.id}:`,
          message
        );
        failed.push({ promptId: imgPrompt.id, error: message });

        if (i < prompts.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }

    return NextResponse.json({
      queued: jobs.length,
      skipped,
      failed: failed.length,
      jobs,
      errors: failed.length > 0 ? failed : undefined,
    });
  } catch (err) {
    console.error("Batch image generation failed:", err);
    return NextResponse.json(
      {
        error: "Batch generation failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
