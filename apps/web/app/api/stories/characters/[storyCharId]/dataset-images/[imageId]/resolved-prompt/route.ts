import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { buildTopUpPrompts, buildNegativePrompt } from "@no-safe-word/image-gen";

// Quality prefix — matches buildQualityPrefix('sfw') in prompt-builder.ts
const QUALITY_PREFIX = "photograph, high resolution, cinematic, skin textures, detailed";

function buildIdentityDesc(desc: Record<string, string>, gender: string): string {
  const parts: string[] = [];
  const genderWord = gender === "male" ? "man" : "woman";
  if (desc.age) {
    parts.push(`a ${desc.age} year old ${desc.ethnicity || ""} ${genderWord}`);
  } else {
    parts.push(`a young ${desc.ethnicity || ""} ${genderWord}`);
  }
  if (desc.skinTone) parts.push(`${desc.skinTone} skin`);
  if (desc.hairColor && desc.hairStyle) parts.push(`${desc.hairColor} ${desc.hairStyle}`);
  else if (desc.hairStyle) parts.push(desc.hairStyle);
  if (desc.eyeColor) parts.push(`${desc.eyeColor} eyes`);
  if (desc.bodyType) parts.push(desc.bodyType);
  if (desc.distinguishingFeatures) parts.push(desc.distinguishingFeatures);
  return parts.join(", ");
}

// GET /api/stories/characters/[storyCharId]/dataset-images/[imageId]/resolved-prompt
export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ storyCharId: string; imageId: string }> }
) {
  try {
    const { storyCharId, imageId } = await props.params;

    const { data: storyChar, error: scError } = await (supabase as any)
      .from("story_characters")
      .select(`character_id, characters ( name, description )`)
      .eq("id", storyCharId)
      .single() as { data: any; error: any };

    if (scError || !storyChar) {
      return NextResponse.json({ error: "Story character not found" }, { status: 404 });
    }

    const { data: img, error: imgError } = await supabase
      .from("lora_dataset_images")
      .select("id, category")
      .eq("id", imageId)
      .single();

    if (imgError || !img) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }

    const character = storyChar.characters as { name: string; description: Record<string, string> };
    const desc = (character?.description || {}) as Record<string, string>;
    const gender = desc.gender || "female";

    const datasetChar = {
      name: character?.name || "",
      gender: gender as "male" | "female",
      ethnicity: desc.ethnicity || "",
      skinTone: desc.skinTone || "",
      hairColor: desc.hairColor || "",
      hairStyle: desc.hairStyle || "",
      eyeColor: desc.eyeColor || "",
      bodyType: desc.bodyType || "",
      age: desc.age || "",
      distinguishingFeatures: desc.distinguishingFeatures || "",
    };

    const [prompt] = buildTopUpPrompts(datasetChar, [{ category: img.category, needed: 1 }]);
    if (!prompt) {
      return NextResponse.json({ error: `No prompt template for: ${img.category}` }, { status: 400 });
    }

    const identityDesc = buildIdentityDesc(desc, gender);
    const positivePrompt = `${QUALITY_PREFIX}, ${identityDesc}, ${prompt.tags}`;

    // Negative prompt with gender additions (mirrors buildDatasetWorkflow)
    let negativePrompt = buildNegativePrompt("sfw");
    if (gender === "male") {
      negativePrompt += ", 1girl, female, feminine, breasts, lipstick, long eyelashes";
    } else {
      negativePrompt += ", 1boy, masculine, beard, stubble, flat chest";
    }

    return NextResponse.json({ positivePrompt, negativePrompt });
  } catch (err) {
    console.error("[resolved-prompt] Failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to resolve prompt" },
      { status: 500 }
    );
  }
}
