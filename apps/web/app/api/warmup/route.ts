import { NextResponse } from "next/server";

/**
 * Pre-warm the RunPod endpoint by checking its health.
 * This triggers a cold start so a worker is ready by the time the user
 * clicks "Generate". The health endpoint returns worker counts without
 * submitting an actual job.
 */
export async function POST() {
  const endpointId = process.env.RUNPOD_ENDPOINT_ID;
  const apiKey = process.env.RUNPOD_API_KEY;

  if (!endpointId || !apiKey) {
    return NextResponse.json({ warmed: false, reason: "missing config" });
  }

  try {
    const res = await fetch(
      `https://api.runpod.ai/v2/${endpointId}/health`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      }
    );

    if (!res.ok) {
      console.warn(`[Warmup] Health check returned ${res.status}`);
      return NextResponse.json({ warmed: false, reason: `health ${res.status}` });
    }

    const health = await res.json();
    const hasWorkers = (health.workers?.running ?? 0) > 0 || (health.workers?.idle ?? 0) > 0;
    console.log(`[Warmup] RunPod health:`, JSON.stringify(health));

    // If no workers are running, submit a lightweight job to trigger cold start
    if (!hasWorkers) {
      console.log(`[Warmup] No active workers — submitting warm-up job`);
      const warmRes = await fetch(
        `https://api.runpod.ai/v2/${endpointId}/run`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            input: { warmup: true },
          }),
        }
      );

      if (warmRes.ok) {
        const warmData = await warmRes.json();
        console.log(`[Warmup] Warm-up job submitted: ${warmData.id}`);
        return NextResponse.json({ warmed: true, triggered: true, jobId: warmData.id });
      }
    }

    return NextResponse.json({
      warmed: true,
      triggered: false,
      workers: health.workers,
    });
  } catch (err) {
    console.error("[Warmup] Error:", err);
    return NextResponse.json({ warmed: false, reason: "error" });
  }
}
