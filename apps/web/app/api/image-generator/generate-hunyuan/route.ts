import { NextRequest, NextResponse } from "next/server";
import { generateSceneImage } from "@no-safe-word/image-gen";

export async function POST(request: NextRequest) {
  if (!process.env.SIRAY_API_KEY) {
    return NextResponse.json({ error: "SIRAY_API_KEY not configured" }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { prompt, aspectRatio = "4:5" } = body;

    if (!prompt?.trim()) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const validRatios = ["1:1", "4:5", "5:4", "9:16", "16:9"];
    if (!validRatios.includes(aspectRatio)) {
      return NextResponse.json({ error: `aspectRatio must be one of: ${validRatios.join(", ")}` }, { status: 400 });
    }

    console.log("[HunyuanStudio] Generating:", { aspectRatio, promptLength: prompt.length });

    const trimmedPrompt = prompt.trim();
    // Studio quick-gen has no character context — empty refs falls back
    // to t2i (the helper logs a warning, which is acceptable here).
    const imageUrl = await generateSceneImage(trimmedPrompt, [], aspectRatio);

    console.log("[HunyuanStudio] Generated:", imageUrl.slice(0, 80));

    return NextResponse.json({ imageUrl, prompt: trimmedPrompt });
  } catch (err) {
    console.error("[HunyuanStudio] Generation failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 500 }
    );
  }
}
