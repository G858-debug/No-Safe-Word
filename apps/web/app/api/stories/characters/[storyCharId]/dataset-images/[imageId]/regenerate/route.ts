import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { regenerateSingleImage } from "@no-safe-word/image-gen/server/character-lora/dataset-generator";
import type { CharacterInput, CharacterStructured, ImageSource, VariationType } from "@no-safe-word/image-gen";

// POST /api/stories/characters/[storyCharId]/dataset-images/[imageId]/regenerate
// Regenerates a single dataset image using the appropriate pipeline.
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

    // 6. Generate replacement image (synchronous — waits for result)
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
    );

    return NextResponse.json({
      success: true,
      image: {
        id: newImage.id,
        image_url: newImage.image_url,
        category: newImage.category,
        variation_type: newImage.variation_type,
        eval_status: newImage.eval_status,
        eval_score: newImage.eval_score,
        eval_details: newImage.eval_details,
        human_approved: newImage.human_approved,
        caption: newImage.caption,
        prompt_template: newImage.prompt_template,
        source: newImage.source,
        resolvedPrompt: customPrompt || null,
      },
    });
  } catch (err) {
    console.error("[Regenerate Image] Failed:", {
      storyCharId,
      imageId,
      error: err instanceof Error ? { message: err.message, stack: err.stack } : err,
    });
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to regenerate image",
        stack: err instanceof Error ? err.stack : undefined,
      },
      { status: 500 }
    );
  }
}
