import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { submitRunPodJob } from "@no-safe-word/image-gen";
import {
  buildV4SceneGenerationPayload,
  fetchCharacterDataMap,
} from "@/lib/server/generate-scene-image-v4";

interface QueuedJob {
  promptId: string;
  jobId: string | null;
}

interface FailedJob {
  promptId: string;
  error: string;
}

// POST /api/stories/[seriesId]/generate-images-v4 — Batch generate V4 scene images (Pony CyberRealistic)
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ seriesId: string }> },
) {
  const params = await props.params;
  const { seriesId } = params;

  try {
    const body = await request.json().catch(() => ({}));
    const { post_id, regenerate } = body as { post_id?: string; regenerate?: boolean };

    // 1. Verify series uses pony_cyberreal engine
    const { data: series } = await (supabase as any)
      .from("story_series")
      .select("image_engine")
      .eq("id", seriesId)
      .single() as { data: { image_engine: string } | null };

    if (series?.image_engine !== "pony_cyberreal") {
      return NextResponse.json(
        { error: `Series engine is "${series?.image_engine}", not "pony_cyberreal". Use the correct batch endpoint.` },
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
      return NextResponse.json({ pipeline: "v4-pony-cyberreal", queued: 0, failed: 0, jobs: [] });
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
      return NextResponse.json({ pipeline: "v4-pony-cyberreal", queued: 0, failed: 0, jobs: [] });
    }

    // 5. Pre-fetch character data
    const characterIds = Array.from(
      new Set(
        prompts
          .flatMap((p) => [p.character_id, p.secondary_character_id])
          .filter((id): id is string => id !== null),
      ),
    );
    const characterDataMap = await fetchCharacterDataMap(characterIds);

    // 6. Generate each image sequentially
    const jobs: QueuedJob[] = [];
    const failed: FailedJob[] = [];
    const ponyEndpointId = process.env.RUNPOD_PONY_ENDPOINT_ID;

    for (let i = 0; i < prompts.length; i++) {
      const imgPrompt = prompts[i];
      try {
        await supabase
          .from("story_image_prompts")
          .update({ status: "generating" })
          .eq("id", imgPrompt.id);

        const seed = Math.floor(Math.random() * 2_147_483_647) + 1;

        const result = await buildV4SceneGenerationPayload({
          imgPrompt,
          seriesId,
          characterDataMap,
          seed,
        });

        // Submit to RunPod Pony endpoint
        const { jobId: runpodJobId } = await submitRunPodJob(
          result.workflow,
          result.images.length > 0 ? result.images : undefined,
          result.characterLoraDownloads.length > 0 ? result.characterLoraDownloads : undefined,
          ponyEndpointId,
        );

        // Create image record
        const { data: imageRow, error: imgError } = await supabase
          .from("images")
          .insert({
            character_id: imgPrompt.character_id || null,
            prompt: result.assembledPrompt,
            negative_prompt: result.negativePrompt,
            settings: {
              width: result.width,
              height: result.height,
              steps: 30,
              cfg: 6.5,
              seed: result.seed,
              engine: "runpod-v4-pony-cyberreal",
              loraCount: (result.workflow['110'] ? result.characterLoraDownloads.length : 0),
            },
            mode: result.mode,
          })
          .select("id")
          .single();

        if (imgError || !imageRow) {
          throw new Error(`Failed to create image record: ${imgError?.message}`);
        }

        await supabase.from("generation_jobs").insert({
          job_id: `runpod-${runpodJobId}`,
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
          jobId: `runpod-${runpodJobId}`,
        });

        console.log(`[V4] Image ${i + 1}/${prompts.length}: job ${runpodJobId} submitted`);

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
      pipeline: "v4-pony-cyberreal",
      queued: jobs.length,
      failed: failed.length,
      jobs,
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
