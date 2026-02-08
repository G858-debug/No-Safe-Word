import { NextRequest, NextResponse } from "next/server";
import { submitGeneration, CivitaiError } from "@/lib/civitai";
import { supabase } from "@/lib/supabase";
import { buildPrompt, buildNegativePrompt } from "@/lib/prompt-builder";
import type { CharacterData, SceneData, GenerationSettings } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { character, scene, settings } = body as {
      character: CharacterData;
      scene: SceneData;
      settings: GenerationSettings;
    };

    if (!character || !scene || !settings) {
      return NextResponse.json(
        { error: "Missing required fields: character, scene, settings" },
        { status: 400 }
      );
    }

    if (!settings.modelUrn) {
      return NextResponse.json(
        { error: "Missing model selection" },
        { status: 400 }
      );
    }

    const result = await submitGeneration(character, scene, settings);

    // Persist to Supabase (best-effort — don't block the response)
    try {
      const prompt = buildPrompt(character, scene);
      const negativePrompt = buildNegativePrompt(scene);

      const { data: imageRow } = await supabase
        .from("images")
        .insert({
          prompt,
          negative_prompt: negativePrompt,
          settings: {
            modelUrn: settings.modelUrn,
            width: settings.width,
            height: settings.height,
            steps: settings.steps,
            cfgScale: settings.cfgScale,
            scheduler: settings.scheduler,
            seed: settings.seed,
            clipSkip: settings.clipSkip,
            batchSize: settings.batchSize,
          },
          mode: scene.mode,
        })
        .select("id")
        .single();

      if (imageRow && result.jobs) {
        const jobRows = result.jobs.map((job) => ({
          job_id: job.jobId,
          image_id: imageRow.id,
          status: "pending" as const,
          cost: job.cost,
        }));
        await supabase.from("generation_jobs").insert(jobRows);
      }
    } catch {
      console.warn("Failed to persist generation to Supabase");
    }

    return NextResponse.json({
      token: result.token,
      jobs: result.jobs.map((job) => ({
        jobId: job.jobId,
        cost: job.cost,
        scheduled: job.scheduled,
      })),
    });
  } catch (err) {
    if (err instanceof CivitaiError) {
      return NextResponse.json(
        { error: err.message, details: err.details },
        { status: err.status }
      );
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
