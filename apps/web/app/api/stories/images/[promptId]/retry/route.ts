import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { submitRunPodJob } from "@no-safe-word/image-gen";
import type { SceneProfile } from "@no-safe-word/image-gen";
import { buildV4SceneGenerationPayload, fetchCharacterDataMap } from "@/lib/server/generate-scene-image-v4";

// POST /api/stories/images/[promptId]/retry — Internal retry for evaluation failures.
// Called by the status route when scene evaluation detects issues.
// Rebuilds the workflow with a new seed, optional parameter overrides, and optional rewritten tags.
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ promptId: string }> }
) {
  const params = await props.params;
  const { promptId } = params;

  try {
    const body = await request.json();
    const {
      newSeed,
      jobId: oldJobId,
      profileOverrides,
      overrideTags,
      attemptNumber,
    } = body as {
      newSeed: number;
      jobId: string;
      profileOverrides?: Partial<SceneProfile>;
      overrideTags?: string;
      attemptNumber?: number;
    };

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

    if (!post) {
      throw new Error(`Post ${imgPrompt.post_id} not found — cannot determine series`);
    }

    // 3. Fetch character data
    const characterIds = [imgPrompt.character_id, imgPrompt.secondary_character_id].filter(
      (id): id is string => id !== null,
    );
    const characterDataMap = await fetchCharacterDataMap(characterIds);

    // 4. Build V4 generation payload with new seed + optional overrides
    const result = await buildV4SceneGenerationPayload({
      imgPrompt,
      seriesId: post.series_id,
      characterDataMap,
      seed: newSeed,
      profileOverrides,
      overrideTags,
    });

    // 5. Submit to RunPod
    const endpointId = process.env.RUNPOD_ENDPOINT_ID;
    const { jobId: runpodJobId } = await submitRunPodJob(
      result.workflow,
      result.images.length > 0 ? result.images : undefined,
      result.characterLoraDownloads.length > 0 ? result.characterLoraDownloads : undefined,
      endpointId,
    );

    const newJobId = `runpod-${runpodJobId}`;

    // Update the generation job with the new job ID
    await supabase
      .from("generation_jobs")
      .update({ job_id: newJobId, status: "pending", completed_at: null })
      .eq("job_id", oldJobId);

    // Update image record with new settings (seed, profile params)
    if (imgPrompt.image_id) {
      await supabase
        .from("images")
        .update({
          prompt: result.assembledPrompt,
          settings: {
            width: result.width,
            height: result.height,
            steps: result.profile.steps,
            cfg: result.profile.cfg,
            seed: newSeed,
            engine: "runpod-v4-juggernaut-ragnarok",
            attemptNumber: attemptNumber || 1,
          },
        })
        .eq("id", imgPrompt.image_id);
    }

    console.log(
      `[Retry][${promptId}] Attempt ${attemptNumber || '?'}: ` +
      `seed=${newSeed}, job=${newJobId}` +
      (profileOverrides ? `, overrides=${JSON.stringify(profileOverrides)}` : '') +
      (overrideTags ? ', tags=rewritten' : ''),
    );

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
