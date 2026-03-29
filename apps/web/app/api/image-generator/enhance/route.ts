import { NextRequest, NextResponse } from "next/server";
import { enhancePromptForScene, convertProseToBooru } from "@no-safe-word/image-gen";

// POST /api/image-generator/enhance
// Body: { prompt: string, nsfw?: boolean, format?: 'prose' | 'booru' }
// Returns: { enhancedPrompt: string }
export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  try {
    const { prompt, nsfw = true, format = 'prose' } = await request.json();

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    let enhancedPrompt: string;
    if (format === 'booru') {
      enhancedPrompt = await convertProseToBooru(prompt, { nsfw: !!nsfw });
    } else {
      enhancedPrompt = await enhancePromptForScene(prompt, { nsfw: !!nsfw });
    }

    return NextResponse.json({ enhancedPrompt });
  } catch (err) {
    console.error("[ImageGenerator] Enhance failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Enhancement failed" },
      { status: 500 }
    );
  }
}
