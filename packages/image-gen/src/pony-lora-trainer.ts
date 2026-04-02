/**
 * Pony V6 Character LoRA Training Pipeline.
 *
 * Orchestrates: dataset generation → evaluation → captioning → packaging → Kohya training → validation.
 *
 * Training runs on RunPod GPU pods via Kohya sd-scripts (NOT serverless).
 * The orchestrator creates the pod and returns — the pod POSTs a webhook on completion,
 * which triggers validation and deployment via completePonyPipeline().
 */

import Anthropic from '@anthropic-ai/sdk';
import archiver from 'archiver';
import { PassThrough } from 'stream';

import { generatePonyDataset } from './pony-dataset-generator';
import type { PonyDatasetCharacter } from './pony-dataset-generator';
import { buildPonyQualityPrefix, buildPonyNegativePrompt } from './pony-prompt-builder';
import { buildPonyWorkflow } from './pony-workflow-builder';
import { selectTrainingSet, type TrainingImageEvaluation } from './pony-character-lora/training-image-evaluator';
import { buildTrainingCaption, type CharacterIdentity } from './pony-character-lora/training-caption-builder';
import { validatePonyLora, toPipelineValidationResult } from './pony-character-lora-validator';
import { createTrainingPod, terminateTrainingPod } from './runpod-pods';
import { anthropicCreateWithRetry } from './anthropic-retry';
import { imageUrlToBase64, submitRunPodJob, waitForRunPodResult } from './runpod';
import type { CharacterInput, PipelineStatus, LoraDatasetImageRow } from './character-lora/types';
import { PIPELINE_CONFIG } from './character-lora/types';

// ── Existing exports (keep) ──

export interface PonyLoraTrainingConfig {
  characterId: string;
  triggerWord: string;
  baseModel: 'ponyDiffusionV6XL' | 'CyberRealistic_PonySemi_V4.5';
  networkDim: number;
  networkAlpha: number;
  epochs: number;
  noiseOffset: number;
  resolution: number;
  clipSkip: number;
}

export function getRecommendedTrainingConfig(characterName: string): PonyLoraTrainingConfig {
  const trigger = characterName.toLowerCase().replace(/\s+/g, '_') + '_nsw';
  return {
    characterId: '',
    triggerWord: trigger,
    baseModel: 'CyberRealistic_PonySemi_V4.5',
    networkDim: 8,
    networkAlpha: 8,
    epochs: 12,
    noiseOffset: 0.03,
    resolution: 1024,
    clipSkip: 2,
  };
}

export function getIdentityTagsToRemove(characterData: {
  hairColor: string;
  hairStyle: string;
  eyeColor: string;
  skinTone: string;
  bodyType: string;
  ethnicity: string;
}): string[] {
  return [
    `${characterData.hairColor} hair`,
    characterData.hairStyle,
    `${characterData.eyeColor} eyes`,
    `${characterData.skinTone} skin`,
    'dark skin',
    'dark-skinned female',
    'dark-skinned male',
    'curvy',
    'wide hips',
    'thick thighs',
    'large breasts',
    'voluptuous',
    'african',
    'black',
    characterData.ethnicity.toLowerCase(),
  ].filter(Boolean);
}

// ── Pipeline types ──

export interface PipelineDeps {
  supabase: any;
}

const KOHYA_DOCKER_IMAGE = process.env.KOHYA_TRAINER_IMAGE || 'ghcr.io/g858-debug/nsw-kohya-trainer:latest';
const DATASET_BUCKET = 'lora-training-datasets';
const IMAGES_BUCKET = 'story-images';

// ── Status helpers ──

async function setLoraStatus(
  loraId: string,
  status: PipelineStatus,
  extra: Record<string, unknown> = {},
  deps: PipelineDeps,
): Promise<void> {
  await deps.supabase
    .from('character_loras')
    .update({ status, ...extra, updated_at: new Date().toISOString() })
    .eq('id', loraId);
}

async function setLoraError(loraId: string, error: string, deps: PipelineDeps): Promise<void> {
  await setLoraStatus(loraId, 'failed', { error }, deps);
}

// ── Main Pipeline ──

/**
 * Run the Pony LoRA training pipeline (stages 1-6).
 *
 * Called fire-and-forget from the train-lora route. Stages 1-3 run synchronously
 * in this process. Stage 3 pauses the pipeline for human approval. After approval,
 * resumePonyPipeline() continues from stage 4. Stage 6 creates the training pod
 * and returns — the pod webhook triggers completePonyPipeline() for validation.
 */
