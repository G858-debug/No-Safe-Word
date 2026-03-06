import { NextRequest, NextResponse } from "next/server";
import { submitRunPodJob, buildKontextWorkflow } from "@no-safe-word/image-gen";

// POST /api/image-generator/generate
// Body: { prompt: string }
// Returns: { jobId: string }
export async function POST(request: NextRequest) {
  try {
    const { prompt } = await request.json();

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const seed = Math.floor(Math.random() * 2_147_483_647) + 1;

    const workflow = buildKontextWorkflow({
      type: "portrait",
      positivePrompt: prompt.trim(),
      width: 832,
      height: 1216,
      seed,
      filenamePrefix: "imggen_test",
      sfwMode: false,
    });

    const { jobId } = await submitRunPodJob(workflow);

    return NextResponse.json({ jobId });
  } catch (err) {
    console.error("[ImageGenerator] Generate failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 500 }
    );
  }
}
