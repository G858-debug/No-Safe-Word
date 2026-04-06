import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { buildTopUpPrompts, buildDatasetWorkflow, buildNegativePrompt } from "@no-safe-word/image-gen";

// GET /api/stories/characters/[storyCharId]/dataset-images/[imageId]/resolved-prompt
// Returns the positive and negative prompts that would be used if this image were regenerated.
// Used to pre-populate the lightbox prompt editors.
export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ storyCharId: string; imageId: string }> }
) {
  const { storyCharId, imageId } = await props.params;

  // Fetch story character + character description
  const { data: storyChar, error: scError } = await (supabase as any)
    .from("story_characters")
    .select(`character_id, characters ( name, description )`)
    .eq("id", storyCharId)
    .single() as { data: any; error: any };

  if (scError || !storyChar) {
    return NextResponse.json({ error: "Story character not found" }, { status: 404 });
  }

  // Fetch the image record for its category
  const { data: img, error: imgError } = await supabase
    .from("lora_dataset_images")
    .select("id, category")
    .eq("id", imageId)
    .single();

  if (imgError || !img) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  const character = storyChar.characters as { name: string; description: Record<string, string> };
  const desc = character.description as Record<string, string>;

  const datasetChar = {
    name: character.name,
    gender: (desc.gender || "female") as "male" | "female",
    ethnicity: desc.ethnicity || "",
    skinTone: desc.skinTone || "",
    hairColor: desc.hairColor || "",
    hairStyle: desc.hairStyle || "",
    eyeColor: desc.eyeColor || "",
    bodyType: desc.bodyType || "",
    age: desc.age || "",
    distinguishingFeatures: desc.distinguishingFeatures || "",
    loraBodyWeight: desc.loraBodyWeight,
    loraBubbleButt: desc.loraBubbleButt,
    loraBreastSize: desc.loraBreastSize,
  };

  // Build a representative prompt for this category
  const [prompt] = buildTopUpPrompts(datasetChar, [{ category: img.category, needed: 1 }]);
  if (!prompt) {
    return NextResponse.json({ error: `No prompt template for category: ${img.category}` }, { status: 400 });
  }

  const { positivePrompt, negativePrompt } = buildDatasetWorkflow({
    character: datasetChar,
    prompt,
    seed: 1, // seed doesn't affect the text prompts
  });

  return NextResponse.json({ positivePrompt, negativePrompt });
}
