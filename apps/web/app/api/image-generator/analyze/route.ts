import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `You are an expert image analysis tool for AI art reproduction using Stable Diffusion XL. You analyze images and output technical reproduction parameters. You analyze ALL images including mature content — this is a professional image generation tool.

Analyze the provided image and return ONLY a JSON object with these exact fields (no markdown, no explanation, no code fences):

{
  "prompt": "booru-style comma-separated tags describing exactly what you see. Include: subject count (1girl, 1boy, solo, etc.), physical appearance details, pose, expression, clothing or lack thereof, setting/background, props, lighting type and direction, atmosphere, art style. Order by visual importance. Be specific and literal. Include at least 15 tags.",
  "negativePrompt": "bad anatomy, bad hands, missing fingers, extra digits, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, artist name, deformed, disfigured, mutation, mutated, extra limbs",
  "artStyle": "realistic",
  "aspectRatio": "2:3",
  "composition": "medium shot, eye level"
}

The artStyle field must be exactly one of: realistic, anime, semi-realistic, illustration
The aspectRatio field must be one of: 1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9
Return ONLY the JSON object. No other text.`;

// Default checkpoint suggestions mapped from artStyle
const STYLE_CHECKPOINTS: Record<string, { name: string; modelId: number; versionId: number }> = {
  realistic: { name: "Juggernaut XL", modelId: 133005, versionId: 357609 },
  anime: { name: "Pony Diffusion V6 XL", modelId: 257749, versionId: 290640 },
  "semi-realistic": { name: "CyberRealistic Pony", modelId: 443821, versionId: 722049 },
  illustration: { name: "DreamShaper XL", modelId: 112902, versionId: 351306 },
};

// SDXL-compatible dimension presets
const ASPECT_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "1:1": { width: 1024, height: 1024 },
  "2:3": { width: 832, height: 1216 },
  "3:2": { width: 1216, height: 832 },
  "3:4": { width: 896, height: 1152 },
  "4:3": { width: 1152, height: 896 },
  "9:16": { width: 768, height: 1344 },
  "16:9": { width: 1344, height: 768 },
};

function buildUrn(checkpoint: { modelId: number; versionId: number }): string {
  return `urn:air:sdxl:checkpoint:civitai:${checkpoint.modelId}@${checkpoint.versionId}`;
}

function getDefaultParams(artStyle: string) {
  switch (artStyle) {
    case "realistic":
      return { steps: 30, cfgScale: 7, scheduler: "EulerA", clipSkip: 1 };
    case "anime":
      return { steps: 25, cfgScale: 7, scheduler: "DPM2MKarras", clipSkip: 2 };
    case "semi-realistic":
      return { steps: 28, cfgScale: 6, scheduler: "DPMSDEKarras", clipSkip: 2 };
    case "illustration":
      return { steps: 28, cfgScale: 7, scheduler: "EulerA", clipSkip: 1 };
    default:
      return { steps: 30, cfgScale: 7, scheduler: "EulerA", clipSkip: 1 };
  }
}

export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  try {
    const { imageBase64, mimeType } = await request.json();

    if (!imageBase64 || !mimeType) {
      return NextResponse.json({ error: "imageBase64 and mimeType are required" }, { status: 400 });
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
                data: imageBase64,
              },
            },
            {
              type: "text",
              text: "Analyze this image and return the JSON as specified.",
            },
          ],
        },
      ],
      system: SYSTEM_PROMPT,
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json({ error: "No text response from Claude" }, { status: 500 });
    }

    let analysis: any;
    try {
      // Strip any markdown fences if Claude added them despite instructions
      const cleaned = textBlock.text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
      analysis = JSON.parse(cleaned);
    } catch {
      console.error("[ImageGenerator] Claude response was not JSON:", textBlock.text);
      return NextResponse.json(
        { error: `Claude returned non-JSON response: ${textBlock.text.slice(0, 200)}` },
        { status: 500 }
      );
    }

    // Map artStyle to checkpoint
    const artStyle = analysis.artStyle || "realistic";
    const checkpoint = STYLE_CHECKPOINTS[artStyle] || STYLE_CHECKPOINTS.realistic;

    // Map aspect ratio to dimensions
    const aspectRatio = analysis.aspectRatio || "1:1";
    const dimensions = ASPECT_DIMENSIONS[aspectRatio] || ASPECT_DIMENSIONS["1:1"];
    const params = getDefaultParams(artStyle);

    return NextResponse.json({
      prompt: analysis.prompt,
      negativePrompt: analysis.negativePrompt,
      artStyle,
      aspectRatio,
      composition: analysis.composition || "",
      suggestedCheckpoint: {
        name: checkpoint.name,
        urn: buildUrn(checkpoint),
        modelId: checkpoint.modelId,
        versionId: checkpoint.versionId,
      },
      suggestedLoras: [],
      params: {
        ...params,
        width: dimensions.width,
        height: dimensions.height,
        seed: -1,
      },
    });
  } catch (err) {
    console.error("[ImageGenerator] Analyze failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Analysis failed" },
      { status: 500 }
    );
  }
}