export async function runPonyPipeline(
  character: CharacterInput,
  loraId: string,
  deps: PipelineDeps,
): Promise<void> {
  const config = getRecommendedTrainingConfig(character.characterName);
  config.characterId = character.characterId;

  // Check current status for resumability — skip completed stages
  const { data: currentLora } = await deps.supabase
    .from('character_loras')
    .select('status')
    .eq('id', loraId)
    .single();
  const currentStatus = (currentLora as any)?.status || 'pending';

  const isResume = currentStatus !== 'pending';
  console.log(`[PonyPipeline] ${isResume ? 'Resuming' : 'Starting'} for ${character.characterName} (loraId: ${loraId}, status: ${currentStatus}, trigger: ${config.triggerWord})`);

  try {
    // ── Stage 1: Generate dataset (resumable — skips existing images) ──
    if (['pending', 'generating_dataset'].includes(currentStatus)) {
      await setLoraStatus(loraId, 'generating_dataset', {}, deps);
      console.log(`[PonyPipeline] Stage 1: Generating dataset...`);

      const datasetResult = await generatePonyDataset(character, loraId, deps);
      console.log(`[PonyPipeline] Generated ${datasetResult.totalGenerated} images, ${datasetResult.failedPrompts.length} failed`);

      await setLoraStatus(loraId, 'generating_dataset', {
        dataset_size: datasetResult.totalGenerated,
      }, deps);
    } else {
      console.log(`[PonyPipeline] Skipping Stage 1 (already at ${currentStatus})`);
    }

    // ── Stage 2: Evaluate images (resumable — only evaluates pending images) ──
    if (['pending', 'generating_dataset', 'evaluating'].includes(currentStatus)) {
      await setLoraStatus(loraId, 'evaluating', {}, deps);
      console.log(`[PonyPipeline] Stage 2: Evaluating dataset images...`);

      let evaluations = await evaluateDatasetImages(loraId, character, deps);

      // Initial pass — mark passed/failed in DB
      for (const eval_ of evaluations) {
        const score = calculateSimpleScore(eval_);
        const passed = score >= PIPELINE_CONFIG.minEvalScore;
        await deps.supabase
          .from('lora_dataset_images')
          .update({ eval_status: passed ? 'passed' : 'failed' })
          .eq('id', eval_.imageId);
      }

      const initialPassed = evaluations.filter(e => calculateSimpleScore(e) >= PIPELINE_CONFIG.minEvalScore).length;
      console.log(`[PonyPipeline] Initial evaluation: ${initialPassed}/${evaluations.length} passed`);

      // Retry failed images with improved prompts (up to 3 rounds)
      if (initialPassed < PIPELINE_CONFIG.targetPassedImages) {
        console.log(`[PonyPipeline] Need ${PIPELINE_CONFIG.targetPassedImages}, have ${initialPassed}. Retrying failed images with improved prompts...`);
        const retryEvals = await retryFailedImages(loraId, character, deps);
        evaluations = evaluations.concat(retryEvals);
      }

      // Final curation
      const allPassingEvals = evaluations.filter(e => calculateSimpleScore(e) >= PIPELINE_CONFIG.minEvalScore);
      const { selected, rejected, diversityCoverage, warnings } = selectTrainingSet(allPassingEvals);

      console.log(`[PonyPipeline] Final: ${selected.length} selected, ${rejected.length} rejected (after retries)`);
      if (warnings.length > 0) {
        console.warn(`[PonyPipeline] Warnings: ${warnings.join('; ')}`);
      }
      if (!diversityCoverage.met) {
        console.warn(`[PonyPipeline] Missing diversity: ${diversityCoverage.missing.join(', ')}`);
      }

      // Update eval_status for final selection
      const selectedIds = new Set(selected.map(e => e.imageId));
      const { data: allImages } = await deps.supabase
        .from('lora_dataset_images')
        .select('id')
        .eq('lora_id', loraId);

      if (allImages) {
        for (const img of allImages) {
          const evalStatus = selectedIds.has(img.id) ? 'passed' : 'failed';
          await deps.supabase
            .from('lora_dataset_images')
            .update({ eval_status: evalStatus })
            .eq('id', img.id);
        }
      }

      if (selected.length < PIPELINE_CONFIG.minPassedImages) {
        throw new Error(
          `Only ${selected.length} images passed evaluation after ${MAX_RETRY_ROUNDS} retry rounds (need ${PIPELINE_CONFIG.minPassedImages}). ` +
          `Review the dataset and adjust character description, then retry.`
        );
      }

      // ── Stage 3: Await human approval ──
      await setLoraStatus(loraId, 'awaiting_dataset_approval', {}, deps);
      console.log(`[PonyPipeline] Stage 3: Pausing for human dataset approval. ${selected.length} images ready for review.`);
    } else {
      console.log(`[PonyPipeline] Skipping Stages 2-3 (already at ${currentStatus})`);
    }
    // Pipeline STOPS here. Human uses the approve-dataset route, then
    // calls resume-training to continue from stage 4.
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[PonyPipeline] Failed: ${msg}`);
    await setLoraError(loraId, msg, deps);
  }
}

/**
 * Resume the pipeline after human dataset approval (stages 4-6).
 * Called by the resume-training API route.
 */
export async function resumePonyPipeline(
  character: CharacterInput,
  loraId: string,
  deps: PipelineDeps,
): Promise<void> {
  const config = getRecommendedTrainingConfig(character.characterName);
  config.characterId = character.characterId;

  console.log(`[PonyPipeline] Resuming from captioning for ${character.characterName}`);

  try {
    // ── Stage 4: Caption images ──
    await setLoraStatus(loraId, 'captioning', {}, deps);
    console.log(`[PonyPipeline] Stage 4: Captioning approved images...`);

    await captionApprovedImages(loraId, character, config, deps);

    // ── Stage 5: Package dataset ──
    console.log(`[PonyPipeline] Stage 5: Packaging dataset...`);

    const datasetUrl = await packageDataset(loraId, deps);
    console.log(`[PonyPipeline] Dataset packaged: ${datasetUrl}`);

    // ── Stage 6: Create training pod ──
    await setLoraStatus(loraId, 'training', {}, deps);
    console.log(`[PonyPipeline] Stage 6: Creating training pod...`);

    await createTrainingPodForLora(loraId, config, datasetUrl, deps);
    console.log(`[PonyPipeline] Training pod created. Pipeline will resume via webhook.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[PonyPipeline] Resume failed: ${msg}`);
    await setLoraError(loraId, msg, deps);
  }
}

/**
 * Complete the pipeline after training pod finishes (stages 7-8).
 * Called by the lora-training-webhook route.
 */
export async function completePonyPipeline(
  loraId: string,
  deps: PipelineDeps,
): Promise<void> {
  console.log(`[PonyPipeline] Completing pipeline for loraId: ${loraId}`);

  try {
    // Fetch the LoRA record
    const { data: lora, error: loraErr } = await deps.supabase
      .from('character_loras')
      .select('*')
      .eq('id', loraId)
      .single();

    if (loraErr || !lora) {
      throw new Error(`LoRA record not found: ${loraId}`);
    }

    // Fetch the character for validation
    const { data: charRows } = await deps.supabase
      .from('story_characters')
      .select('id, character_id, characters(id, name, description)')
      .eq('character_id', lora.character_id)
      .limit(1);

    const storyChar = charRows?.[0];
    if (!storyChar) {
      throw new Error(`Story character not found for character_id: ${lora.character_id}`);
    }

    // Get an approved portrait URL for face comparison
    const { data: portraitImg } = await deps.supabase
      .from('images')
      .select('stored_url, sfw_url')
      .eq('id', storyChar.approved_image_id)
      .single();

    const approvedUrl = portraitImg?.sfw_url || portraitImg?.stored_url;

    // ── Stage 7: Validate ──
    await setLoraStatus(loraId, 'validating', {}, deps);
    console.log(`[PonyPipeline] Stage 7: Validating trained LoRA...`);

    const desc = storyChar.characters?.description as Record<string, string> || {};
    const validationResult = await validatePonyLora(
      { gender: desc.gender || 'female', approvedImageUrl: approvedUrl || '' },
      lora.filename,
      lora.storage_url,
      lora.trigger_word,
      loraId,
      deps,
    );

    const pipelineResult = toPipelineValidationResult(validationResult);

    if (pipelineResult.overallPass) {
      // ── Stage 8: Deploy ──
      await setLoraStatus(loraId, 'deployed', {
        validation_score: pipelineResult.averageFaceScore,
        deployed_at: new Date().toISOString(),
      }, deps);
      console.log(`[PonyPipeline] LoRA deployed! Score: ${pipelineResult.averageFaceScore.toFixed(1)}`);
    } else {
      const attempts = (lora.training_attempts || 0) + 1;
      if (attempts < PIPELINE_CONFIG.maxTrainingAttempts) {
        console.warn(`[PonyPipeline] Validation failed (attempt ${attempts}/${PIPELINE_CONFIG.maxTrainingAttempts}). Will retry.`);
        await setLoraStatus(loraId, 'failed', {
          validation_score: pipelineResult.averageFaceScore,
          training_attempts: attempts,
          error: `Validation failed: avg score ${pipelineResult.averageFaceScore.toFixed(1)} (attempt ${attempts})`,
        }, deps);
      } else {
        await setLoraStatus(loraId, 'failed', {
          validation_score: pipelineResult.averageFaceScore,
          training_attempts: attempts,
          error: `Validation failed after ${attempts} attempts. Avg score: ${pipelineResult.averageFaceScore.toFixed(1)}`,
        }, deps);
        console.error(`[PonyPipeline] Validation failed after max attempts.`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[PonyPipeline] Completion failed: ${msg}`);
    await setLoraError(loraId, msg, deps);
  }
}

