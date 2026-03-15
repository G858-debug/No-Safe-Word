import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import {
  ALL_PROMPTS,
  interpolateComfyUIPrompt,
  adaptPromptForGender,
} from "@no-safe-word/image-gen/server/character-lora/dataset-prompts";

const MIN_PASSED_IMAGES = 20;

// GET /api/stories/characters/[storyCharId]/dataset-images
// Returns all dataset images for the character's active LoRA with eval scores and approval status.
export async function GET(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    // Get story character → character_id → active LoRA + character description for prompt resolution
    const { data: storyChar, error: scError } = await (supabase as any)
      .from("story_characters")
      .select(`
        character_id, active_lora_id,
        characters ( description )
      `)
      .eq("id", storyCharId)
      .single() as { data: any; error: any };

    if (scError || !storyChar) {
      return NextResponse.json(
        { error: "Story character not found" },
        { status: 404 }
      );
    }

    // Find the most recent LoRA for this character (active or most recent by date)
    const loraId = storyChar.active_lora_id;
    let loraQuery = supabase
      .from("character_loras")
      .select("id, status")
      .eq("character_id", storyChar.character_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (loraId) {
      loraQuery = supabase
        .from("character_loras")
        .select("id, status")
        .eq("id", loraId)
        .single();
    }

    const { data: lora, error: loraError } = await loraQuery;

    if (loraError || !lora) {
      return NextResponse.json(
        { error: "No LoRA found for this character" },
        { status: 404 }
      );
    }

    // Fetch all dataset images (passed and failed, not replaced)
    const { data: images, error: imgError } = await supabase
      .from("lora_dataset_images")
      .select(
        "id, image_url, category, variation_type, eval_status, eval_score, eval_details, human_approved, caption, prompt_template, source"
      )
      .eq("lora_id", lora.id)
      .in("eval_status", ["passed", "failed"])
      .order("category", { ascending: true });

    if (imgError) {
      return NextResponse.json(
        { error: `Failed to fetch images: ${imgError.message}` },
        { status: 500 }
      );
    }

    // Resolve full prompt text from template IDs
    const desc = (storyChar.characters as any)?.description as Record<string, string> | undefined;
    const gender = desc?.gender || "female";
    const promptMap = new Map<string, string>();
    for (const p of ALL_PROMPTS) {
      let resolved = p.prompt;
      if (p.source === "comfyui" && desc) {
        resolved = interpolateComfyUIPrompt(resolved, {
          ethnicity: desc.ethnicity || "",
          bodyType: desc.bodyType || "",
          skinTone: desc.skinTone || "",
          hairStyle: desc.hairStyle || "",
          hairColor: desc.hairColor || "",
        });
      }
      resolved = adaptPromptForGender(resolved, gender);
      promptMap.set(p.id, resolved);
    }

    const allImages = (images || []).map((img: any) => ({
      ...img,
      resolvedPrompt: img.source === "sdxl-img2img" ? null : (promptMap.get(img.prompt_template) ?? null),
    }));

    const stats = {
      total: allImages.length,
      passed: allImages.filter((i: any) => i.eval_status === "passed").length,
      humanApproved: allImages.filter((i: any) => i.human_approved === true).length,
      humanRejected: allImages.filter((i: any) => i.human_approved === false).length,
      humanPending: allImages.filter((i: any) => i.human_approved === null).length,
      minRequired: MIN_PASSED_IMAGES,
    };

    return NextResponse.json({
      loraId: lora.id,
      loraStatus: lora.status,
      images: allImages,
      stats,
    });
  } catch (err) {
    console.error("[Dataset Images API] Failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch dataset images" },
      { status: 500 }
    );
  }
}
