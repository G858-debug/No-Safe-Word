import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import {
  buildSdxlWorkflow,
  submitRunPodJob,
  resolvePromptEthnicity,
} from "@no-safe-word/image-gen";
import type { CharacterData } from "@no-safe-word/shared";

type ImageType = "portrait" | "fullBody";

/** Case-insensitive check for Black/African ethnicity */
function isBlackAfrican(ethnicity: string): boolean {
  const lower = ethnicity.toLowerCase();
  return lower.includes('black') || lower.includes('african') || lower.includes('dark');
}

// POST /api/stories/characters/[storyCharId]/generate — Generate a character portrait or full body
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    // Parse optional seed, type, and customPrompt from request body
    let customSeed: number | undefined;
    let imageType: ImageType = "portrait";
    let customPrompt: string | undefined;
    try {
      const body = await request.json();
      if (typeof body.seed === "number" && body.seed > 0) {
        customSeed = body.seed;
      }
      if (body.type === "fullBody") {
        imageType = "fullBody";
      }
      if (typeof body.customPrompt === 'string' && body.customPrompt.trim().length > 20) {
        customPrompt = body.customPrompt.trim();
      }
    } catch {
      // No body or invalid JSON — use defaults
    }

    console.log(`[StoryPublisher] Generating ${imageType} (RealVisXL SDXL) for storyCharId: ${storyCharId}`);

    // 1. Fetch the story_character row
    const { data: storyChar, error: scError } = await supabase
      .from("story_characters")
      .select("id, character_id")
      .eq("id", storyCharId)
      .single();

    if (scError || !storyChar) {
      console.error(`[StoryPublisher] Story character not found: ${storyCharId}`, scError);
      return NextResponse.json(
        { error: "Story character not found" },
        { status: 404 }
      );
    }

    // 2. Fetch the character's structured description
    const { data: character, error: charError } = await supabase
      .from("characters")
      .select("id, name, description")
      .eq("id", storyChar.character_id)
      .single();

    if (charError || !character) {
      console.error(`[StoryPublisher] Character not found: ${storyChar.character_id}`, charError);
      return NextResponse.json(
        { error: "Character not found" },
        { status: 404 }
      );
    }

    console.log(`[StoryPublisher] Generating for character: ${character.name} (${character.id})`);

    // 3. Build CharacterData from the stored description JSON
    const desc = character.description as Record<string, string>;
    const characterData: CharacterData = {
      name: character.name,
      gender: (['male', 'female', 'non-binary', 'other'].includes(desc.gender) ? desc.gender as CharacterData["gender"] : 'female') as CharacterData["gender"],
      ethnicity: desc.ethnicity || "",
      bodyType: desc.bodyType || "",
      hairColor: desc.hairColor || "",
      hairStyle: desc.hairStyle || "",
      eyeColor: desc.eyeColor || "",
      skinTone: desc.skinTone || "",
      distinguishingFeatures: desc.distinguishingFeatures || "",
      clothing: desc.clothing || "",
      pose: desc.pose || "",
      expression: desc.expression || "",
      age: desc.age || "",
    };

    const seed = customSeed || Math.floor(Math.random() * 2_147_483_647) + 1;
    const sluggedName = character.name.replace(/\s+/g, "_").toLowerCase();
    const isFemale = characterData.gender !== 'male';
    const useMelanin = isBlackAfrican(characterData.ethnicity);

    // Normalize ethnicity label for the prompt — AI-classifies Black/African descent
    // and replaces with "African American" for better RealVisXL photorealism.
    const resolvedEthnicity = await resolvePromptEthnicity(
      characterData.ethnicity,
      characterData.gender,
      characterData.skinTone,
    );

    let positivePrompt: string;
    let negativePrompt: string;
    let width: number;
    let height: number;
    let loras: Array<{ filename: string; strengthModel: number; strengthClip: number }> = [];

    if (imageType === "portrait") {
      // PATH A — Face portrait with RealVisXL + Melanin LoRA + Skin LoRAs (Black/African)
      width = 832;
      height = 1216;

      const melaninTrigger = useMelanin ? 'melanin, ' : '';
      const skinToneTrigger = useMelanin ? 'dark chocolate skin tone style, ' : '';
      const skinRealismTrigger = useMelanin ? 'Detailed natural skin and blemishes without-makeup and acne, ' : '';
      positivePrompt = `${melaninTrigger}${skinToneTrigger}${skinRealismTrigger}photorealistic portrait of a ${characterData.age}-year-old ${resolvedEthnicity} ${isFemale ? 'woman' : 'man'}, ${characterData.skinTone} skin, ${characterData.hairStyle} ${characterData.hairColor} hair, ${characterData.eyeColor} eyes, ${characterData.distinguishingFeatures}, close-up head and shoulders, looking directly at the camera with a confident expression, soft studio lighting, neutral gray background, 8k, masterpiece, best quality, highly detailed`;

      negativePrompt = `deformed, bad anatomy, extra limbs, (worst quality:2), (low quality:2), blurry, watermark, asian features, european features, pale skin, white skin, light skin, caucasian`;

      if (useMelanin) {
        loras.push({ filename: 'melanin-XL.safetensors', strengthModel: 0.5, strengthClip: 0.5 });
        loras.push({ filename: 'sdxl-skin-tone-xl.safetensors', strengthModel: 0.6, strengthClip: 0.6 });
        loras.push({ filename: 'sdxl-skin-realism.safetensors', strengthModel: 0.4, strengthClip: 0.4 });
      }
    } else {
      // PATH B — Full body with RealVisXL + Venus Body LoRA + Melanin LoRA
      width = 768;
      height = 1152;

      if (isFemale) {
        const venusPrefix = 'venusbody, ';
        const melaninPrefix = useMelanin ? 'melanin, ' : '';
        const skinTonePrefix = useMelanin ? 'dark chocolate skin tone style, ' : '';
        const skinRealismPrefix = useMelanin ? 'Detailed natural skin and blemishes without-makeup and acne, ' : '';
        positivePrompt = `${venusPrefix}${melaninPrefix}${skinTonePrefix}${skinRealismPrefix}photorealistic full body photo of a ${characterData.age}-year-old ${resolvedEthnicity} woman, ${characterData.skinTone} skin, curvaceous figure with large breasts wide hips and thick thighs small waist, ${characterData.hairStyle} ${characterData.hairColor} hair, wearing a form-fitting outfit, full body visible head to toe, standing, studio lighting, neutral gray background, 8k, masterpiece, best quality`;

        loras.push({ filename: 'venus-body-xl.safetensors', strengthModel: 0.75, strengthClip: 0.75 });
        if (useMelanin) {
          loras.push({ filename: 'melanin-XL.safetensors', strengthModel: 0.5, strengthClip: 0.5 });
          loras.push({ filename: 'sdxl-skin-tone-xl.safetensors', strengthModel: 0.6, strengthClip: 0.6 });
          loras.push({ filename: 'sdxl-skin-realism.safetensors', strengthModel: 0.4, strengthClip: 0.4 });
        }
      } else {
        positivePrompt = `photorealistic full body photo of a ${characterData.age}-year-old ${resolvedEthnicity} man, ${characterData.skinTone} skin, ${characterData.bodyType || 'athletic build'}, ${characterData.hairStyle} ${characterData.hairColor} hair, wearing casual clothing, full body visible head to toe, standing, studio lighting, neutral gray background, 8k, masterpiece, best quality`;
      }

      negativePrompt = `skinny, thin, flat chest, small breasts, narrow hips, deformed, bad anatomy, extra limbs, (worst quality:2), (low quality:2), white skin, pale skin, asian features, european features`;
    }

    if (customPrompt) {
      // User has provided a custom prompt — use it directly.
      // Still ensure LoRA trigger words are prepended if not already present.
      positivePrompt = customPrompt;
      if (useMelanin && !/\bmelanin\b/i.test(positivePrompt)) {
        positivePrompt = `melanin, ${positivePrompt}`;
      }
      if (useMelanin && !/dark chocolate skin tone style/i.test(positivePrompt)) {
        positivePrompt = `dark chocolate skin tone style, ${positivePrompt}`;
      }
      if (useMelanin && !/Detailed natural skin/i.test(positivePrompt)) {
        positivePrompt = `Detailed natural skin and blemishes without-makeup and acne, ${positivePrompt}`;
      }
      if (imageType === 'fullBody' && isFemale && !/\bvenusbody\b/i.test(positivePrompt)) {
        positivePrompt = `venusbody, ${positivePrompt}`;
      }
    }

    console.log(`[StoryPublisher] Prompt source: ${customPrompt ? 'custom override' : 'auto-built from description'}`);
    console.log(`[StoryPublisher] SDXL positive prompt: ${positivePrompt.substring(0, 100)}...`);
    console.log(`[StoryPublisher] LoRAs: ${loras.length > 0 ? loras.map(l => l.filename).join(", ") : "NONE"}`);
    console.log(`[StoryPublisher] Seed: ${seed}`);

    // 4. Build SDXL workflow
    const workflow = buildSdxlWorkflow({
      positivePrompt,
      negativePrompt,
      width,
      height,
      seed,
      checkpointName: 'realvisxlV50_v50Bakedvae.safetensors',
      loras,
      filenamePrefix: `${imageType === "fullBody" ? "fullbody" : "portrait"}_${sluggedName}`,
    });

    // Submit async job to RunPod (returns immediately)
    const { jobId } = await submitRunPodJob(workflow);

    // Create image record (stored_url will be set when status polling completes)
    const { data: imageRow, error: imgError } = await supabase
      .from("images")
      .insert({
        character_id: character.id,
        prompt: positivePrompt,
        settings: {
          width,
          height,
          engine: "sdxl-realvis",
          imageType,
          seed,
        },
        mode: "sfw",
      })
      .select("id")
      .single();

    if (imgError || !imageRow) {
      throw new Error(`Failed to create image record: ${imgError?.message}`);
    }

    // Create generation job record for status polling
    await supabase.from("generation_jobs").insert({
      job_id: `runpod-${jobId}`,
      image_id: imageRow.id,
      status: "pending",
      cost: 0,
    });

    console.log(`[StoryPublisher] ${imageType === "fullBody" ? "Full body" : "Portrait"} job submitted: runpod-${jobId}, imageId: ${imageRow.id}`);

    return NextResponse.json({
      jobId: `runpod-${jobId}`,
      imageId: imageRow.id,
    });
  } catch (err) {
    console.error("Character portrait generation failed:", err);
    return NextResponse.json(
      {
        error: "Generation failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