// ── Stage helpers ──

/**
 * Evaluate dataset images using Claude Vision.
 * Returns TrainingImageEvaluation objects for use with selectTrainingSet().
 */
async function evaluateDatasetImages(
  loraId: string,
  character: CharacterInput,
  deps: PipelineDeps,
): Promise<TrainingImageEvaluation[]> {
  const { data: images } = await deps.supabase
    .from('lora_dataset_images')
    .select('*')
    .eq('lora_id', loraId)
    .eq('eval_status', 'pending');

  if (!images || images.length === 0) return [];

  // Get reference image for face comparison
  let referenceBase64: string | null = null;
  try {
    referenceBase64 = await imageUrlToBase64(character.approvedImageUrl);
  } catch {
    console.warn('[PonyPipeline] Could not fetch reference image for evaluation');
  }

  const anthropic = new Anthropic();
  const evaluations: TrainingImageEvaluation[] = [];
  const concurrency = PIPELINE_CONFIG.evaluationConcurrency;

  // Process in batches
  for (let i = 0; i < images.length; i += concurrency) {
    const batch = images.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (img: LoraDatasetImageRow) => {
        const evaluation = await evaluateSingleImage(
          anthropic,
          img,
          referenceBase64,
          character,
        );

        // Update the DB record with eval results
        const score = calculateSimpleScore(evaluation);
        const issues = (evaluation as any).issues || [];
        await deps.supabase
          .from('lora_dataset_images')
          .update({
            eval_score: score,
            eval_details: {
              face_score: evaluation.quality.expressionNatural,
              body_score: evaluation.quality.poseNatural,
              quality_score: score,
              verdict: score >= PIPELINE_CONFIG.minEvalScore ? 'PASS' : 'FAIL',
              issues,
              proportions_realistic: evaluation.requirements.correctBodyProportions,
            },
          })
          .eq('id', img.id);

        return evaluation;
      }),
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        evaluations.push(r.value);
      }
    }

    console.log(`[PonyPipeline] Evaluated ${Math.min(i + concurrency, images.length)}/${images.length}`);

    // Heartbeat: update timestamp so stale detection knows we're alive
    await deps.supabase
      .from('character_loras')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', loraId);
  }

  return evaluations;
}

