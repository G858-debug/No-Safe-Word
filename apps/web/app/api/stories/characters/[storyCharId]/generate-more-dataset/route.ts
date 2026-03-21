import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { generateNanoBananaFemaleBodyShots, generateNanoBananaMaleBodyShots } from "@no-safe-word/image-gen/server/character-lora/dataset-generator";
import { evaluateDataset } from "@no-safe-word/image-gen/server/character-lora/quality-evaluator";
import type { CharacterInput, CharacterStructured } from "@no-safe-word/image-gen";

// POST /api/stories/characters/[storyCharId]/generate-more-dataset
// Generates additional body shots for a failed LoRA that already has face shots.
// Runs in the background (fire-and-forget).
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    // 1. Fetch story character with character data
    const { data: storyChar, error: scError } = await (supabase as any)
      .from("story_characters")
      .select(`
        id, character_id, approved_image_id, approved_seed, approved_prompt,
        approved_fullbody_image_id, approved_fullbody_seed,
        characters ( id, name, description )
      `)
      .eq("id", storyCharId)
      .single() as { data: any; error: any };

    if (scError || !storyChar) {
      return NextResponse.json({ error: "Story character not found" }, { status: 404 });
    }

    // 2. Find the failed LoRA for this character
    const { data: lora, error: loraError } = await supabase
      .from("character_loras")
      .select("id, status")
      .eq("character_id", storyChar.character_id)
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (loraError || !lora) {
      return NextResponse.json(
        { error: "No failed LoRA found for this character" },
        { status: 400 }
      );
    }

    // 3. Get approved image URLs
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

    // 4. Build CharacterInput
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

    // 5. Update status and fire-and-forget
    await supabase
      .from("character_loras")
      .update({ status: "generating_dataset", error: null } as any)
      .eq("id", lora.id);

    console.log(`[Generate More] Starting body generation for ${character.name} (loraId: ${lora.id})`);

    // Fire-and-forget background job
    (async () => {
      try {
        const generateFn = characterInput.gender === 'female' ? generateNanoBananaFemaleBodyShots : generateNanoBananaMaleBodyShots;
        const sdxlResult = await generateFn(characterInput, lora.id, 16, { supabase });
        console.log(`[Generate More] ${character.name}: ${sdxlResult.records.length} body images generated`);

        if (sdxlResult.records.length === 0) {
          await supabase
            .from("character_loras")
            .update({ status: "failed", error: "Body shot generation produced no images" } as any)
            .eq("id", lora.id);
          return;
        }

        // Evaluate new body images
        await supabase
          .from("character_loras")
          .update({ status: "evaluating" } as any)
          .eq("id", lora.id);

        const evalResult = await evaluateDataset(portraitUrl, fullBodyUrl, sdxlResult.records, { supabase });
        console.log(`[Generate More] ${character.name}: ${evalResult.passed} body images passed evaluation`);

        // Count total passed (existing + new)
        const { count: existingPassed } = await supabase
          .from("lora_dataset_images")
          .select("*", { count: "exact", head: true })
          .eq("lora_id", lora.id)
          .eq("eval_status", "passed")
          .not("id", "in", `(${sdxlResult.records.map(r => r.id).join(",")})`);

        // Simpler: just count all passed for this LoRA
        const { count: totalPassed } = await supabase
          .from("lora_dataset_images")
          .select("*", { count: "exact", head: true })
          .eq("lora_id", lora.id)
          .eq("eval_status", "passed");

        console.log(`[Generate More] ${character.name}: ${totalPassed} total passed images`);

        if ((totalPassed || 0) < 20) {
          await supabase
            .from("character_loras")
            .update({
              status: "failed",
              error: `Only ${totalPassed} images passed evaluation after body generation (minimum 20 required).`,
            } as any)
            .eq("id", lora.id);
          return;
        }

        // Pre-seed human_approved
        await supabase
          .from("lora_dataset_images")
          .update({ human_approved: true } as any)
          .eq("lora_id", lora.id)
          .eq("eval_status", "passed");

        await supabase
          .from("lora_dataset_images")
          .update({ human_approved: false } as any)
          .eq("lora_id", lora.id)
          .in("eval_status", ["failed", "replaced"]);

        await supabase
          .from("character_loras")
          .update({
            status: "awaiting_dataset_approval",
            completed_stage: "evaluation",
            error: null,
          } as any)
          .eq("id", lora.id);

        console.log(`[Generate More] ${character.name}: Ready for review (${totalPassed} images)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Generate More] ${character.name} FAILED: ${msg}`);
        await supabase
          .from("character_loras")
          .update({ status: "failed", error: `Body generation failed: ${msg}` } as any)
          .eq("id", lora.id);
      }
    })();

    return NextResponse.json({
      success: true,
      loraId: lora.id,
      message: `Generating additional body shots for ${character.name}. Poll /lora-progress for status.`,
    });
  } catch (err) {
    console.error("[Generate More API] Failed:", err);
    return NextResponse.json(
      { error: "Failed to start generation", details: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
