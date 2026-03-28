import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { submitRunPodJob, buildKontextWorkflow } from "@no-safe-word/image-gen";
import type { CharacterLoraDownload } from "@no-safe-word/image-gen";

// POST /api/image-generator/generate
// Body: { prompt: string, characterId?: string }
// Returns: { jobId: string }
export async function POST(request: NextRequest) {
  try {
    const { prompt, characterId } = await request.json();

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const seed = Math.floor(Math.random() * 2_147_483_647) + 1;
    let finalPrompt = prompt.trim();

    // Base LoRAs always included — realism + detail
    const loras: Array<{ filename: string; strengthModel: number; strengthClip: number }> = [
      { filename: "flux_realism_lora.safetensors", strengthModel: 0.8, strengthClip: 0.8 },
      { filename: "flux-add-details.safetensors", strengthModel: 0.6, strengthClip: 0.6 },
    ];

    // Body LoRAs for female subjects — same NSFW strengths as the story pipeline
    const isFemalePrompt = /\b(woman|female|she|her|girl|lady)\b/i.test(finalPrompt);
    if (isFemalePrompt) {
      loras.push({ filename: "fc-flux-perfect-busts.safetensors", strengthModel: 0.85, strengthClip: 0.85 });
      loras.push({ filename: "hourglassv32_FLUX.safetensors", strengthModel: 0.95, strengthClip: 0.95 });
      // Inject trigger word required by the busts LoRA
      if (!/\bwoman\b/i.test(finalPrompt)) {
        finalPrompt = `woman, ${finalPrompt}`;
      }
    }

    const characterLoraDownloads: CharacterLoraDownload[] = [];

    // If a character is selected, fetch their deployed LoRA and inject it
    if (characterId) {
      const { data: loraRow } = await (supabase as any)
        .from("character_loras")
        .select("filename, storage_url, trigger_word")
        .eq("character_id", characterId)
        .eq("status", "deployed")
        .order("deployed_at", { ascending: false })
        .limit(1)
        .single();

      if (loraRow?.filename && loraRow?.storage_url) {
        const loraFilename = `characters/${loraRow.filename}`;
        loras.push({ filename: loraFilename, strengthModel: 0.8, strengthClip: 0.8 });

        characterLoraDownloads.push({
          filename: loraFilename,
          url: loraRow.storage_url,
        });

        // Inject trigger word if present and not already in prompt
        if (loraRow.trigger_word && loraRow.trigger_word !== "tok") {
          const trigger = loraRow.trigger_word as string;
          if (!new RegExp(`\\b${trigger}\\b`, "i").test(finalPrompt)) {
            finalPrompt = `${trigger}, ${finalPrompt}`;
          }
        }
      }
    }

    const workflow = buildKontextWorkflow({
      type: "portrait",
      positivePrompt: finalPrompt,
      width: 960,
      height: 1280,
      seed,
      filenamePrefix: "imggen_test",
      loras,
    });

    const { jobId } = await submitRunPodJob(
      workflow,
      undefined,
      characterLoraDownloads.length > 0 ? characterLoraDownloads : undefined
    );

    return NextResponse.json({ jobId });
  } catch (err) {
    console.error("[ImageGenerator] Generate failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 500 }
    );
  }
}