// ── Retry failed images with improved prompts ──

const MAX_RETRY_ROUNDS = 3;

/**
 * Retry failed dataset images by asking Claude to improve the prompt based on
 * the evaluation feedback, then regenerating and re-evaluating. Up to 3 rounds.
 */
async function retryFailedImages(
  loraId: string,
  character: CharacterInput,
  deps: PipelineDeps,
): Promise<TrainingImageEvaluation[]> {
  const ponyEndpointId = process.env.RUNPOD_PONY_ENDPOINT_ID;
  if (!ponyEndpointId) return [];

  const anthropic = new Anthropic();
  let referenceBase64: string | null = null;
  try {
    referenceBase64 = await imageUrlToBase64(character.approvedImageUrl);
  } catch { /* ignore */ }

  const newEvaluations: TrainingImageEvaluation[] = [];

  for (let round = 1; round <= MAX_RETRY_ROUNDS; round++) {
    // Fetch images that failed evaluation
    const { data: failedImages } = await deps.supabase
      .from('lora_dataset_images')
      .select('*')
      .eq('lora_id', loraId)
      .eq('eval_status', 'failed');

    if (!failedImages || failedImages.length === 0) {
      console.log(`[PonyPipeline] Retry round ${round}: no failed images left`);
      break;
    }

    // Check if we already have enough passing images
    const { count: passedCount } = await deps.supabase
      .from('lora_dataset_images')
      .select('*', { count: 'exact', head: true })
      .eq('lora_id', loraId)
      .eq('eval_status', 'passed');

    if ((passedCount || 0) >= PIPELINE_CONFIG.targetPassedImages) {
      console.log(`[PonyPipeline] Retry round ${round}: already have ${passedCount} passed images, stopping`);
      break;
    }

    console.log(`[PonyPipeline] Retry round ${round}/${MAX_RETRY_ROUNDS}: ${failedImages.length} failed images to retry`);

    for (const failedImg of failedImages) {
      const evalDetails = failedImg.eval_details as {
        issues?: string[];
        face_score?: number;
        body_score?: number;
        quality_score?: number;
      } | null;

      const issues = evalDetails?.issues || [];
      if (issues.length === 0) continue; // No feedback to improve from

      const originalPrompt = failedImg.prompt_template || '';

      // Ask Claude to improve the prompt based on failure feedback
      try {
        const improvedPrompt = await improvePromptFromFeedback(
          anthropic,
          originalPrompt,
          issues,
          failedImg.category,
          character,
        );

        if (!improvedPrompt || improvedPrompt === originalPrompt) continue;

        console.log(`[PonyPipeline] Retry ${failedImg.id}: improved prompt for ${failedImg.category}`);

        // Regenerate with improved prompt
        const seed = Math.floor(Math.random() * 2_147_483_647) + 1;
        const qualityPrefix = buildPonyQualityPrefix('sfw');
        const negativePrompt = buildPonyNegativePrompt('sfw');
        const positivePrompt = `${qualityPrefix}, ${improvedPrompt}`;

        // Dimensions based on category
        const dims = failedImg.category === 'face-closeup'
          ? { width: 1024, height: 1024 }
          : { width: 832, height: 1216 };

        const workflow = buildPonyWorkflow({
          positivePrompt,
          negativePrompt,
          ...dims,
          seed,
          filenamePrefix: `dataset_retry_${failedImg.id}`,
        });

        const { jobId } = await submitRunPodJob(workflow, undefined, undefined, ponyEndpointId);
        const { imageBase64 } = await waitForRunPodResult(jobId, 300000, 3000, ponyEndpointId);

        // Upload replacement image
        const imageBuffer = Buffer.from(imageBase64, 'base64');
        const storagePath = `lora-datasets/${loraId}/retry_${round}_${failedImg.id}.png`;

        const { error: uploadError } = await deps.supabase.storage
          .from('story-images')
          .upload(storagePath, imageBuffer, { contentType: 'image/png', upsert: true });

        if (uploadError) {
          console.warn(`[PonyPipeline] Upload failed for retry: ${uploadError.message}`);
          continue;
        }

        const { data: urlData } = deps.supabase.storage
          .from('story-images')
          .getPublicUrl(storagePath);

        // Update the existing record with new image
        await deps.supabase
          .from('lora_dataset_images')
          .update({
            image_url: urlData.publicUrl,
            storage_path: storagePath,
            eval_status: 'pending',
            eval_score: null,
            eval_details: null,
          })
          .eq('id', failedImg.id);

        // Re-evaluate the new image
        const updatedImg = { ...failedImg, image_url: urlData.publicUrl };
        const evaluation = await evaluateSingleImage(anthropic, updatedImg, referenceBase64, character);
        const score = calculateSimpleScore(evaluation);
        const newIssues = (evaluation as any).issues || [];

        const passed = score >= PIPELINE_CONFIG.minEvalScore;
        await deps.supabase
          .from('lora_dataset_images')
          .update({
            eval_status: passed ? 'passed' : 'failed',
            eval_score: score,
            eval_details: {
              face_score: evaluation.quality.expressionNatural,
              body_score: evaluation.quality.poseNatural,
              quality_score: score,
              verdict: passed ? 'PASS' : 'FAIL',
              issues: newIssues,
              proportions_realistic: evaluation.requirements.correctBodyProportions,
              reason: `Retry round ${round}: ${passed ? 'improved and passed' : 'still failing'}`,
            },
          })
          .eq('id', failedImg.id);

        if (passed) {
          newEvaluations.push(evaluation);
          console.log(`[PonyPipeline] Retry SUCCESS: ${failedImg.id} now scores ${score} (was ${failedImg.eval_score})`);
        } else {
          console.log(`[PonyPipeline] Retry round ${round}: ${failedImg.id} still failing (score ${score}, issues: ${newIssues.join(', ')})`);
        }

        // Small delay between retries
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        console.warn(`[PonyPipeline] Retry failed for ${failedImg.id}: ${err}`);
      }
    }
  }

  return newEvaluations;
}

