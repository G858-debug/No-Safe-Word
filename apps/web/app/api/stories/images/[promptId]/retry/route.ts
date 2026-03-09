import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { submitRunPodJob } from "@no-safe-word/image-gen";
import { buildSceneGenerationPayload, fetchCharacterDataMap } from "@/lib/server/generate-scene-image";

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

    if (!post) {
      throw new Error(`Post ${imgPrompt.post_id} not found — cannot determine series`);
    }

    // 3. Fetch character data for identity prefix + LoRA selection
    const characterIds = [imgPrompt.character_id, imgPrompt.secondary_character_id].filter(
      (id): id is string => id !== null,
    );
    const characterDataMap = await fetchCharacterDataMap(characterIds);

    // 4. Build full generation payload via shared pipeline
    const result = await buildSceneGenerationPayload({
      imgPrompt,
      seriesId: post.series_id,
      characterDataMap,
      seed: newSeed,
    });

    // 5. Submit to RunPod
    const { jobId: runpodJobId } = await submitRunPodJob(
      result.workflow,
      result.images.length > 0 ? result.images : undefined,
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
