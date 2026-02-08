import { NextRequest, NextResponse } from "next/server";
import { submitGeneration, CivitaiError } from "@/lib/civitai";
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
