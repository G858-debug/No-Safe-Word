import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `You are an image prompt specialist for a South African adult romance fiction platform.
Enhance the user's rough prompt into a vivid, cinematic image generation prompt using these five layers:

Expression & Gaze — specify the character's exact expression and eye direction
Narrative Implication — capture a specific moment; something just happened or is about to
Lighting & Atmosphere — name a specific light source (e.g. "single amber streetlight", "bedside lamp glow", "candlelight")
Composition & Framing — specify shot type, camera angle, depth of field
Setting & Cultural Grounding — include specific South African environmental details where relevant

Rules:

Write in flowing prose sentences, not comma-separated tags
End with "Photorealistic."
Do not include character names — describe appearance inline if needed
Do not add LoRA tags, weights, or technical parameters
Return ONLY the enhanced prompt, nothing else`;

// POST /api/image-generator/enhance
// Body: { prompt: string }
// Returns: { enhancedPrompt: string }
export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  try {
    const { prompt } = await request.json();

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt.trim() }],
    });

    const enhancedPrompt =
      message.content[0].type === "text" ? message.content[0].text.trim() : prompt.trim();

    return NextResponse.json({ enhancedPrompt });
  } catch (err) {
    console.error("[ImageGenerator] Enhance failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Enhancement failed" },
      { status: 500 }
    );
  }
}
