import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { submitRunPodJob } from "@no-safe-word/image-gen";
import type { SceneProfile } from "@no-safe-word/image-gen";
import { buildV4SceneGenerationPayload, fetchCharacterDataMap } from "@/lib/server/generate-scene-image-v4";

interface RegenerateBody {
  diagnosticFlags?: Record<string, boolean>;
  seed?: number;
  overrideTags?: string;
  negativePromptOverride?: string;
  profileOverrides?: Partial<Pick<SceneProfile, 'charLoraStrengthModel' | 'charLoraStrengthClip' | 'cfg' | 'steps'>>;
  /** Two-pass generation: scene composition without LoRAs → identity refinement with LoRAs.
   *  'auto' enables for multi-person interaction scenes only. */
  twoPassMode?: boolean | 'auto';
  /** Denoise for two-pass refinement (0.3-0.5) */
  twoPassDenoise?: number;
}

// POST /api/stories/images/[promptId]/regenerate — Regenerate a single story image
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ promptId: string }> }
) {
  const params = await props.params;
  const { promptId } = params;

  try {
    const body = (await request.json().catch(() => ({}))) as RegenerateBody;

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

    // 2. Preserve old image for revert (instead of deleting)
    const previousImageId = imgPrompt.image_id || null;

    // 3. Mark as generating + save previous image reference
    await supabase
      .from("story_image_prompts")
      .update({
        status: "generating",
        ...(previousImageId ? { previous_image_id: previousImageId } : {}),
      })
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
    const seed = body.seed ?? Math.floor(Math.random() * 2_147_483_647) + 1;

    // 5. Build V4 scene generation payload
    const characterIds = [imgPrompt.character_id, imgPrompt.secondary_character_id].filter(
      (id): id is string => id !== null,
    );
    const characterDataMap = await fetchCharacterDataMap(characterIds);

    const result = await buildV4SceneGenerationPayload({
      imgPrompt,
      seriesId,
      characterDataMap,
      seed,
      profileOverrides: body.profileOverrides,
      overrideTags: body.overrideTags,
      negativePromptOverride: body.negativePromptOverride,
      twoPassMode: body.twoPassMode,
      twoPassDenoise: body.twoPassDenoise,
    });

    console.log(
      `[V4][${promptId}] Regenerate: mode=${result.mode}, dims=${result.width}x${result.height}, loras=${result.characterLoraDownloads.length}`,
    );

    const endpointId = process.env.RUNPOD_ENDPOINT_ID;

    const { jobId: runpodJobId } = await submitRunPodJob(
      result.workflow,
      result.images.length > 0 ? result.images : undefined,
      result.characterLoraDownloads.length > 0 ? result.characterLoraDownloads : undefined,
      endpointId,
    );

    const { data: imageRow, error: imgError } = await supabase
      .from("images")
      .insert({
        character_id: imgPrompt.character_id || null,
        prompt: result.assembledPrompt,
        negative_prompt: result.negativePrompt,
        settings: {
          width: result.width,
          height: result.height,
          steps: result.profile.steps,
          cfg: result.profile.cfg,
          seed: result.seed,
          engine: "runpod-v4-juggernaut-ragnarok",
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
      .eq("id", promptId);

    return NextResponse.json({
      jobId: `runpod-${runpodJobId}`,
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
