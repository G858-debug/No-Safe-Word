import { NextRequest, NextResponse } from "next/server";
import { generateHunyuanImage } from "@no-safe-word/image-gen";

export async function POST(request: NextRequest) {
  if (!process.env.REPLICATE_API_TOKEN) {
    return NextResponse.json({ error: "REPLICATE_API_TOKEN not configured" }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { prompt, aspectRatio = "3:4" } = body;

    if (!prompt?.trim()) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const validRatios = ["1:1", "3:4", "4:3", "9:16", "16:9"];
    if (!validRatios.includes(aspectRatio)) {
      return NextResponse.json({ error: `aspectRatio must be one of: ${validRatios.join(", ")}` }, { status: 400 });
    }

    console.log("[HunyuanStudio] Generating:", { aspectRatio, promptLength: prompt.length });

    const result = await generateHunyuanImage({
      scenePrompt: prompt.trim(),
      aspectRatio,
    });

    console.log("[HunyuanStudio] Generated:", result.imageUrl.slice(0, 80));

    return NextResponse.json({ imageUrl: result.imageUrl, prompt: result.prompt });
  } catch (err) {
    console.error("[HunyuanStudio] Generation failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 500 }
    );
  }
}