/**
 * Ask Claude to improve a booru-tag prompt based on evaluation feedback.
 */
async function improvePromptFromFeedback(
  anthropic: Anthropic,
  originalPrompt: string,
  issues: string[],
  category: string,
  character: CharacterInput,
): Promise<string | null> {
  try {
    const response = await anthropicCreateWithRetry(anthropic, {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `You are improving a booru-style image generation prompt for a character LoRA training dataset.

Character: ${character.structuredData.gender}, ${character.structuredData.ethnicity}, ${character.structuredData.age} years old, ${character.structuredData.skinTone} skin, ${character.structuredData.hairStyle} ${character.structuredData.hairColor} hair.
Image category: ${category}

Original prompt tags: ${originalPrompt}

The generated image FAILED evaluation with these issues:
${issues.map(i => `- ${i}`).join('\n')}

Rewrite the prompt as improved comma-separated booru tags that fix these specific issues. Keep the same character identity and category (${category}). Add or modify tags to address each issue. Remove tags that may have caused problems.

Output ONLY the improved comma-separated tags, nothing else.`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    return text || null;
  } catch {
    return null;
  }
}

function calculateSimpleScore(eval_: TrainingImageEvaluation): number {
  const q = eval_.quality;
  const r = eval_.requirements;

  // Soft penalties for former hard requirements (small deductions, not kills)
  const skinTonePenalty = r.correctSkinTone ? 0 : -0.5;
  const proportionsPenalty = r.correctBodyProportions ? 0 : -0.3;

  // skinToneConsistency is new — fall back to 7 for older evals that don't have it
  const skinToneScore = (q as any).skinToneConsistency ?? 7;

  const baseScore = (
    q.expressionNatural * 1.5 +
    q.poseNatural * 1.2 +
    q.lightingQuality * 1.0 +
    q.backgroundClean * 0.8 +
    q.hairAccurate * 1.0 +
    skinToneScore * 0.6 +
    q.overallAesthetic * 1.5
  ) / (1.5 + 1.2 + 1.0 + 0.8 + 1.0 + 0.6 + 1.5) + skinTonePenalty + proportionsPenalty;

  return Math.round(baseScore * 10) / 10;
}

async function evaluateSingleImage(
  anthropic: Anthropic,
  img: LoraDatasetImageRow,
  referenceBase64: string | null,
  character: CharacterInput,
): Promise<TrainingImageEvaluation> {
  // Download the training image
  let imageBase64: string;
  try {
    imageBase64 = await imageUrlToBase64(img.image_url);
  } catch {
    // Return a failing evaluation if we can't download
    return makeFailingEvaluation(img.id);
  }

  const content: Anthropic.MessageCreateParams['messages'][0]['content'] = [];

  if (referenceBase64) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: referenceBase64 },
    });
    content.push({ type: 'text', text: 'Reference image (approved portrait) above.' });
  }

  content.push({
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: imageBase64 },
  });

  const bodyStyleNote = character.structuredData.gender === 'female'
    ? `IMPORTANT: This character is intentionally designed with exaggerated curvy proportions (very large breasts, very wide hips, narrow waist, full thighs). This is the intended art style — do NOT flag these as anatomy errors or incorrect proportions.`
    : `IMPORTANT: This character's body proportions are intentionally stylized for the art style — do NOT flag muscular or exaggerated builds as anatomy errors.`;

  content.push({
    type: 'text',
    text: `Evaluate this training image for a character LoRA dataset. The character is a ${character.structuredData.gender}, ${character.structuredData.ethnicity}, ${character.structuredData.age} years old, ${character.structuredData.skinTone} skin.

${bodyStyleNote}

Note on skin tone: AI-generated images shift skin tone significantly under different lighting (warm golden hour, cool blue, dramatic side-light). Only flag "correctSkinTone" as false if the skin tone is COMPLETELY wrong (e.g. light skin when it should be dark), not for minor shifts caused by lighting.

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "requirements": {
    "faceVisible": boolean,
    "correctSkinTone": boolean,
    "noAnatomyErrors": boolean,
    "correctBodyProportions": boolean,
    "imageSharp": boolean
  },
  "quality": {
    "expressionNatural": 0-10,
    "poseNatural": 0-10,
    "lightingQuality": 0-10,
    "backgroundClean": 0-10,
    "hairAccurate": 0-10,
    "skinToneConsistency": 0-10,
    "overallAesthetic": 0-10
  },
  "diversityTags": {
    "angle": "front"|"three-quarter"|"side-profile"|"over-shoulder"|"high-angle"|"low-angle",
    "framing": "close-up"|"upper-body"|"medium-shot"|"full-body",
    "expression": "neutral"|"smiling"|"serious"|"suggestive"|"other",
    "lighting": "daylight"|"warm-indoor"|"dramatic-side"|"low-light",
    "clothingState": "formal"|"casual"|"revealing"|"intimate"
  },
  "issues": ["list of specific problems, e.g. 'face not visible', 'extra limb on left side', 'blurry image', 'hair color wrong - shows brown instead of black'. Do NOT list intentional body proportions as issues."]
}`,
  });

  try {
    const response = await anthropicCreateWithRetry(anthropic, {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    // Extract JSON from potential markdown fences
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return makeFailingEvaluation(img.id);

    const parsed = JSON.parse(jsonMatch[0]);
    return { imageId: img.id, ...parsed } as TrainingImageEvaluation;
  } catch (err) {
    console.warn(`[PonyPipeline] Eval failed for ${img.id}: ${err}`);
    return makeFailingEvaluation(img.id);
  }
}

function makeFailingEvaluation(imageId: string): TrainingImageEvaluation {
  return {
    imageId,
    requirements: {
      faceVisible: false, correctSkinTone: false, noAnatomyErrors: false,
      correctBodyProportions: false, imageSharp: false,
    },
    quality: {
      expressionNatural: 0, poseNatural: 0, lightingQuality: 0,
      backgroundClean: 0, hairAccurate: 0, overallAesthetic: 0,
    },
    diversityTags: {
      angle: 'front', framing: 'close-up', expression: 'neutral',
      lighting: 'daylight', clothingState: 'casual',
    },
  };
}

/**
 * Generate captions for approved dataset images using Claude Vision + caption builder.
 */
async function captionApprovedImages(
  loraId: string,
  character: CharacterInput,
  config: PonyLoraTrainingConfig,
  deps: PipelineDeps,
): Promise<void> {
  const { data: images } = await deps.supabase
    .from('lora_dataset_images')
    .select('*')
    .eq('lora_id', loraId)
    .eq('eval_status', 'passed')
    .is('caption', null);

  if (!images || images.length === 0) {
    console.log('[PonyPipeline] No images need captioning');
    return;
  }

  const anthropic = new Anthropic();
  const charIdentity: CharacterIdentity = {
    name: character.characterName,
    triggerWord: config.triggerWord,
    hairColor: character.structuredData.hairColor,
    hairStyle: character.structuredData.hairStyle,
    eyeColor: character.structuredData.eyeColor,
    skinTone: character.structuredData.skinTone,
    bodyType: character.structuredData.bodyType,
    ethnicity: character.structuredData.ethnicity,
  };

  for (const img of images) {
    try {
      const imageBase64 = await imageUrlToBase64(img.image_url);

      // Get raw tags from Claude Vision
      const response = await anthropicCreateWithRetry(anthropic, {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBase64 } },
            { type: 'text', text: 'List booru-style tags for this image. Include: character count (1girl/1boy), pose, expression, clothing, setting, lighting, angle, framing. Output comma-separated tags only, no explanation.' },
          ],
        }],
      });

      const rawTags = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
      const caption = buildTrainingCaption(rawTags, charIdentity);

      await deps.supabase
        .from('lora_dataset_images')
        .update({ caption })
        .eq('id', img.id);

      console.log(`[PonyPipeline] Captioned ${img.id}: ${caption.substring(0, 60)}...`);
    } catch (err) {
      console.warn(`[PonyPipeline] Caption failed for ${img.id}: ${err}`);
    }
  }
}

