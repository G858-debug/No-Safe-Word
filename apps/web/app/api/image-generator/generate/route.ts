import { NextRequest, NextResponse } from "next/server";
import { Civitai, ApiError } from "civitai";
import type { Scheduler } from "civitai";

export async function POST(request: NextRequest) {
  const token = process.env.CIVITAI_API_KEY;
  if (!token) {
    return NextResponse.json({ error: "CIVITAI_API_KEY not configured" }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { model, prompt, negativePrompt, params, additionalNetworks, quantity } = body;

    if (!model || !prompt || !params?.width || !params?.height) {
      return NextResponse.json({ error: "model, prompt, and params (width, height) are required" }, { status: 400 });
    }

    const payload = {
      model,
      params: {
        prompt,
        negativePrompt: negativePrompt || "",
        scheduler: (params.scheduler || "EulerA") as Scheduler,
        steps: params.steps || 30,
        cfgScale: params.cfgScale || 7,
        width: params.width,
        height: params.height,
        seed: params.seed ?? -1,
        clipSkip: params.clipSkip || 1,
      },
      additionalNetworks: additionalNetworks || undefined,
      quantity: quantity || 1,
    };

    console.log("[ImageGenerator] Submitting to CivitAI:", JSON.stringify(payload, null, 2));

    const civitai = new Civitai({ auth: token });
    const result = await civitai.image.fromText(payload, false);

    const jobResult = result as { token?: string; jobs?: any[] };
    if (!jobResult.token) {
      console.error("[ImageGenerator] No token in CivitAI response:", result);
      return NextResponse.json({ error: "No job token returned from CivitAI" }, { status: 500 });
    }

    return NextResponse.json({ token: jobResult.token, jobs: jobResult.jobs || [] });
  } catch (err) {
    if (err instanceof ApiError) {
      console.error("[ImageGenerator] CivitAI ApiError:", err.status, err.statusText, err.body);
      return NextResponse.json(
        { error: `CivitAI error ${err.status}: ${JSON.stringify(err.body)}` },
        { status: 500 }
      );
    }
    console.error("[ImageGenerator] Generate failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 500 }
    );
  }
}
