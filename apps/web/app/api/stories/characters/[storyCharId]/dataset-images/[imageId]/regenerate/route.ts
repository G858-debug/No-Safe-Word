import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { regenerateSingleImage, buildExtraNegativeFromEval } from "@no-safe-word/image-gen/server/character-lora/dataset-generator";
import { evaluateDataset } from "@no-safe-word/image-gen/server/character-lora/quality-evaluator";
import type { CharacterInput, CharacterStructured, ImageSource, VariationType } from "@no-safe-word/image-gen";

// POST /api/stories/characters/[storyCharId]/dataset-images/[imageId]/regenerate
// Kicks off dataset image regeneration in the background (fire-and-forget)
// and returns immediately to avoid Cloudflare's 100-second proxy timeout.
// The frontend polls GET .../[imageId]/regenerate-status for the result.
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string; imageId: string }> }
) {
  const params = await props.params;
  const { storyCharId, imageId } = params;

  try {
    const body = await request.json().catch(() => ({}));
    const customPrompt: string | undefined = typeof body.customPrompt === "string" ? body.customPrompt : undefined;

    // 1. Fetch story character with character data
    const { data: storyChar, error: scError } = await (supabase as any)
      .from("story_characters")
      .select(`
        id, character_id, approved_image_id, approved_seed, approved_prompt,
        approved_fullbody_image_id, approved_fullbody_seed, active_lora_id,
        characters ( id, name, description )
      `)
      .eq("id", storyCharId)
      .single() as { data: any; error: any };

    if (scError || !storyChar) {
      return NextResponse.json({ error: "Story character not found" }, { status: 404 });
    }

    // 2. Find the LoRA
    let loraQuery = supabase
      .from("character_loras")
      .select("id, status")
      .eq("character_id", storyChar.character_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (storyChar.active_lora_id) {
      loraQuery = supabase
        .from("character_loras")
        .select("id, status")
        .eq("id", storyChar.active_lora_id)
        .single();
    }

    const { data: lora, error: loraError } = await loraQuery;
    if (loraError || !lora) {
      return NextResponse.json({ error: "No LoRA found" }, { status: 404 });
    }

    // 3. Fetch the existing image to get source/category/variationType
    const { data: existingImage, error: imgError } = await supabase
      .from("lora_dataset_images")
      .select("id, source, category, variation_type, prompt_template")
      .eq("id", imageId)
      .eq("lora_id", lora.id)
      .single();

    if (imgError || !existingImage) {
      return NextResponse.json({ error: "Dataset image not found" }, { status: 404 });
    }

    // 4. Build CharacterInput
    const character = storyChar.characters as { id: string; name: string; description: Record<string, unknown> };
    const desc = character.description as Record<string, string>;

    const [portraitImage, fullBodyImage] = await Promise.all([
      supabase.from("images").select("stored_url, sfw_url").eq("id", storyChar.approved_image_id!).single(),
      supabase.from("images").select("stored_url, sfw_url").eq("id", storyChar.approved_fullbody_image_id!).single(),
    ]);

    const portraitUrl = portraitImage.data?.sfw_url || portraitImage.data?.stored_url;
    const fullBodyUrl = fullBodyImage.data?.sfw_url || fullBodyImage.data?.stored_url;

    if (!portraitUrl || !fullBodyUrl) {
      return NextResponse.json({ error: "Could not find approved image URLs" }, { status: 500 });
    }

    const structuredData: CharacterStructured = {
      gender: desc.gender || "female",
      ethnicity: desc.ethnicity || "",
      bodyType: desc.bodyType || "",
      skinTone: desc.skinTone || "",
      hairColor: desc.hairColor || "",
      hairStyle: desc.hairStyle || "",
      eyeColor: desc.eyeColor || "",
      age: desc.age || "",
      distinguishingFeatures: desc.distinguishingFeatures,
    };

    const characterInput: CharacterInput = {
      characterId: character.id,
      characterName: character.name,
      gender: desc.gender || "female",
      approvedImageUrl: portraitUrl,
      approvedPrompt: storyChar.approved_prompt || "",
      fullBodyImageUrl: fullBodyUrl,
      fullBodySeed: storyChar.approved_fullbody_seed || 42,
      portraitSeed: storyChar.approved_seed || 42,
      structuredData,
      pipelineType: "story_character",
    };

    // 5. Mark old image as replaced
    await supabase
      .from("lora_dataset_images")
      .update({ eval_status: "replaced" } as any)
      .eq("id", imageId);

    // 6. Fire-and-forget: kick off regeneration in the background.
    // Use a placeholder row with eval_status='pending' (allowed by DB check constraint)
    // and a unique marker in prompt_template so the status endpoint can find it.
    const regenMarker = `__regen_${Date.now()}`;
    const { data: placeholder, error: phError } = await supabase
      .from("lora_dataset_images")
      .insert({
        lora_id: lora.id,
        image_url: "",
        storage_path: "",
        prompt_template: regenMarker,
        variation_type: existingImage.variation_type,
        source: existingImage.source,
        category: existingImage.category,
        eval_status: "pending",
      } as any)
      .select("id")
      .single();

    if (phError || !placeholder) {
      throw new Error(`Failed to create placeholder: ${phError?.message}`);
    }

    const placeholderId = placeholder.id;

    console.log(`[Regenerate Image] Background job started: placeholder=${placeholderId}, replacing=${imageId}`);

    // Run the generation in the background (don't await)
    // Body shots get up to 3 attempts with variant cycling + eval-informed negative prompts.
    // Face shots remain single-attempt.
    const isBodyShot = ["waist-up", "full-body", "body-detail"].includes(existingImage.category);
    const maxAttempts = isBodyShot ? 3 : 1;

    (async () => {
      let lastEvalDetails: any = undefined;
      let passed = false;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const newImage = await regenerateSingleImage(
          characterInput,
          lora.id,
          {
            source: existingImage.source as ImageSource,
            category: existingImage.category,
            variationType: existingImage.variation_type as VariationType,
            promptTemplate: existingImage.prompt_template,
          },
          customPrompt,
          { supabase },
          {
            variantOffset: attempt,
            extraNegative: lastEvalDetails ? buildExtraNegativeFromEval(lastEvalDetails) : undefined,
          },
        );

        // Delete placeholder on first attempt only (real image row already created)
        if (attempt === 1) {
          await supabase
            .from("lora_dataset_images")
            .delete()
            .eq("id", placeholderId);
          console.log(`[Regenerate Image] Background job started: attempt ${attempt}/${maxAttempts}, newImage=${newImage.id}, placeholder=${placeholderId} deleted`);
        } else {
          console.log(`[Regenerate Image] Retry attempt ${attempt}/${maxAttempts}: newImage=${newImage.id}`);
        }

        // Evaluate the new image against reference images
        const evalResult = await evaluateDataset(portraitUrl, fullBodyUrl, [newImage], { supabase });
        passed = evalResult.passed > 0;

        if (passed || attempt === maxAttempts) {
          // Final attempt or passed — set human_approved and stop
          await supabase
            .from("lora_dataset_images")
            .update({ human_approved: passed } as any)
            .eq("id", newImage.id);
          console.log(
            `[Regenerate Image] Body shot ${passed ? "passed" : "failed"} on attempt ${attempt}/${maxAttempts} for newImage=${newImage.id}`
          );
          break;
        }

        // Failed but attempts remain — fetch eval details for negative prompt reinforcement
        const { data: evalRow } = await supabase
          .from("lora_dataset_images")
          .select("eval_details")
          .eq("id", newImage.id)
          .single();
        lastEvalDetails = evalRow?.eval_details;

        console.log(`[Regenerate Image] Body shot attempt ${attempt}/${maxAttempts}: FAIL, retrying with different variant...`);

        // Mark this attempt as replaced before generating the next
        await supabase
          .from("lora_dataset_images")
          .update({ eval_status: "replaced" } as any)
          .eq("id", newImage.id);
      }
    })().catch(async (err) => {
      // Generation failed — mark placeholder as failed with error in eval_details
      console.error("[Regenerate Image] Background job failed:", {
        placeholderId,
        imageId,
        error: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });

      await supabase
        .from("lora_dataset_images")
        .update({
          eval_status: "failed",
          eval_details: { error: err instanceof Error ? err.message : "Unknown error" },
        } as any)
        .eq("id", placeholderId);
    });

    // 7. Return immediately with the placeholder ID for polling
    return NextResponse.json({
      accepted: true,
      placeholderId,
      oldImageId: imageId,
    });
  } catch (err) {
    console.error("[Regenerate Image] Failed to start:", {
      storyCharId,
      imageId,
      error: err instanceof Error ? { message: err.message, stack: err.stack } : err,
    });
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to regenerate image",
      },
      { status: 500 }
    );
  }
}
