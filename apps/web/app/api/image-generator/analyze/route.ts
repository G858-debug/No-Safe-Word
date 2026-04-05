import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `You are an expert at analyzing images for AI image reproduction using Stable Diffusion XL.

Analyze the provided image and return a JSON object with these fields:

{
  "prompt": "booru-style comma-separated tags describing what you see. Include: subject count (1girl, 1boy, solo, etc.), physical appearance, pose, expression, clothing details, setting/background, props, lighting type and direction, atmosphere, art style. Order by visual importance - most prominent elements first. Be specific: 'warm side lighting from window' not 'good lighting'. Include at least 15 tags.",

  "negativePrompt": "bad anatomy, bad hands, missing fingers, extra digits, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, artist name, deformed, disfigured, mutation, mutated, extra limbs",

  "artStyle": "realistic | anime | semi-realistic | illustration",

  "aspectRatio": "W:H ratio like 2:3, 1:1, 16:9, 3:4",

  "composition": "brief description of framing and camera angle"
}

Rules:
- Return ONLY valid JSON, no markdown code fences
- For artStyle, choose the single best match
- Prompt should be reproduction-focused: describe what IS in the image, not what you want
- Be specific about clothing, pose, and setting details
- Include color information where visually important`;

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

    const analysis = JSON.parse(textBlock.text);

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
