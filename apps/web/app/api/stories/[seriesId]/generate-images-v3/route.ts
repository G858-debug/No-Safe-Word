import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { submitRunPodJob } from "@no-safe-word/image-gen";
import { buildV3SceneGenerationPayload, fetchCharacterDataMap } from "@/lib/server/generate-scene-image-v3";

interface QueuedJob {
  promptId: string;
  jobId: string | null;
}

interface FailedJob {
  promptId: string;
  error: string;
}

// POST /api/stories/[seriesId]/generate-images-v3 — Batch generate V3 scene images
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ seriesId: string }> },
) {
  const params = await props.params;
  const { seriesId } = params;

  try {
    const body = await request.json().catch(() => ({}));
    const { post_id, regenerate } = body as { post_id?: string; regenerate?: boolean };

    // 1. Verify series uses flux_pulid engine
    const { data: series } = await (supabase as any)
      .from("story_series")
      .select("image_engine")
      .eq("id", seriesId)
      .single() as { data: { image_engine: string } | null };

    if (series?.image_engine !== "flux_pulid") {
      return NextResponse.json(
        { error: `Series engine is "${series?.image_engine}", not "flux_pulid". Use the correct batch endpoint.` },
        { status: 400 },
      );
    }

    // 2. Fetch story characters and verify V3 gate
    const { data: storyChars, error: charsError } = await (supabase as any)
      .from("story_characters")
      .select("id, character_id, approved_seed, face_url, body_prompt_status")
      .eq("series_id", seriesId) as {
        data: Array<{
          id: string;
          character_id: string;
          approved_seed: number | null;
          face_url: string | null;
          body_prompt_status: string;
        }> | null;
        error: any;
      };

    if (charsError) {
      return NextResponse.json({ error: charsError.message }, { status: 500 });
    }

    if (!storyChars || storyChars.length === 0) {
      return NextResponse.json(
        { error: "No characters found for this series" },
        { status: 400 },
      );
    }

    // V3 gate: all characters must have face_url and approved body prompt
    const unapproved = storyChars.filter(
      (sc) => !sc.face_url || sc.body_prompt_status !== "approved",
    );
    if (unapproved.length > 0) {
      return NextResponse.json(
        {
          error: "Not all characters are ready for V3 scene generation",
          details: unapproved.map((sc) => ({
            character_id: sc.character_id,
            hasFaceUrl: !!sc.face_url,
            bodyPromptApproved: sc.body_prompt_status === "approved",
          })),
        },
        { status: 400 },
      );
    }

    // Build seed map
    const seedMap = new Map<string, number | null>();
    storyChars.forEach((sc) => {
      seedMap.set(sc.character_id, sc.approved_seed);
    });

    // 3. Find target posts
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
      return NextResponse.json({ queued: 0, skipped: 0, jobs: [] });
    }

    // 4. Reset generated prompts if regenerate flag
    if (regenerate) {
      await supabase
        .from("story_image_prompts")
        .update({ status: "pending", image_id: null })
        .in("post_id", postIds)
        .eq("status", "generated");
    }

    // 5. Fetch pending/stuck image prompts
    const { data: prompts, error: promptsError } = await supabase
      .from("story_image_prompts")
      .select("id, post_id, image_type, position, character_name, character_id, secondary_character_name, secondary_character_id, prompt")
      .in("post_id", postIds)
      .in("status", ["pending", "generating", "failed"]);

    if (promptsError) {
      return NextResponse.json({ error: promptsError.message }, { status: 500 });
    }

    if (!prompts || prompts.length === 0) {
      return NextResponse.json({ queued: 0, skipped: 0, jobs: [] });
    }

    // 6. Pre-fetch character data
    const characterIds = Array.from(
      new Set(
        prompts
          .flatMap((p) => [p.character_id, p.secondary_character_id])
          .filter((id): id is string => id !== null),
      ),
    );
    const characterDataMap = await fetchCharacterDataMap(characterIds);

    // 7. Generate each image
    const jobs: QueuedJob[] = [];
    const failed: FailedJob[] = [];

    for (let i = 0; i < prompts.length; i++) {
      const imgPrompt = prompts[i];
      try {
        await supabase
          .from("story_image_prompts")
          .update({ status: "generating" })
          .eq("id", imgPrompt.id);

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

        const result = await buildV3SceneGenerationPayload({
          imgPrompt,
          seriesId,
          characterDataMap,
          seed,
        });

        // Submit to RunPod (no character LoRA downloads in V3)
        const { jobId: kontextJobId } = await submitRunPodJob(
          result.workflow,
          result.images.length > 0 ? result.images : undefined,
        );

        // Create image record
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
          .eq("id", imgPrompt.id);

        jobs.push({
          promptId: imgPrompt.id,
          jobId: `runpod-${kontextJobId}`,
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
        console.error(`[V3] Failed to generate image for prompt ${imgPrompt.id}:`, message);
        failed.push({ promptId: imgPrompt.id, error: message });

        if (i < prompts.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }

    return NextResponse.json({
      pipeline: "v3-flux-pulid",
      queued: jobs.length,
      skipped: 0,
      failed: failed.length,
      jobs,
      errors: failed.length > 0 ? failed : undefined,
    });
  } catch (err) {
    console.error("[V3] Batch image generation failed:", err);
    return NextResponse.json(
      {
        error: "V3 batch generation failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
