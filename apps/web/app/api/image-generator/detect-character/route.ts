import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `You are analysing an image prompt to determine if it references a named character from a story.
You will be given a list of known characters and their descriptions.
Return a JSON object with this exact shape:
{ "detected_character": "exact character name or null", "confidence": "high | medium | low", "reasoning": "one sentence" }
Only return a name if you are medium or high confidence. Return null if the prompt seems generic or no character matches well.
Return ONLY the JSON object, nothing else.`;

export interface DetectionResult {
  detected_character: string | null;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

// POST /api/image-generator/detect-character
// Body: { prompt: string, characters: Array<{ id, name, description }> }
// Returns: DetectionResult
export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  try {
    const { prompt, characters } = await request.json();

    if (!prompt || !Array.isArray(characters)) {
      return NextResponse.json({ error: "prompt and characters are required" }, { status: 400 });
    }

    const characterList = characters
      .map((c: { name: string; description: string }) => `- ${c.name}: ${c.description}`)
      .join("\n");

    const userMessage = `Known characters:\n${characterList}\n\nPrompt to analyse:\n${prompt.trim()}`;

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text.trim() : "{}";

    let result: DetectionResult;
    try {
      result = JSON.parse(raw);
    } catch {
      result = { detected_character: null, confidence: "low", reasoning: "Parse error" };
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[ImageGenerator] Detect character failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Detection failed" },
      { status: 500 }
    );
  }
}
