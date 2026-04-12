import { NextRequest, NextResponse } from "next/server";
import {
  createQwenVLPod,
  getPodStatus,
  startPod,
  stopPod,
  getPodEndpoint,
} from "@/lib/art-director/pod-manager";
import { healthCheck } from "@/lib/art-director/qwen-vl-client";

export async function GET() {
  const podId = process.env.QWEN_VL_POD_ID;

  if (!podId) {
    return NextResponse.json({
      podId: null,
      status: "none",
      message: "No QWEN_VL_POD_ID configured. Create a pod first.",
    });
  }

  try {
    const podInfo = await getPodStatus(podId);

    // If pod is running, also check vLLM health (with a short timeout to avoid blocking)
    let modelStatus: "ok" | "loading" | "unreachable" = "unreachable";
    if (podInfo.running) {
      try {
        const health = await Promise.race([
          healthCheck(),
          new Promise((resolve) =>
            setTimeout(() => resolve({ status: "unreachable", modelLoaded: false }), 8000)
          ),
        ]) as { status: "ok" | "loading" | "unreachable"; modelLoaded: boolean };
        modelStatus = health.status;
      } catch {
        modelStatus = "unreachable";
      }
    }

    return NextResponse.json({
      podId: podInfo.id,
      status: podInfo.running ? "running" : podInfo.desiredStatus.toLowerCase(),
      modelStatus,
      endpoint: podInfo.endpoint,
      uptimeSeconds: podInfo.uptimeSeconds,
      gpu: podInfo.gpuDisplayName,
    });
  } catch (err) {
    console.error("[Art Director Pod] Status check failed:", err);
    return NextResponse.json(
      { podId, status: "error", error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { action } = await request.json();

    switch (action) {
      case "create": {
        const { podId, endpoint } = await createQwenVLPod();
        return NextResponse.json({
          podId,
          endpoint,
          message: `Pod created. Add QWEN_VL_POD_ID=${podId} to .env.local`,
        });
      }

      case "start": {
        const podId = process.env.QWEN_VL_POD_ID;
        if (!podId) {
          return NextResponse.json(
            { error: "No QWEN_VL_POD_ID configured" },
            { status: 400 }
          );
        }
        await startPod(podId);
        return NextResponse.json({
          podId,
          endpoint: getPodEndpoint(podId),
          message: "Pod resumed. Model will take 3-5 minutes to load.",
        });
      }

      case "stop": {
        const podId = process.env.QWEN_VL_POD_ID;
        if (!podId) {
          return NextResponse.json(
            { error: "No QWEN_VL_POD_ID configured" },
            { status: 400 }
          );
        }
        await stopPod(podId);
        return NextResponse.json({
          podId,
          message: "Pod stopped. GPU billing paused.",
        });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}. Use create, start, or stop.` },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("[Art Director Pod] Action failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Pod operation failed" },
      { status: 500 }
    );
  }
}
