import { NextRequest, NextResponse } from "next/server";
import { enhancePromptForScene } from "@no-safe-word/image-gen";

// POST /api/image-generator/enhance
// Body: { prompt: string, nsfw?: boolean }
// Returns: { enhancedPrompt: string }
export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  try {
    const { prompt, nsfw = true } = await request.json();

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const enhancedPrompt = await enhancePromptForScene(prompt, { nsfw: !!nsfw });

    return NextResponse.json({ enhancedPrompt });
  } catch (err) {
    console.error("[ImageGenerator] Enhance failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Enhancement failed" },
      { status: 500 }
    );
  }
}
