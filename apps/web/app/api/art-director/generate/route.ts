import { NextRequest, NextResponse } from "next/server";
import { adaptRecipe, runIteration } from "@/lib/art-director/orchestrator";
import { ensurePodRunning } from "@/lib/art-director/qwen-vl-client";

/**
 * POST /api/art-director/generate
 *
 * Steps 5-6: Adapt recipe and submit first generation.
 * Returns immediately with the job ID — client polls /status for progress.
 */
export async function POST(request: NextRequest) {
  try {
    const { jobId } = await request.json();

    if (!jobId) {
      return NextResponse.json(
        { error: "jobId is required" },
        { status: 400 }
      );
    }

    // Ensure Qwen VL pod is running
    await ensurePodRunning();

    // Step 5: Adapt recipe
    const recipe = await adaptRecipe(jobId);

    // Step 6: Run first iteration (kicks off generation in background)
    // We don't await the full result — the status endpoint handles polling
    runIteration(jobId).catch((err: unknown) => {
      console.error(`[Art Director Generate] Background iteration failed:`, err);
    });

    return NextResponse.json({
      jobId,
      status: "generating",
      recipe: {
        model: recipe.model,
        prompt: recipe.prompt.slice(0, 200),
        steps: recipe.steps,
        cfgScale: recipe.cfgScale,
        dimensions: recipe.dimensions,
      },
    });
  } catch (err) {
    console.error("[Art Director Generate] Failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 500 }
    );
  }
}
