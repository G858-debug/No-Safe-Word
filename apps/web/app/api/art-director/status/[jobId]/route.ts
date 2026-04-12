import { NextRequest, NextResponse } from "next/server";
import { getJob, runIteration } from "@/lib/art-director/orchestrator";

/**
 * GET /api/art-director/status/[jobId]
 *
 * Poll for job progress. Returns the full job state.
 * Auto-triggers the next iteration if the previous one completed
 * but didn't pass the threshold and we haven't reached max iterations.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const job = await getJob(jobId);

    // Check if we need to auto-trigger the next iteration
    if (job.status === "generating" && job.iterations.length > 0) {
      const lastIteration = job.iterations[job.iterations.length - 1];

      // If last iteration completed with evaluation but didn't pass threshold,
      // and we haven't reached max iterations, trigger the next one
      if (
        lastIteration.status === "completed" &&
        lastIteration.evaluation &&
        !lastIteration.evaluation.passesThreshold &&
        job.currentIteration < 8 &&
        lastIteration.recipeAdjustments // Feedback was generated
      ) {
        // Check if next iteration isn't already running
        const nextAlreadyStarted = job.iterations.some(
          (iter: any) =>
            iter.attempt > lastIteration.attempt &&
            (iter.status === "generating" || iter.status === "evaluating")
        );

        if (!nextAlreadyStarted) {
          console.log(
            `[Art Director Status] Auto-triggering iteration ${job.currentIteration + 1}`
          );
          runIteration(jobId).catch((err: unknown) => {
            console.error(
              `[Art Director Status] Auto-iteration failed:`,
              err
            );
          });
        }
      }
    }

    // Build response
    const currentIter = job.iterations[job.iterations.length - 1];
    const bestIter = job.bestIteration != null ? job.iterations[job.bestIteration] : null;

    return NextResponse.json({
      id: job.id,
      status: job.status,
      intentAnalysis: job.intentAnalysis,
      referenceImages: job.referenceImages,
      selectedReferenceId: job.selectedReferenceId,
      currentIteration: job.currentIteration,
      bestIteration: job.bestIteration,
      bestScore: job.bestScore,
      currentStatus: currentIter?.status || null,
      currentScore: currentIter?.evaluation?.overall || null,
      currentFeedback: currentIter?.evaluation?.feedback || null,
      currentImageUrl: currentIter?.imageUrl || null,
      finalImageUrl: job.finalImageUrl,
      error: job.error,
      iterations: job.iterations.map((iter: any) => ({
        attempt: iter.attempt,
        status: iter.status,
        imageUrl: iter.imageUrl,
        score: iter.evaluation?.overall ?? null,
        feedback: iter.evaluation?.feedback ?? null,
        scores: iter.evaluation?.scores ?? null,
        error: iter.error,
      })),
    });
  } catch (err) {
    console.error("[Art Director Status] Failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Status check failed" },
      { status: 500 }
    );
  }
}
