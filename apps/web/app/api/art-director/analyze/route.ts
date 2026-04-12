import { NextRequest, NextResponse } from "next/server";
import { analyzeAndSearch } from "@/lib/art-director/orchestrator";
import { ensurePodRunning } from "@/lib/art-director/qwen-vl-client";

/**
 * POST /api/art-director/analyze
 *
 * Steps 1-3: Analyze prompt intent, search CivitAI, rank references.
 * Runs synchronously (~30-60s) because the user needs to see references.
 */
export async function POST(request: NextRequest) {
  try {
    const { promptId, promptText, imageType, characterNames, seriesId } =
      await request.json();

    if (!promptId || !promptText || !seriesId) {
      return NextResponse.json(
        { error: "promptId, promptText, and seriesId are required" },
        { status: 400 }
      );
    }

    // Ensure Qwen VL pod is running
    await ensurePodRunning();

    const result = await analyzeAndSearch(
      promptText,
      imageType || "website_nsfw_paired",
      characterNames || [],
      seriesId,
      promptId
    );

    return NextResponse.json({
      jobId: result.jobId,
      intentAnalysis: result.intentAnalysis,
      references: result.rankedReferences,
    });
  } catch (err) {
    console.error("[Art Director Analyze] Failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Analysis failed" },
      { status: 500 }
    );
  }
}
