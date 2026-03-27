import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { submitRunPodJob } from "@no-safe-word/image-gen";
import { buildSceneGenerationPayload, fetchCharacterDataMap } from "@/lib/server/generate-scene-image";
import { generateV2Scene, buildRefUrlMap } from "@/lib/server/generate-scene-image-v2";

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
      .select("image_engine, inpaint_prompt")
      .eq("id", seriesId)
      .single() as { data: { image_engine: string; inpaint_prompt: string | null } | null };

    const isV2 = series?.image_engine === "nb2_uncanny";
    const seed = Math.floor(Math.random() * 2_147_483_647) + 1;

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

      if (v2Result.nsfwImageId) {
        await (supabase as any)
          .from("story_image_prompts")
          .update({
            image_id: v2Result.nsfwImageId,
            sfw_image_id: v2Result.nb2ImageId,
          })
          .eq("id", promptId);

        return NextResponse.json({
          jobId: v2Result.runpodJobId,
          imageId: v2Result.nsfwImageId,
        });
      } else {
        await supabase
          .from("story_image_prompts")
          .update({
            image_id: v2Result.nb2ImageId,
            status: "generated",
          })
          .eq("id", promptId);

        return NextResponse.json({
          jobId: null,
          imageId: v2Result.nb2ImageId,
          completed: true,
        });
      }
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
