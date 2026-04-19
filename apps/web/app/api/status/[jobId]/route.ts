import { NextRequest, NextResponse } from "next/server";
import {
  getRunPodJobStatus,
  base64ToBuffer,
  evaluateSceneFull,
  detectCorruptedImage,
  computeCorrectionPlan,
  canRetry,
  generateRetrySeedV2,
  rewriteTagsForFailure,
  requestStructuralDiagnosis,
  MAX_EVAL_RETRY_ATTEMPTS,
} from "@no-safe-word/image-gen";
import {
  recommendResourceLoras,
  getRegisteredResourceLoras,
  getResourceLoraById,
  registerResourceLora,
  searchAndDownloadLora,
} from "@no-safe-word/image-gen";
import type { FailureCategory, EvaluationResult, SceneProfile } from "@no-safe-word/image-gen";
import { supabase } from "@no-safe-word/story-engine";
import type { Json } from "@no-safe-word/shared";

export async function GET(
  request: NextRequest,
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
    // Flux 2 Dev jobs run on a separate RunPod serverless endpoint from
    // the legacy Juggernaut endpoint. The image's settings.model tells
    // us which — poll the matching endpoint or the status lookup 404s.
    const modelSetting =
      typeof settings.model === "string" ? (settings.model as string) : undefined;
    const endpointOverride =
      modelSetting === "flux2_dev" ? process.env.RUNPOD_FLUX2_ENDPOINT_ID : undefined;
    const status = await getRunPodJobStatus(runpodJobId, endpointOverride);

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

      // ── Early corruption detection ──
      // Noise images are valid PNGs but contain random static instead of real content.
      // Detect BEFORE evaluation to avoid wasting API calls and storing garbage.
      const corruptionCheck = await detectCorruptedImage(base64Data);
      if (corruptionCheck.corrupted) {
        console.error(
          `[Status][${jobId}] NOISE IMAGE DETECTED for image ${imageId}: ${corruptionCheck.reason}. ` +
          `Rejecting — not storing.`,
        );
        await supabase
          .from("generation_jobs")
          .update({ status: "failed" })
          .eq("job_id", jobId);

        // Look up the prompt to mark it as failed too
        const { data: failedPrompt } = await supabase
          .from("story_image_prompts")
          .select("id")
          .eq("image_id", imageId)
          .single();
        if (failedPrompt) {
          await supabase
            .from("story_image_prompts")
            .update({ status: "failed" })
            .eq("id", failedPrompt.id);
        }

        return NextResponse.json({
          jobId,
          completed: false,
          error: `RunPod returned noise/corrupted image: ${corruptionCheck.reason}`,
        });
      }

      // Fetch prompt metadata for evaluation
      const { data: promptResult } = await supabase
        .from("story_image_prompts")
        .select("id, secondary_character_id, secondary_character_name, character_name, prompt, image_type")
        .eq("image_id", imageId)
        .single();

      if (!promptResult) {
        console.error(
          `[Status][${jobId}] No prompt metadata found for image ${imageId} — ` +
          `evaluation will be skipped. This indicates a DB inconsistency (story_image_prompts.image_id not set).`,
        );
      }

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
          intent_score: evalResult.scores.intentMatch || null,
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

          // Reconstruct the profile from stored generation settings.
          // The profile is stored in images.settings.profile by generate-scene-image-v4.ts.
          // Falls back to new lower defaults if profile is missing (old images).
          const storedProfile = (settings as any).profile as Record<string, number> | undefined;
          const currentProfile: SceneProfile = {
            compositionType,
            contentMode,
            charLoraStrengthModel: storedProfile?.charLoraStrengthModel ?? 0.65,
            charLoraStrengthClip: storedProfile?.charLoraStrengthClip ?? 0.4,
            cfg: storedProfile?.cfg ?? (settings.cfg as number) ?? 5.0,
            steps: storedProfile?.steps ?? (settings.steps as number) ?? 30,
            regionalOverlap: storedProfile?.regionalOverlap ?? 64,
            regionalStrength: 1.0,
            loraOverrides: {},
          };

          const correction = computeCorrectionPlan(
            evalResult,
            attemptNumber + 1,
            currentProfile,
            failureHistory,
          );

          // ── Deep LoRA Discovery (Tier 3) ──
          // On failed evaluations, use Sonnet to analyze the intent gap and recommend
          // resource LoRAs. Downloads new ones from CivitAI if needed.
          if (attemptNumber >= 3) {
            try {
              const loraRecs = await recommendResourceLoras(
                {
                  imageBase64: base64Data,
                  originalProse: promptResult.prompt,
                  booruTags: booruTags,
                  compositionType,
                  contentMode,
                  expectedPersonCount,
                  characterNames,
                },
                evalResult,
                getRegisteredResourceLoras(),
              );

              if (!correction.resourceLoras) correction.resourceLoras = [];

              for (const rec of loraRecs) {
                if (rec.existingLoraId) {
                  const existing = getResourceLoraById(rec.existingLoraId);
                  if (existing) {
                    correction.resourceLoras.push({
                      filename: existing.filename,
                      storageUrl: existing.storageUrl,
                      strengthModel: existing.defaultStrengthModel,
                      strengthClip: existing.defaultStrengthClip,
                      triggerWord: existing.triggerWord,
                    });
                    console.log(`[Evaluator] LoRA discovery: using existing "${existing.id}" — ${rec.reasoning}`);
                  }
                } else if (rec.needed && !rec.existingLoraId) {
                  console.log(`[Evaluator] LoRA discovery: searching CivitAI for "${rec.searchQuery}" — ${rec.reasoning}`);
                  const found = await searchAndDownloadLora(rec.searchQuery, rec.category);
                  if (found) {
                    registerResourceLora(found);
                    correction.resourceLoras.push({
                      filename: found.filename,
                      storageUrl: found.storageUrl,
                      strengthModel: found.defaultStrengthModel,
                      strengthClip: found.defaultStrengthClip,
                      triggerWord: found.triggerWord,
                    });
                    console.log(`[Evaluator] LoRA discovery: downloaded and registered "${found.id}"`);
                  }
                }
              }
            } catch (discoveryErr) {
              console.error('[Evaluator] LoRA discovery failed (non-fatal):', discoveryErr instanceof Error ? discoveryErr.message : discoveryErr);
            }
          }

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
            const host = request.headers.get("host");
            const proto = request.headers.get("x-forwarded-proto") || "http";
            const siteUrl = host ? `${proto}://${host}` : (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000");
            const retryRes = await fetch(`${siteUrl}/api/stories/images/${promptId}/retry`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Cookie": request.headers.get("cookie") || "",
              },
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

      // ── Validate image before storing ──
      const buffer = base64ToBuffer(base64Data);

      // Check PNG magic bytes — reject corrupt/non-image data from RunPod
      const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      if (buffer.length < 1024 || !buffer.subarray(0, 8).equals(PNG_MAGIC)) {
        console.error(
          `[Status][${jobId}] CORRUPTED IMAGE DETECTED for image ${imageId}: ` +
          `buffer length=${buffer.length}, first bytes=${buffer.subarray(0, 8).toString('hex')}. ` +
          `Rejecting — not storing.`,
        );
        await supabase
          .from("generation_jobs")
          .update({ status: "failed" })
          .eq("job_id", jobId);
        if (promptId) {
          await supabase
            .from("story_image_prompts")
            .update({ status: "failed" })
            .eq("id", promptId);
        }
        return NextResponse.json({
          jobId,
          completed: false,
          error: "RunPod returned corrupted image data (invalid PNG)",
        });
      }

      // Minimum file size check — a real 832x1216 PNG is typically 500KB+.
      // Random noise PNGs compress to much smaller or much larger sizes.
      const minExpectedBytes = 100 * 1024; // 100KB absolute minimum for any SDXL output
      if (buffer.length < minExpectedBytes) {
        console.warn(
          `[Status][${jobId}] Suspiciously small image for ${imageId}: ${(buffer.length / 1024).toFixed(0)}KB. ` +
          `Expected at least ${(minExpectedBytes / 1024).toFixed(0)}KB for SDXL output. Proceeding with caution.`,
        );
      }

      // ── Store the image ──
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
      const errorMsg = status.error || JSON.stringify(status.output || '');

      // ── ControlNet model missing — retry without pose conditioning ──
      // The RunPod worker may lack OpenPoseXL2.safetensors. Instead of failing
      // the entire image, retry the same prompt without ControlNet.
      const isControlNetMissing = errorMsg.includes("ControlNetLoader") &&
        errorMsg.includes("value_not_in_list");

      if (isControlNetMissing && imageId) {
        const { data: failedPrompt } = await supabase
          .from("story_image_prompts")
          .select("id")
          .eq("image_id", imageId)
          .single();

        if (failedPrompt) {
          console.warn(
            `[Status][${jobId}] ControlNet model missing on RunPod worker — ` +
            `retrying prompt ${failedPrompt.id} without pose conditioning`,
          );

          try {
            const host = request.headers.get("host");
            const proto = request.headers.get("x-forwarded-proto") || "http";
            const siteUrl = host ? `${proto}://${host}` : (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000");
            const retryRes = await fetch(`${siteUrl}/api/stories/images/${failedPrompt.id}/retry`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Cookie": request.headers.get("cookie") || "",
              },
              body: JSON.stringify({
                newSeed: Math.floor(Math.random() * 2_147_483_647) + 1,
                jobId,
                attemptNumber: 1,
                disableControlNet: true,
              }),
            });

            if (retryRes.ok) {
              const retryData = await retryRes.json();
              return NextResponse.json({
                jobId: retryData.jobId,
                completed: false,
                status: "RETRYING",
                retryReason: "ControlNet model missing — retrying without pose conditioning",
              });
            }
          } catch (retryErr) {
            console.error("[Status] ControlNet retry failed:", retryErr);
          }
        }
      }

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