/**
 * Package approved+captioned images into a tar.gz and upload to Supabase Storage.
 * Returns a signed download URL for the training pod.
 */
async function packageDataset(loraId: string, deps: PipelineDeps): Promise<string> {
  const { data: images } = await deps.supabase
    .from('lora_dataset_images')
    .select('id, image_url, storage_path, caption')
    .eq('lora_id', loraId)
    .eq('eval_status', 'passed')
    .not('caption', 'is', null);

  if (!images || images.length === 0) {
    throw new Error('No captioned images available for packaging');
  }

  // Download all images
  const entries: Array<{ index: number; buffer: Buffer; caption: string }> = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    try {
      const resp = await fetch(img.image_url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buffer = Buffer.from(await resp.arrayBuffer());
      entries.push({ index: i, buffer, caption: img.caption });
    } catch (err) {
      console.warn(`[PonyPipeline] Failed to download ${img.id}: ${err}`);
    }
  }

  if (entries.length === 0) {
    throw new Error('Failed to download any images for packaging');
  }

  // Create tar.gz in memory
  const tarBuffer = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const passthrough = new PassThrough();
    passthrough.on('data', (chunk: Buffer) => chunks.push(chunk));
    passthrough.on('end', () => resolve(Buffer.concat(chunks)));
    passthrough.on('error', reject);

    const archive = archiver('tar', { gzip: true });
    archive.on('error', reject);
    archive.pipe(passthrough);

    for (const entry of entries) {
      const name = String(entry.index).padStart(4, '0');
      archive.append(entry.buffer, { name: `${name}.png` });
      archive.append(entry.caption, { name: `${name}.txt` });
    }

    archive.finalize();
  });

  // Upload to Supabase Storage
  const storagePath = `pony/${loraId}.tar.gz`;
  const { error: uploadErr } = await deps.supabase.storage
    .from(DATASET_BUCKET)
    .upload(storagePath, tarBuffer, {
      contentType: 'application/gzip',
      upsert: true,
    });

  if (uploadErr) {
    throw new Error(`Dataset upload failed: ${uploadErr.message}`);
  }

  // Generate a signed URL (2 hour expiry — enough for pod startup + download)
  const { data: signedData, error: signErr } = await deps.supabase.storage
    .from(DATASET_BUCKET)
    .createSignedUrl(storagePath, 7200);

  if (signErr || !signedData?.signedUrl) {
    throw new Error(`Failed to create signed URL: ${signErr?.message}`);
  }

  console.log(`[PonyPipeline] Dataset: ${entries.length} images, ${(tarBuffer.length / 1024 / 1024).toFixed(1)}MB`);
  return signedData.signedUrl;
}

