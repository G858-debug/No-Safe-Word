import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@no-safe-word/story-engine";
import {
  buildTopUpPrompts,
  buildDatasetWorkflow,
  buildWorkflow,
  buildNegativePrompt,
  submitRunPodJob,
  waitForRunPodResult,
  imageUrlToBase64,
  anthropicCreateWithRetry,
} from "@no-safe-word/image-gen";
import type { CharacterInput, CharacterStructured } from "@no-safe-word/image-gen";

const MIN_EVAL_SCORE = 6;

// POST /api/stories/characters/[storyCharId]/dataset-images/[imageId]/regenerate
// Regenerates a single dataset image in-place. Synchronous — runs generation + evaluation,
// updates the DB record, and returns { image: updatedRecord, seed: number }.
// Body (all optional): { customPrompt, customNegativePrompt, seed, loraStrengths: { bodyWeight, bubbleButt, breastSize } }
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string; imageId: string }> }
) {
  const { storyCharId, imageId } = await props.params;
  const body = await request.json().catch(() => ({}));
  const customPrompt: string | undefined = body.customPrompt;
  const customNegativePrompt: string | undefined = body.customNegativePrompt;
  const fixedSeed: number | undefined = typeof body.seed === "number" ? body.seed : undefined;
  const loraStrengths: { bodyWeight?: number; bubbleButt?: number; breastSize?: number } | undefined = body.loraStrengths;

  const endpointId = process.env.RUNPOD_ENDPOINT_ID;
  if (!endpointId) {
    return NextResponse.json({ error: "Missing RUNPOD_ENDPOINT_ID" }, { status: 500 });
  }

  try {
    // 1. Fetch story character
    const { data: storyChar, error: scError } = await (supabase as any)
      .from("story_characters")
      .select(`id, character_id, approved_seed, face_url, characters ( id, name, description )`)
      .eq("id", storyCharId)
      .single() as { data: any; error: any };

    if (scError || !storyChar) {
      return NextResponse.json({ error: "Story character not found" }, { status: 404 });
    }

    // 2. Fetch the image record to regenerate
    const { data: existingImage, error: imgError } = await supabase
      .from("lora_dataset_images")
      .select("id, lora_id, category, prompt_template, storage_path")
      .eq("id", imageId)
      .single();

    if (imgError || !existingImage) {
      return NextResponse.json({ error: "Dataset image not found" }, { status: 404 });
    }

    const character = storyChar.characters as { id: string; name: string; description: Record<string, string> };
    const approvedImageUrl: string | null = storyChar.face_url || null;
    const desc = character.description as Record<string, string>;

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
    };

    // 3. Build the generation workflow
    const seed = fixedSeed ?? (Math.floor(Math.random() * 2_147_483_647) + 1);
    const dims = existingImage.category === "face-closeup"
      ? { width: 1024, height: 1024 }
      : { width: 832, height: 1216 };

    // Body LoRA stack — from UI overrides if provided, else from character description
    const isFemale = desc.gender !== "male";
    const needsBodyLoRA = isFemale &&
      (existingImage.category === "full-body" || existingImage.category === "waist-up");
    const bodyLoras: Array<{ filename: string; strengthModel: number; strengthClip: number }> = [];
    if (needsBodyLoRA) {
      const bw = loraStrengths?.bodyWeight ?? parseFloat(desc.loraBodyWeight || "0");
      const bb = loraStrengths?.bubbleButt ?? parseFloat(desc.loraBubbleButt || "0");
      const bs = loraStrengths?.breastSize ?? parseFloat(desc.loraBreastSize || "0");
      if (bw > 0) bodyLoras.push({ filename: "Body_weight_slider_ILXL.safetensors", strengthModel: bw, strengthClip: 1.0 });
      if (bb > 0) bodyLoras.push({ filename: "Bubble Butt_alpha1.0_rank4_noxattn_last.safetensors", strengthModel: bb, strengthClip: 1.0 });
      if (bs > 0) bodyLoras.push({ filename: "Breast Slider - SDXL_alpha1.0_rank4_noxattn_last.safetensors", strengthModel: bs, strengthClip: 1.0 });
    }

    let workflow: Record<string, unknown>;

    if (customPrompt) {
      // User-supplied prompt
      workflow = buildWorkflow({
        positivePrompt: customPrompt,
        negativePrompt: customNegativePrompt ?? buildNegativePrompt("sfw"),
        ...dims,
        seed,
        filenamePrefix: `regen_${imageId}`,
        loras: bodyLoras.length > 0 ? bodyLoras : undefined,
      });
    } else {
      // Build a fresh prompt for this category
      const [prompt] = buildTopUpPrompts(datasetChar, [{ category: existingImage.category, needed: 1 }]);
      if (!prompt) {
        return NextResponse.json({ error: `No prompt template for category: ${existingImage.category}` }, { status: 400 });
      }
      if (customNegativePrompt || bodyLoras.length > 0) {
        // Use buildWorkflow directly so we can apply overrides
        const built = buildDatasetWorkflow({ character: datasetChar, prompt, seed });
        workflow = buildWorkflow({
          positivePrompt: built.positivePrompt,
          negativePrompt: customNegativePrompt ?? built.negativePrompt,
          ...dims,
          seed,
          filenamePrefix: `regen_${imageId}`,
          loras: bodyLoras.length > 0 ? bodyLoras : undefined,
        });
      } else {
        const built = buildDatasetWorkflow({ character: datasetChar, prompt, seed });
        workflow = built.workflow;
      }
    }

    // 4. Generate via RunPod
    const { jobId } = await submitRunPodJob(workflow, undefined, undefined, endpointId);
    const { imageBase64 } = await waitForRunPodResult(jobId, 300000, 3000, endpointId);

    // 5. Upload to storage (reuse same path to replace old file)
    const storagePath = existingImage.storage_path || `lora-datasets/${existingImage.lora_id}/regen_${imageId}.png`;
    const imageBuffer = Buffer.from(imageBase64, "base64");

    const { error: uploadError } = await supabase.storage
      .from("story-images")
      .upload(storagePath, imageBuffer, { contentType: "image/png", upsert: true });

    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

    const { data: urlData } = supabase.storage
      .from("story-images")
      .getPublicUrl(storagePath);

    const newImageUrl = urlData.publicUrl;

    // 6. Evaluate with Claude Vision
    const anthropic = new Anthropic();
    let evalScore = 0;
    let evalDetails: Record<string, unknown> = { verdict: "FAIL", issues: ["Evaluation failed"] };
    let evalStatus: "passed" | "failed" = "failed";

    try {
      const content: Anthropic.MessageCreateParams["messages"][0]["content"] = [];

      // Include reference portrait if available
      if (approvedImageUrl) {
        try {
          const refBase64 = await imageUrlToBase64(approvedImageUrl);
          content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: refBase64 } });
          content.push({ type: "text", text: "Reference image (approved portrait) above." });
        } catch { /* non-fatal */ }
      }

      const newBase64 = await imageUrlToBase64(newImageUrl);
      content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: newBase64 } });

      const bodyStyleNote = structuredData.gender === "female"
        ? `IMPORTANT: This character is intentionally designed with exaggerated curvy proportions (very large breasts, very wide hips, narrow waist, full thighs). This is the intended art style — do NOT flag these as anatomy errors or incorrect proportions.`
        : `IMPORTANT: This character's body proportions are intentionally stylized — do NOT flag muscular or exaggerated builds as anatomy errors.`;

      content.push({
        type: "text",
        text: `Evaluate this training image for a character LoRA dataset. The character is a ${structuredData.gender}, ${structuredData.ethnicity}, ${structuredData.age} years old, ${structuredData.skinTone} skin.

${bodyStyleNote}

Note on skin tone: Only flag "correctSkinTone" as false if the skin tone is COMPLETELY wrong, not for minor lighting-caused shifts.

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "requirements": { "faceVisible": boolean, "correctSkinTone": boolean, "noAnatomyErrors": boolean, "correctBodyProportions": boolean, "imageSharp": boolean },
  "quality": { "expressionNatural": 0-10, "poseNatural": 0-10, "lightingQuality": 0-10, "backgroundClean": 0-10, "hairAccurate": 0-10, "skinToneConsistency": 0-10, "overallAesthetic": 0-10 },
  "issues": ["list of specific problems"]
}`,
      });

      const response = await anthropicCreateWithRetry(anthropic, {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        messages: [{ role: "user", content }],
      });

      const text = response.content[0].type === "text" ? response.content[0].text : "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const q = parsed.quality || {};
        const skinToneScore = q.skinToneConsistency ?? 7;
        const proportionsPenalty = parsed.requirements?.correctBodyProportions === false ? -0.5 : 0;
        const skinTonePenalty = parsed.requirements?.correctSkinTone === false ? -1.0 : 0;

        const rawScore = (
          (q.expressionNatural || 0) * 1.5 +
          (q.poseNatural || 0) * 1.2 +
          (q.lightingQuality || 0) * 1.0 +
          (q.backgroundClean || 0) * 0.8 +
          (q.hairAccurate || 0) * 1.0 +
          skinToneScore * 0.6 +
          (q.overallAesthetic || 0) * 1.5
        ) / (1.5 + 1.2 + 1.0 + 0.8 + 1.0 + 0.6 + 1.5) + skinTonePenalty + proportionsPenalty;

        evalScore = Math.round(rawScore * 10) / 10;
        const passed = evalScore >= MIN_EVAL_SCORE;
        evalStatus = passed ? "passed" : "failed";
        evalDetails = {
          face_score: q.expressionNatural,
          body_score: q.poseNatural,
          quality_score: evalScore,
          verdict: passed ? "PASS" : "FAIL",
          issues: parsed.issues || [],
          proportions_realistic: parsed.requirements?.correctBodyProportions,
        };
      }
    } catch (evalErr) {
      console.warn(`[Regenerate] Evaluation failed for ${imageId}: ${evalErr}`);
      // Keep the image but mark as failed with eval error
    }

    // 7. Update the existing DB record in-place
    const { data: updatedImage, error: updateError } = await supabase
      .from("lora_dataset_images")
      .update({
        image_url: newImageUrl,
        storage_path: storagePath,
        eval_status: evalStatus,
        eval_score: evalScore,
        eval_details: evalDetails,
        human_approved: null, // Reset human approval since it's a new image
        caption: null,
      })
      .eq("id", imageId)
      .select()
      .single();

    if (updateError || !updatedImage) {
      throw new Error(`Failed to update image record: ${updateError?.message}`);
    }

    console.log(`[Regenerate] ${imageId}: ${evalStatus} (score ${evalScore})`);

    // Return the legacy synchronous format — client handles this directly
    return NextResponse.json({ image: updatedImage, seed });
  } catch (err) {
    console.error("[Regenerate] Failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Regeneration failed" },
      { status: 500 }
    );
  }
}
