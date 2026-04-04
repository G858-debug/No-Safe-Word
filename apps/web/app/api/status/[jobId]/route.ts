import { NextRequest, NextResponse } from "next/server";
import {
  getRunPodJobStatus,
  base64ToBuffer,
  evaluateSceneFull,
  computeCorrectionPlan,
  canRetry,
  generateRetrySeedV2,
  rewriteTagsForFailure,
  requestStructuralDiagnosis,
  MAX_EVAL_RETRY_ATTEMPTS,
} from "@no-safe-word/image-gen";
import type { FailureCategory, EvaluationResult, SceneProfile } from "@no-safe-word/image-gen";
import { supabase } from "@no-safe-word/story-engine";
import type { Json } from "@no-safe-word/shared";

export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ jobId: string }> }
) {
  try {
    const params = await props.params;
    const { jobId } = params;

    if (!jobId) {
      return NextResponse.json(
        { error: "Missing jobId parameter" },
        { status: 400 }
      );
    }

    // Find the image_id from generation_jobs
    const { data: jobRow } = await supabase
      .from("generation_jobs")
      .select("image_id")
      .eq("job_id", jobId)
      .single();

    const settings: Record<string, unknown> = {};
    let imageId: string | null = jobRow?.image_id ?? null;

    if (imageId) {
      const { data: imageResult } = await supabase
        .from("images")
        .select("settings, prompt")
        .eq("id", imageId)
        .single();
      if (imageResult?.settings) {
        Object.assign(settings, imageResult.settings as Record<string, unknown>);
      }
    }

    const runpodJobId = jobId.startsWith("runpod-") ? jobId.replace("runpod-", "") : jobId;
    const status = await getRunPodJobStatus(runpodJobId);

    if (status.status === "COMPLETED") {
      console.log(`[StoryPublisher] RunPod job COMPLETED: ${runpodJobId}`);
    } else if (status.status === "FAILED") {
      console.log(`[StoryPublisher] RunPod job FAILED: ${runpodJobId}`);
    }

    if (status.status === "COMPLETED" && status.output?.images?.[0]) {
      const imageData = status.output.images[0].data;
      const base64Data = imageData.includes(",") ? imageData.split(",")[1] : imageData;

      if (!imageId) {
        return NextResponse.json({
          jobId,
          completed: true,
          imageUrl: null,
          seed: null,
          cost: 0,
          scheduled: true,
        });
      }

      // Fetch prompt metadata for evaluation
      const { data: promptResult } = await supabase
        .from("story_image_prompts")
        .select("id, secondary_character_id, secondary_character_name, character_name, prompt, image_type")
        .eq("image_id", imageId)
        .single();

      const seed = settings.seed != null ? Number(settings.seed) : null;
      const isDualCharacter = !!promptResult?.secondary_character_id;
      const promptId = promptResult?.id;
      const expectedPersonCount = isDualCharacter ? 2 : 1;

      // Derive attempt number from existing evaluations — more reliable than image settings
      // (image settings.attemptNumber can be stale if the retry endpoint skips the update)
      let attemptNumber = 1;
      if (promptId) {
        const { count } = await (supabase as any)
          .from("generation_evaluations")
          .select("id", { count: "exact", head: true })
          .eq("prompt_id", promptId);
        attemptNumber = (count ?? 0) + 1;
      }

      // ── Scene Evaluation ──
      let evalResult: EvaluationResult | undefined;

      // Idempotency guard — skip if this (image_id, attempt_number) was already evaluated.
      // Prevents duplicate records when the client polls the same completed job twice.
      // Must use attempt_number too — retries reuse the same image_id but are a new attempt.
      const { data: existingEval } = await (supabase as any)
        .from("generation_evaluations")
        .select("id")
        .eq("image_id", imageId)
        .eq("attempt_number", attemptNumber)
        .limit(1)
        .maybeSingle();

      if (existingEval) {
        console.log(`[Evaluator] Image ${imageId} attempt ${attemptNumber} already evaluated — skipping duplicate poll`);
      }

      if (promptResult && !existingEval) {
        // Derive composition type and content mode from prompt metadata
        const characterNames = [
          promptResult.character_name,
          promptResult.secondary_character_name,
        ].filter((n): n is string => n !== null);

        const contentMode = promptResult.image_type === 'facebook_sfw' ? 'sfw' : 'nsfw';
        const compositionType = isDualCharacter ? '1boy_1girl' : 'solo'; // simplified; full derivation needs gender data

        // Fetch the booru tags from the assembled prompt
        const { data: imageRow } = await supabase
          .from("images")
          .select("prompt")
          .eq("id", imageId)
          .single();

        const booruTags = imageRow?.prompt || '';

        try {
          evalResult = await evaluateSceneFull({
            imageBase64: base64Data,
            originalProse: promptResult.prompt,
            booruTags,
            compositionType,
            contentMode,
            expectedPersonCount,
            characterNames,
          });
        } catch (evalErr) {
          console.error(`[Evaluator][${promptId}] evaluateSceneFull threw — storing error, skipping retry:`, evalErr instanceof Error ? evalErr.message : evalErr);
          await (supabase as any).from("generation_evaluations").insert({
            image_id: imageId,
            prompt_id: promptId,
            attempt_number: attemptNumber,
            composition_type: compositionType,
            content_mode: contentMode,
            original_prose: promptResult.prompt,
            booru_tags: booruTags,
            generation_params: settings as Json,
            person_count_expected: expectedPersonCount,
            person_count_detected: null,
            overall_score: null,
            passed: false,
            failure_categories: ['evaluation_error'],
            eval_model: 'claude-haiku-4-5-20251001',
            raw_eval_response: { error: evalErr instanceof Error ? evalErr.message : String(evalErr) } as Json,
          });
          // Fall through — store the image without triggering a retry
        }

        // Store full evaluation result (when evaluation succeeded)
        if (evalResult) await (supabase as any).from("generation_evaluations").insert({
          image_id: imageId,
          prompt_id: promptId,
          attempt_number: attemptNumber,
          composition_type: compositionType,
          content_mode: contentMode,
          original_prose: promptResult.prompt,
          booru_tags: booruTags,
          generation_params: settings as Json,
          person_count_expected: expectedPersonCount,
          person_count_detected: evalResult.scores.personCount.detected,
          setting_score: evalResult.scores.setting || null,
          clothing_score: evalResult.scores.clothing || null,
          pose_score: evalResult.scores.pose || null,
          lighting_score: evalResult.scores.lighting || null,
          composition_score: evalResult.scores.composition || null,
          character_distinction_score: evalResult.scores.characterDistinction || null,
          overall_score: evalResult.overallScore,
          passed: evalResult.passed,
          failure_categories: evalResult.failureCategories,
          eval_model: 'claude-haiku-4-5-20251001',
          raw_eval_response: evalResult.rawResponse as Json,
        });

        if (evalResult) console.log(
          `[Evaluator][${promptId}] Attempt ${attemptNumber}/${MAX_EVAL_RETRY_ATTEMPTS}: ` +
          `overall=${evalResult.overallScore.toFixed(2)}, passed=${evalResult.passed}, ` +
          `failures=[${evalResult.failureCategories.join(', ')}]`,
        );

        // ── Retry Logic ──
        if (evalResult && !evalResult.passed && canRetry(attemptNumber) && promptId) {
          // Fetch failure history from previous evaluations
          const { data: prevEvals } = await (supabase as any)
            .from("generation_evaluations")
            .select("failure_categories, raw_eval_response")
            .eq("prompt_id", promptId)
            .order("attempt_number", { ascending: true });

          const failureHistory: FailureCategory[][] = (prevEvals || []).map(
            (e: any) => (e.failure_categories || []) as FailureCategory[],
          );

          // Build the current profile from settings (best effort reconstruction)
          const currentProfile: SceneProfile = {
            compositionType,
            contentMode,
            charLoraStrength: 0.75,
            cfg: (settings.cfg as number) || 6.5,
            steps: (settings.steps as number) || 30,
            regionalOverlap: 64,
            regionalStrength: 1.0,
            loraOverrides: {},
          };

          const correction = computeCorrectionPlan(
            evalResult,
            attemptNumber + 1,
            currentProfile,
            failureHistory,
          );

          // Update evaluation record with the correction plan
          await (supabase as any)
            .from("generation_evaluations")
            .update({ corrections_applied: correction as unknown as Json })
            .eq("prompt_id", promptId)
            .eq("attempt_number", attemptNumber);

          // If structural failure detected on final attempts, request Sonnet diagnosis
          if (correction.structuralFailure && attemptNumber >= MAX_EVAL_RETRY_ATTEMPTS - 1) {
            const evalDiagnoses = (prevEvals || []).map(
              (e: any) => ((e.raw_eval_response as any)?.diagnosis as string) || '',
            );
            const structuralDiagnosis = await requestStructuralDiagnosis(
              failureHistory,
              evalDiagnoses,
              compositionType,
              contentMode,
            );
            console.log(`[Evaluator] STRUCTURAL FAILURE DETECTED — Sonnet diagnosis stored`);
            await (supabase as any)
              .from("generation_evaluations")
              .update({
                raw_eval_response: {
                  ...evalResult.rawResponse,
                  structural_diagnosis: structuralDiagnosis,
                } as Json,
              })
              .eq("prompt_id", promptId)
              .eq("attempt_number", attemptNumber);
          }

          // Rewrite tags if the correction plan calls for it
          let overrideTags: string | undefined;
          if (correction.needsTagRewrite) {
            const { data: imageForTags } = await supabase
              .from("images")
              .select("prompt")
              .eq("id", imageId)
              .single();

            overrideTags = await rewriteTagsForFailure(
              promptResult.prompt,
              imageForTags?.prompt || '',
              correction.tagRewriteInstructions,
              correction.tagRewriteModel,
              contentMode,
            );
          }

          // Submit retry
          const newSeed = generateRetrySeedV2();
          console.log(
            `[Evaluator][${promptId}] Retrying (attempt ${attemptNumber + 1}/${MAX_EVAL_RETRY_ATTEMPTS}): ` +
            `actions=[${correction.actions.join(', ')}]`,
          );

          try {
            const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
            const retryRes = await fetch(`${siteUrl}/api/stories/images/${promptId}/retry`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                newSeed,
                jobId,
                profileOverrides: correction.paramAdjustments,
                overrideTags,
                attemptNumber: attemptNumber + 1,
              }),
            });

            if (retryRes.ok) {
              const retryData = await retryRes.json();
              return NextResponse.json({
                jobId: retryData.jobId,
                completed: false,
                status: "RETRYING",
                evaluation: {
                  attempt: attemptNumber,
                  overallScore: evalResult.overallScore,
                  failures: evalResult.failureCategories,
                  diagnosis: evalResult.diagnosis,
                },
                retryReason: `Evaluation failed: ${evalResult.failureCategories.join(', ')}`,
              });
            } else {
              console.error(`[Evaluator] Retry endpoint failed: ${retryRes.status}`);
              return NextResponse.json({
                jobId,
                completed: false,
                status: "RETRY_FAILED",
                error: `Retry endpoint returned ${retryRes.status}`,
              });
            }
          } catch (retryErr) {
            console.error("[Evaluator] Retry request failed:", retryErr);
            return NextResponse.json({
              jobId,
              completed: false,
              status: "RETRY_FAILED",
              error: "Exception while submitting retry",
            });
          }
        } else if (evalResult && !evalResult.passed) {
          console.warn(
            `[Evaluator][${promptId}] FAILED after ${attemptNumber} attempts. ` +
            `Best score: ${evalResult.overallScore.toFixed(2)}. Storing result.`,
          );
        } else if (evalResult) {
          console.log(`[Evaluator][${promptId}] PASSED on attempt ${attemptNumber}`);
        }
      }

      // ── Store the image ──
      const buffer = base64ToBuffer(base64Data);
      const timestamp = Date.now();
      const storagePath = `stories/${imageId}-${timestamp}.png`;

      const { error: uploadError } = await supabase.storage
        .from("story-images")
        .upload(storagePath, buffer, { contentType: "image/png", upsert: true });

      if (uploadError) {
        console.error(
          `[Status][${jobId}] Supabase storage upload FAILED for image ${imageId}: ${uploadError.message}`,
        );
        return NextResponse.json({
          jobId,
          completed: false,
          error: `Image storage failed: ${uploadError.message}`,
        });
      }

      const { data: { publicUrl } } = supabase.storage
        .from("story-images")
        .getPublicUrl(storagePath);

      await supabase
        .from("images")
        .update({ stored_url: publicUrl, sfw_url: publicUrl })
        .eq("id", imageId);

      await supabase
        .from("generation_jobs")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("job_id", jobId);

      if (promptId) {
        await supabase
          .from("story_image_prompts")
          .update({ status: "generated" })
          .eq("id", promptId);
      }

      return NextResponse.json({
        jobId,
        completed: true,
        imageUrl: publicUrl,
        seed,
        cost: 0,
        scheduled: true,
        ...(evalResult ? {
          evaluation: {
            attempt: attemptNumber,
            overallScore: evalResult.overallScore,
            passed: evalResult.passed,
            failures: evalResult.failureCategories,
          },
        } : {}),
      });

    } else if (status.status === "FAILED") {
      await supabase
        .from("generation_jobs")
        .update({ status: "failed" })
        .eq("job_id", jobId);

      return NextResponse.json({
        jobId,
        completed: false,
        error: status.error || "RunPod job failed",
      });

    } else {
      return NextResponse.json({
        jobId,
        completed: false,
        status: status.status,
        delayTime: status.delayTime ?? null,
      });
    }
  } catch (err) {
    console.error("Status check failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