/**
 * Create a RunPod GPU pod for Kohya training.
 */
async function createTrainingPodForLora(
  loraId: string,
  config: PonyLoraTrainingConfig,
  datasetUrl: string,
  deps: PipelineDeps,
): Promise<void> {
  // Generate a signed upload URL for the trained LoRA output
  const loraFilename = `lora_${config.triggerWord}_${Date.now()}.safetensors`;
  const loraStoragePath = `characters/${loraFilename}`;
  const { data: uploadData, error: uploadErr } = await deps.supabase.storage
    .from(IMAGES_BUCKET)
    .createSignedUploadUrl(`lora-datasets/${loraStoragePath}`);

  if (uploadErr || !uploadData) {
    throw new Error(`Failed to create upload URL: ${uploadErr?.message}`);
  }

  const appUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://nosafeword.co.za';
  const webhookUrl = `${appUrl}/api/lora-training-webhook`;
  const webhookSecret = process.env.TRAINING_WEBHOOK_SECRET || '';

  const { podId } = await createTrainingPod({
    name: `kohya-${config.triggerWord}-${Date.now()}`,
    dockerImage: KOHYA_DOCKER_IMAGE,
    volumeKey: process.env.RUNPOD_NETWORK_VOLUME_ID,
    volumeMountPath: '/workspace',
    env: {
      DATASET_URL: datasetUrl,
      CHECKPOINT_PATH: '/workspace/models/checkpoints/CyberRealistic_PonySemi_V4.5.safetensors',
      TRIGGER_WORD: config.triggerWord,
      LORA_ID: loraId,
      OUTPUT_UPLOAD_URL: uploadData.signedUrl,
      WEBHOOK_URL: webhookUrl,
      WEBHOOK_SECRET: webhookSecret,
      TRAINING_CONFIG_JSON: JSON.stringify({
        networkDim: config.networkDim,
        networkAlpha: config.networkAlpha,
        epochs: config.epochs,
        noiseOffset: config.noiseOffset,
        resolution: config.resolution,
        clipSkip: config.clipSkip,
      }),
    },
  });

  // Store pod ID and training params in the LoRA record
  await deps.supabase
    .from('character_loras')
    .update({
      training_id: podId,
      training_provider: 'runpod-kohya',
      filename: loraFilename,
      storage_path: `lora-datasets/${loraStoragePath}`,
      training_params: {
        trigger_word: config.triggerWord,
        steps: 0, // Unknown until training completes
        learning_rate: 1.0,
        lora_rank: config.networkDim,
        batch_size: 2,
        resolution: config.resolution,
        lr_scheduler: 'cosine_with_restarts',
      },
    })
    .eq('id', loraId);

  console.log(`[PonyPipeline] Training pod created: ${podId}`);
}
