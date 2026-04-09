/**
 * SDXL Character LoRA Training Pipeline.
 *
 * Orchestrates: dataset generation → evaluation → captioning → packaging → Kohya training → validation.
 *
 * Training runs on RunPod GPU pods via Kohya sd-scripts (NOT serverless).
 * The orchestrator creates the pod and returns — the pod POSTs a webhook on completion,
 * which triggers validation and deployment via completeTrainingPipeline().
 *
 * See docs/skills/sdxl-character-lora-training/SKILL.md for the full two-pass training architecture.
 */

import Anthropic from '@anthropic-ai/sdk';
import archiver from 'archiver';
import { PassThrough } from 'stream';

import { generateDataset, generateTopUpImages } from './dataset-generator';
import type { DatasetCharacter } from './dataset-generator';
import { buildQualityPrefix, buildNegativePrompt } from './prompt-builder';
import { buildWorkflow } from './workflow-builder';
import { selectTrainingSet, passesRequirements, type TrainingImageEvaluation } from './character-lora/training-image-evaluator';
import { buildTrainingCaption, type CharacterIdentity } from './character-lora/training-caption-builder';
import { validateLora, toPipelineValidationResult } from './character-lora-validator';
import { createTrainingPod, terminateTrainingPod } from './runpod-pods';
import { anthropicCreateWithRetry } from './anthropic-retry';
import { imageUrlToBase64, submitRunPodJob, waitForRunPodResult } from './runpod';
import type { CharacterInput, PipelineStatus, LoraDatasetImageRow } from './character-lora/types';
import { PIPELINE_CONFIG } from './character-lora/types';
import { MIN_CATEGORY_COUNTS } from './character-lora/category-minimums';

// ── Existing exports (keep) ──

export interface LoraTrainingConfig {
  characterId: string;
  triggerWord: string;
  baseModel: 'sdxl_base_1.0';
  networkDim: number;
  networkAlpha: number;
  epochs: number;
  noiseOffset: number;
  resolution: number;
  clipSkip: number;
  saveEveryNEpochs: number;
  currentPass: number;
}

export function getRecommendedTrainingConfig(characterName: string): LoraTrainingConfig {
  const trigger = characterName.toLowerCase().replace(/\s+/g, '_') + '_nsw';
  return {
    characterId: '',
    triggerWord: trigger,
    baseModel: 'sdxl_base_1.0',
    networkDim: 32,
    networkAlpha: 16,
    epochs: 12,
    noiseOffset: 0.03,
    resolution: 1024,
    clipSkip: 1,
    saveEveryNEpochs: 2,
    currentPass: 1,
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

const KOHYA_DOCKER_IMAGE = process.env.KOHYA_TRAINER_IMAGE || 'ghcr.io/g858-debug/nsw-kohya-trainer:v5-ragnarok';
const DATASET_BUCKET = 'lora-training-datasets';
const IMAGES_BUCKET = 'story-images';

// ── Status helpers ──

async function setLoraStatus(
  loraId: string,
  status: PipelineStatus,
  extra: Record<string, unknown> = {},
  deps: PipelineDeps,
): Promise<void> {
  const { error } = await deps.supabase
    .from('character_loras')
    .update({ status, ...extra, updated_at: new Date().toISOString() })
    .eq('id', loraId);
  if (error) {
    console.error(`[LoRAPipeline] Failed to set status "${status}" for ${loraId}: ${error.message}`);
    throw new Error(`Failed to update LoRA status to "${status}": ${error.message}`);
  }
}

async function setLoraError(loraId: string, error: string, deps: PipelineDeps): Promise<void> {
  await setLoraStatus(loraId, 'failed', { error }, deps);
}

// ── Main Pipeline ──

/**
 * Run the LoRA training pipeline (stages 1-6).
 *
 * Called fire-and-forget from the train-lora route. Stages 1-3 run synchronously
 * in this process. Stage 3 pauses the pipeline for human approval. After approval,
 * resumeTrainingPipeline() continues from stage 4. Stage 6 creates the training pod
 * and returns — the pod webhook triggers completeTrainingPipeline() for validation.
 */
export async function runTrainingPipeline(
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
  console.log(`[LoRAPipeline] ${isResume ? 'Resuming' : 'Starting'} for ${character.characterName} (loraId: ${loraId}, status: ${currentStatus}, trigger: ${config.triggerWord})`);

  try {
    // ── Stage 1: Generate dataset (resumable — skips existing images) ──
    if (['pending', 'generating_dataset'].includes(currentStatus)) {
      await setLoraStatus(loraId, 'generating_dataset', {}, deps);
      console.log(`[LoRAPipeline] Stage 1: Generating dataset...`);

      const datasetResult = await generateDataset(character, loraId, deps);
      console.log(`[LoRAPipeline] Generated ${datasetResult.totalGenerated} images, ${datasetResult.failedPrompts.length} failed`);

      await setLoraStatus(loraId, 'generating_dataset', {
        dataset_size: datasetResult.totalGenerated,
      }, deps);
    } else {
      console.log(`[LoRAPipeline] Skipping Stage 1 (already at ${currentStatus})`);
    }

    // ── Stage 2: Evaluate images (resumable — only evaluates pending images) ──
    if (['pending', 'generating_dataset', 'evaluating'].includes(currentStatus)) {
      await setLoraStatus(loraId, 'evaluating', {}, deps);
      console.log(`[LoRAPipeline] Stage 2: Evaluating dataset images...`);

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
      console.log(`[LoRAPipeline] Initial evaluation: ${initialPassed}/${evaluations.length} passed`);

      // Retry failed images with improved prompts (up to 3 rounds)
      if (initialPassed < PIPELINE_CONFIG.targetPassedImages) {
        console.log(`[LoRAPipeline] Need ${PIPELINE_CONFIG.targetPassedImages}, have ${initialPassed}. Retrying failed images with improved prompts...`);
        const retryEvals = await retryFailedImages(loraId, character, deps);
        evaluations = evaluations.concat(retryEvals);
      }

      // Auto top-up: if still below target after retries, generate fresh images for deficit categories.
      // Must check BOTH score threshold AND hard requirements (faceVisible, noAnatomyErrors, imageSharp)
      // since selectTrainingSet filters by hard requirements too.
      const passedAfterRetries = evaluations.filter(e =>
        calculateSimpleScore(e) >= PIPELINE_CONFIG.minEvalScore && passesRequirements(e)
      ).length;
      if (passedAfterRetries < PIPELINE_CONFIG.minPassedImages) {
        console.log(`[LoRAPipeline] After retries: ${passedAfterRetries} passed hard+score check (need ${PIPELINE_CONFIG.minPassedImages}). Auto-generating top-up images...`);

        // Calculate total shortfall and generate 3x to account for ~30-50% hard requirement failure rate.
        // Spread across categories weighted by category minimums. Face close-ups have best success rate
        // (no hands/body to get wrong), so weight them more heavily.
        const totalNeeded = PIPELINE_CONFIG.minPassedImages - passedAfterRetries;
        const generateCount = Math.max(totalNeeded * 3, 10); // At least 10, or 3x shortfall
        const deficits: Array<{ category: string; needed: number }> = [
          { category: 'face-closeup', needed: Math.ceil(generateCount * 0.35) },
          { category: 'head-shoulders', needed: Math.ceil(generateCount * 0.30) },
          { category: 'full-body', needed: Math.ceil(generateCount * 0.20) },
          { category: 'waist-up', needed: Math.ceil(generateCount * 0.15) },
        ];
        console.log(`[LoRAPipeline] Top-up: shortfall=${totalNeeded}, generating ${generateCount} images across categories`);

        if (deficits.length > 0) {
          const topUpResult = await generateTopUpImages(character, loraId, deficits, deps);
          console.log(`[LoRAPipeline] Top-up generated: ${topUpResult.generated} images (${topUpResult.failed} failed)`);

          // Evaluate the new top-up images
          const topUpEvals = await evaluateDatasetImages(loraId, character, deps);
          for (const eval_ of topUpEvals) {
            const score = calculateSimpleScore(eval_);
            const passed = score >= PIPELINE_CONFIG.minEvalScore;
            await deps.supabase
              .from('lora_dataset_images')
              .update({ eval_status: passed ? 'passed' : 'failed' })
              .eq('id', eval_.imageId);
          }
          evaluations = evaluations.concat(topUpEvals);

          const passedAfterTopUp = evaluations.filter(e => calculateSimpleScore(e) >= PIPELINE_CONFIG.minEvalScore).length;
          console.log(`[LoRAPipeline] After top-up: ${passedAfterTopUp} passed total`);
        }
      }

      // Final curation
      const allPassingEvals = evaluations.filter(e => calculateSimpleScore(e) >= PIPELINE_CONFIG.minEvalScore);
      const { selected, rejected, diversityCoverage, warnings } = selectTrainingSet(allPassingEvals);

      console.log(`[LoRAPipeline] Final: ${selected.length} selected, ${rejected.length} rejected (after retries)`);
      if (warnings.length > 0) {
        console.warn(`[LoRAPipeline] Warnings: ${warnings.join('; ')}`);
      }
      if (!diversityCoverage.met) {
        console.warn(`[LoRAPipeline] Missing diversity: ${diversityCoverage.missing.join(', ')}`);
      }

      // Update eval_status for final selection.
      // 'passed'   = selected for training
      // 'replaced' = passed quality evaluation but culled by diversity selection
      // 'failed'   = genuinely failed quality evaluation (score below threshold)
      const selectedIds = new Set(selected.map(e => e.imageId));
      const { data: allImages } = await deps.supabase
        .from('lora_dataset_images')
        .select('id, eval_score')
        .eq('lora_id', loraId);

      if (allImages) {
        for (const img of allImages) {
          let evalStatus: string;
          if (selectedIds.has(img.id)) {
            evalStatus = 'passed';
          } else if ((img.eval_score || 0) >= PIPELINE_CONFIG.minEvalScore) {
            evalStatus = 'replaced'; // Passed quality, culled by diversity curation
          } else {
            evalStatus = 'failed';
          }
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

      // ── Category balance check: ensure enough face and body shots ──
      const { data: selectedWithCategory } = await deps.supabase
        .from('lora_dataset_images')
        .select('id, category')
        .eq('lora_id', loraId)
        .eq('eval_status', 'passed');

      if (selectedWithCategory) {
        const categoryCounts: Record<string, number> = {};
        for (const img of selectedWithCategory) {
          categoryCounts[img.category] = (categoryCounts[img.category] || 0) + 1;
        }

        const categoryWarnings: string[] = [];
        for (const [cat, minCount] of Object.entries(MIN_CATEGORY_COUNTS)) {
          const actual = categoryCounts[cat] || 0;
          if (actual < minCount) {
            categoryWarnings.push(`${cat}: need ${minCount}, have ${actual}`);
          }
        }

        if (categoryWarnings.length > 0) {
          console.warn(`[LoRAPipeline] Category gaps: ${categoryWarnings.join('; ')}`);
          await setLoraStatus(loraId, 'awaiting_dataset_approval', {
            error: `Category gaps: ${categoryWarnings.join('; ')}. Use "Generate More" to fill gaps or continue anyway.`,
          }, deps);
        } else {
          console.log(`[LoRAPipeline] Category balance OK: ${JSON.stringify(categoryCounts)}`);
          await setLoraStatus(loraId, 'awaiting_dataset_approval', {}, deps);
        }
      }

      // ── Stage 3: Await human approval ──
      console.log(`[LoRAPipeline] Stage 3: Pausing for human dataset approval. ${selected.length} images ready for review.`);
    } else {
      console.log(`[LoRAPipeline] Skipping Stages 2-3 (already at ${currentStatus})`);
    }
    // Pipeline STOPS here. Human uses the approve-dataset route, then
    // calls resume-training to continue from stage 4.
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[LoRAPipeline] Failed: ${msg}`);
    await setLoraError(loraId, msg, deps);
  }
}

/**
 * Resume the pipeline after human dataset approval (stages 4-6).
 * Called by the resume-training API route.
 */
export async function resumeTrainingPipeline(
  character: CharacterInput,
  loraId: string,
  deps: PipelineDeps,
): Promise<void> {
  const config = getRecommendedTrainingConfig(character.characterName);
  config.characterId = character.characterId;

  // Check current status for resumability
  const { data: currentLora } = await deps.supabase
    .from('character_loras')
    .select('status')
    .eq('id', loraId)
    .single();
  const currentStatus = (currentLora as any)?.status || 'captioning';

  console.log(`[LoRAPipeline] Resuming for ${character.characterName} (status: ${currentStatus})`);

  try {
    // Determine if this is a Pass 2 resume
    const { data: loraRecord } = await deps.supabase
      .from('character_loras')
      .select('training_params')
      .eq('id', loraId)
      .single();
    const trainingParams = (loraRecord as any)?.training_params || {};
    const isPass2 = currentStatus.includes('pass2') || Number(trainingParams.currentPass) === 2;

    const captionStatuses = isPass2
      ? ['awaiting_pass2_approval', 'captioning_pass2', 'failed']
      : ['awaiting_dataset_approval', 'captioning', 'failed'];
    const captionStatus = isPass2 ? 'captioning_pass2' : 'captioning';
    const trainingStatus = isPass2 ? 'training_pass2' : 'training';

    // Update config pass number
    if (isPass2) config.currentPass = 2;

    // ── Caption images (resumable — only captions images with null caption) ──
    if (captionStatuses.includes(currentStatus)) {
      await setLoraStatus(loraId, captionStatus, {}, deps);
      console.log(`[LoRAPipeline] Captioning approved images (Pass ${config.currentPass})...`);
      const prefix = isPass2 ? 'p2_' : undefined;
      await captionApprovedImages(loraId, character, config, deps, prefix);
    } else {
      console.log(`[LoRAPipeline] Skipping captioning (already at ${currentStatus})`);
    }

    // ── Package dataset ──
    console.log(`[LoRAPipeline] Packaging dataset (Pass ${config.currentPass})...`);

    const prefix = isPass2 ? 'p2_' : undefined;
    const datasetUrl = await packageDataset(loraId, deps, prefix);
    console.log(`[LoRAPipeline] Dataset packaged: ${datasetUrl}`);

    // ── Create training pod ──
    await setLoraStatus(loraId, trainingStatus, {}, deps);
    console.log(`[LoRAPipeline] Creating training pod (Pass ${config.currentPass})...`);

    await createTrainingPodForLora(loraId, config, datasetUrl, deps);
    console.log(`[LoRAPipeline] Training pod created. Pipeline will resume via webhook.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[LoRAPipeline] Resume failed: ${msg}`);
    await setLoraError(loraId, msg, deps);
  }
}

/**
 * Complete the pipeline after training pod finishes (stages 7-8).
 * Called by the lora-training-webhook route.
 */
export async function completeTrainingPipeline(
  loraId: string,
  deps: PipelineDeps,
): Promise<void> {
  console.log(`[LoRAPipeline] Completing pipeline for loraId: ${loraId}`);

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

    // Guard: don't overwrite a LoRA that's already deployed or archived
    if (lora.status === 'deployed' || lora.status === 'archived') {
      console.log(`[LoRAPipeline] LoRA ${loraId} is already ${lora.status} — skipping stale validation.`);
      return;
    }

    // Fetch the character for validation
    const { data: charRows } = await deps.supabase
      .from('story_characters')
      .select('id, character_id, approved_image_id, characters(id, name, description)')
      .eq('character_id', lora.character_id)
      .limit(1);

    const storyChar = charRows?.[0];
    if (!storyChar) {
      throw new Error(`Story character not found for character_id: ${lora.character_id}`);
    }

    // Get an approved portrait URL for face comparison
    const charName = (storyChar.characters as any)?.name || lora.character_id;

    if (!storyChar.approved_image_id) {
      throw new Error(
        `No approved_image_id for "${charName}". ` +
        `Approve a portrait image before running validation.`
      );
    }

    const { data: portraitImg } = await deps.supabase
      .from('images')
      .select('stored_url, sfw_url')
      .eq('id', storyChar.approved_image_id)
      .single();

    const approvedUrl = portraitImg?.sfw_url || portraitImg?.stored_url;

    if (!approvedUrl) {
      throw new Error(
        `No approved portrait URL for "${charName}". ` +
        `Image record exists but has no stored_url or sfw_url (approved_image_id: ${storyChar.approved_image_id}).`
      );
    }

    // Normalize storage_url — the pod may have stored a bucket path instead of a URL.
    // Example bad value: "lora-training-datasets/trained/characters/lora_xxx.safetensors"
    let loraStorageUrl: string = lora.storage_url || '';
    if (loraStorageUrl && !loraStorageUrl.startsWith('https://')) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      loraStorageUrl = `${supabaseUrl}/storage/v1/object/public/lora-training-datasets/${lora.storage_path}`;
      console.log(`[LoRAPipeline] Normalized storage URL from path: ${loraStorageUrl}`);
    }
    if (!loraStorageUrl) {
      throw new Error(`LoRA "${lora.filename}" has no download URL. Re-upload the trained file.`);
    }

    // ── Stage 7: Validate ──
    await setLoraStatus(loraId, 'validating', {}, deps);
    console.log(`[LoRAPipeline] Stage 7: Validating trained LoRA...`);

    const desc = storyChar.characters?.description as Record<string, string> || {};
    const validationResult = await validateLora(
      { gender: desc.gender || 'female', approvedImageUrl: approvedUrl },
      lora.filename,
      loraStorageUrl,
      lora.trigger_word,
      loraId,
      deps,
    );

    const pipelineResult = toPipelineValidationResult(validationResult);

    if (pipelineResult.overallPass) {
      const trainingParams = lora.training_params as Record<string, unknown> || {};
      const currentPass = Number(trainingParams.currentPass) || 1;

      if (currentPass === 1) {
        // ── Pass 1 validated — start Pass 2 ──
        const score = pipelineResult.averageFaceScore.toFixed(1);
        console.log(`[LoRAPipeline] Pass 1 validated (score: ${score}). Starting Pass 2...`);
        await setLoraStatus(loraId, 'generating_pass2_dataset', {
          validation_score: pipelineResult.averageFaceScore,
          training_params: { ...trainingParams, pass1Score: pipelineResult.averageFaceScore },
        }, deps);

        // Fire-and-forget: generate Pass 2 dataset using the Pass 1 LoRA
        void runPass2Pipeline(loraId, lora, storyChar, deps).catch(err => {
          console.error(`[LoRAPipeline] Pass 2 failed:`, err);
          setLoraError(loraId, `Pass 2 failed: ${err instanceof Error ? err.message : String(err)}`, deps);
        });
      } else {
        // ── Pass 2 validated — deploy ──
        await setLoraStatus(loraId, 'deployed', {
          validation_score: pipelineResult.averageFaceScore,
          deployed_at: new Date().toISOString(),
        }, deps);
        console.log(`[LoRAPipeline] Pass 2 LoRA deployed! Score: ${pipelineResult.averageFaceScore.toFixed(1)}`);
      }
    } else {
      const attempts = (lora.training_attempts || 0) + 1;
      if (attempts < PIPELINE_CONFIG.maxTrainingAttempts) {
        console.warn(`[LoRAPipeline] Validation failed (attempt ${attempts}/${PIPELINE_CONFIG.maxTrainingAttempts}). Will retry.`);
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
        console.error(`[LoRAPipeline] Validation failed after max attempts.`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[LoRAPipeline] Completion failed: ${msg}`);
    await setLoraError(loraId, msg, deps);
  }
}

// ── Pass 2 Pipeline ──

/**
 * Run the second-pass dataset generation using the Pass 1 LoRA.
 * Generates 34 new images with the Pass 1 LoRA injected at low strength (0.4),
 * producing more diverse training data. Mirrors stages 1-3 of runTrainingPipeline.
 */
async function runPass2Pipeline(
  loraId: string,
  lora: any,
  storyChar: any,
  deps: PipelineDeps,
): Promise<void> {
  const charName = (storyChar.characters as any)?.name || lora.character_id;
  const desc = (storyChar.characters as any)?.description as Record<string, string> || {};

  // Build CharacterInput for Pass 2 dataset generation
  const structuredData = {
    gender: desc.gender || 'female',
    ethnicity: desc.ethnicity || '',
    bodyType: desc.bodyType || '',
    skinTone: desc.skinTone || '',
    hairColor: desc.hairColor || '',
    hairStyle: desc.hairStyle || '',
    eyeColor: desc.eyeColor || '',
    age: desc.age || '',
    distinguishingFeatures: desc.distinguishingFeatures || '',
    loraBodyWeight: desc.loraBodyWeight,
    loraBubbleButt: desc.loraBubbleButt,
    loraBreastSize: desc.loraBreastSize,
  };

  // Get approved portrait URL for evaluation comparison
  const { data: portraitImg } = await deps.supabase
    .from('images')
    .select('stored_url, sfw_url')
    .eq('id', storyChar.approved_image_id)
    .single();
  const approvedUrl = portraitImg?.sfw_url || portraitImg?.stored_url || '';

  const character: CharacterInput = {
    characterId: lora.character_id,
    characterName: charName,
    gender: desc.gender || 'female',
    approvedImageUrl: approvedUrl,
    approvedPrompt: '',
    fullBodyImageUrl: '',
    fullBodySeed: 42,
    portraitSeed: 1042, // Offset seeds for Pass 2 variety
    structuredData: structuredData as any,
    pipelineType: 'story_character',
    imageEngine: 'juggernaut_ragnarok',
  };

  // Normalize LoRA storage URL
  let loraStorageUrl = lora.storage_url || '';
  if (loraStorageUrl && !loraStorageUrl.startsWith('https://')) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    loraStorageUrl = `${supabaseUrl}/storage/v1/object/public/lora-training-datasets/${lora.storage_path}`;
  }

  const pass1Lora = {
    filename: `characters/${lora.filename}`,
    url: loraStorageUrl,
    strength: 0.4,
  };

  console.log(`[LoRAPipeline] Pass 2: Generating dataset with Pass 1 LoRA at strength ${pass1Lora.strength}...`);

  try {
    // ── Stage 8: Generate Pass 2 dataset ──
    const datasetResult = await generateDataset(character, loraId, deps, pass1Lora, 'p2_');
    console.log(`[LoRAPipeline] Pass 2: Generated ${datasetResult.totalGenerated} images`);

    // ── Stage 9: Evaluate Pass 2 images ──
    await setLoraStatus(loraId, 'evaluating_pass2', {
      dataset_size: datasetResult.totalGenerated,
    }, deps);
    console.log(`[LoRAPipeline] Pass 2: Evaluating dataset images...`);

    let evaluations = await evaluateDatasetImages(loraId, character, deps);

    for (const eval_ of evaluations) {
      const score = calculateSimpleScore(eval_);
      const passed = score >= PIPELINE_CONFIG.minEvalScore;
      await deps.supabase
        .from('lora_dataset_images')
        .update({ eval_status: passed ? 'passed' : 'failed' })
        .eq('id', eval_.imageId);
    }

    const initialPassed = evaluations.filter(e => calculateSimpleScore(e) >= PIPELINE_CONFIG.minEvalScore).length;
    console.log(`[LoRAPipeline] Pass 2: ${initialPassed}/${evaluations.length} passed evaluation`);

    // Retry failed images
    if (initialPassed < PIPELINE_CONFIG.targetPassedImages) {
      const retryEvals = await retryFailedImages(loraId, character, deps, 'p2_');
      evaluations = evaluations.concat(retryEvals);
    }

    // Auto top-up for Pass 2: if still below target, generate fresh images.
    // Check both score AND hard requirements (selectTrainingSet filters by both).
    const passedAfterRetries = evaluations.filter(e =>
      calculateSimpleScore(e) >= PIPELINE_CONFIG.minEvalScore && passesRequirements(e)
    ).length;
    if (passedAfterRetries < PIPELINE_CONFIG.minPassedImages) {
      console.log(`[LoRAPipeline] Pass 2: After retries: ${passedAfterRetries} passed hard+score check (need ${PIPELINE_CONFIG.minPassedImages}). Auto top-up...`);

      const totalNeeded = PIPELINE_CONFIG.minPassedImages - passedAfterRetries;
      const generateCount = Math.max(totalNeeded * 3, 10);
      const deficits: Array<{ category: string; needed: number }> = [
        { category: 'face-closeup', needed: Math.ceil(generateCount * 0.35) },
        { category: 'head-shoulders', needed: Math.ceil(generateCount * 0.30) },
        { category: 'full-body', needed: Math.ceil(generateCount * 0.20) },
        { category: 'waist-up', needed: Math.ceil(generateCount * 0.15) },
      ];
      console.log(`[LoRAPipeline] Pass 2 top-up: shortfall=${totalNeeded}, generating ${generateCount} images`);

      if (deficits.length > 0) {
        const topUpResult = await generateTopUpImages(character, loraId, deficits, deps);
        console.log(`[LoRAPipeline] Pass 2 top-up: ${topUpResult.generated} generated, ${topUpResult.failed} failed`);

        const topUpEvals = await evaluateDatasetImages(loraId, character, deps);
        for (const eval_ of topUpEvals) {
          const score = calculateSimpleScore(eval_);
          const passed = score >= PIPELINE_CONFIG.minEvalScore;
          await deps.supabase
            .from('lora_dataset_images')
            .update({ eval_status: passed ? 'passed' : 'failed' })
            .eq('id', eval_.imageId);
        }
        evaluations = evaluations.concat(topUpEvals);
        console.log(`[LoRAPipeline] Pass 2 after top-up: ${evaluations.filter(e => calculateSimpleScore(e) >= PIPELINE_CONFIG.minEvalScore).length} passed total`);
      }
    }

    // Final curation
    const allPassingEvals = evaluations.filter(e => calculateSimpleScore(e) >= PIPELINE_CONFIG.minEvalScore);
    const { selected, rejected, diversityCoverage, warnings } = selectTrainingSet(allPassingEvals);
    console.log(`[LoRAPipeline] Pass 2: ${selected.length} selected, ${rejected.length} rejected`);

    // Update eval_status for final selection — scoped to Pass 2 images only.
    const selectedIds = new Set(selected.map(e => e.imageId));
    const { data: allImages } = await deps.supabase
      .from('lora_dataset_images')
      .select('id, eval_score, prompt_template')
      .eq('lora_id', loraId);

    if (allImages) {
      const pass2Images = allImages.filter((img: any) =>
        (img.prompt_template || '').startsWith('p2_')
      );
      for (const img of pass2Images) {
        let evalStatus: string;
        if (selectedIds.has(img.id)) {
          evalStatus = 'passed';
        } else if ((img.eval_score || 0) >= PIPELINE_CONFIG.minEvalScore) {
          evalStatus = 'replaced';
        } else {
          evalStatus = 'failed';
        }
        await deps.supabase
          .from('lora_dataset_images')
          .update({ eval_status: evalStatus })
          .eq('id', img.id);
      }
    }

    if (selected.length < PIPELINE_CONFIG.minPassedImages) {
      throw new Error(
        `Pass 2: Only ${selected.length} images passed (need ${PIPELINE_CONFIG.minPassedImages}).`
      );
    }

    // ── Category balance check — scoped to Pass 2 images only ──
    const { data: selectedWithCategory } = await deps.supabase
      .from('lora_dataset_images')
      .select('id, category, prompt_template')
      .eq('lora_id', loraId)
      .eq('eval_status', 'passed');

    if (selectedWithCategory) {
      // Only count Pass 2 images for the category balance check
      const pass2Selected = selectedWithCategory.filter(
        (img: any) => (img.prompt_template || '').startsWith('p2_')
      );
      const categoryCounts: Record<string, number> = {};
      for (const img of pass2Selected) {
        categoryCounts[img.category] = (categoryCounts[img.category] || 0) + 1;
      }
      const gaps = Object.entries(MIN_CATEGORY_COUNTS)
        .filter(([cat, min]) => (categoryCounts[cat] || 0) < min)
        .map(([cat, min]) => `${cat}: need ${min}, have ${categoryCounts[cat] || 0}`);
      if (gaps.length > 0) {
        console.warn(`[LoRAPipeline] Pass 2 category gaps: ${gaps.join('; ')}`);
        await setLoraStatus(loraId, 'awaiting_pass2_approval', {
          error: `Category gaps: ${gaps.join('; ')}. Use "Generate More" to fill gaps or continue anyway.`,
        }, deps);
      } else {
        console.log(`[LoRAPipeline] Pass 2 category balance OK: ${JSON.stringify(categoryCounts)}`);
        await setLoraStatus(loraId, 'awaiting_pass2_approval', {}, deps);
      }
    }

    // ── Stage 10: Await human approval ──
    console.log(`[LoRAPipeline] Pass 2: ${selected.length} images ready for review.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[LoRAPipeline] Pass 2 failed: ${msg}`);
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
    console.warn('[LoRAPipeline] Could not fetch reference image for evaluation');
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
        const hardPass = passesRequirements(evaluation);
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
              // Store hard requirement results for DB-based curation after auto-resume
              face_visible: evaluation.requirements.faceVisible,
              no_anatomy_errors: evaluation.requirements.noAnatomyErrors,
              image_sharp: evaluation.requirements.imageSharp,
              passes_hard_requirements: hardPass,
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

    console.log(`[LoRAPipeline] Evaluated ${Math.min(i + concurrency, images.length)}/${images.length}`);

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
  promptPrefix?: string,
): Promise<TrainingImageEvaluation[]> {
  const endpointId = process.env.RUNPOD_ENDPOINT_ID;
  if (!endpointId) return [];

  const anthropic = new Anthropic();
  let referenceBase64: string | null = null;
  try {
    referenceBase64 = await imageUrlToBase64(character.approvedImageUrl);
  } catch { /* ignore */ }

  const newEvaluations: TrainingImageEvaluation[] = [];

  for (let round = 1; round <= MAX_RETRY_ROUNDS; round++) {
    // Fetch images that failed evaluation (scoped by prompt prefix when provided)
    let failedQuery = deps.supabase
      .from('lora_dataset_images')
      .select('*')
      .eq('lora_id', loraId)
      .eq('eval_status', 'failed');
    if (promptPrefix) {
      failedQuery = failedQuery.like('prompt_template', `${promptPrefix}%`);
    }
    const { data: failedImages } = await failedQuery;

    if (!failedImages || failedImages.length === 0) {
      console.log(`[LoRAPipeline] Retry round ${round}: no failed images left`);
      break;
    }

    // Check if we already have enough passing images (scoped by prefix)
    let passedQuery = deps.supabase
      .from('lora_dataset_images')
      .select('*', { count: 'exact', head: true })
      .eq('lora_id', loraId)
      .eq('eval_status', 'passed');
    if (promptPrefix) {
      passedQuery = passedQuery.like('prompt_template', `${promptPrefix}%`);
    }
    const { count: passedCount } = await passedQuery;

    if ((passedCount || 0) >= PIPELINE_CONFIG.targetPassedImages) {
      console.log(`[LoRAPipeline] Retry round ${round}: already have ${passedCount} passed images, stopping`);
      break;
    }

    console.log(`[LoRAPipeline] Retry round ${round}/${MAX_RETRY_ROUNDS}: ${failedImages.length} failed images to retry`);

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

        console.log(`[LoRAPipeline] Retry ${failedImg.id}: improved prompt for ${failedImg.category}`);

        // Regenerate with improved prompt
        const seed = Math.floor(Math.random() * 2_147_483_647) + 1;
        const qualityPrefix = buildQualityPrefix('sfw');
        const negativePrompt = buildNegativePrompt('sfw');
        const positivePrompt = `${qualityPrefix}, ${improvedPrompt}`;

        // Dimensions based on category
        const dims = failedImg.category === 'face-closeup'
          ? { width: 1024, height: 1024 }
          : { width: 832, height: 1216 };

        const workflow = buildWorkflow({
          positivePrompt,
          negativePrompt,
          ...dims,
          seed,
          filenamePrefix: `dataset_retry_${failedImg.id}`,
        });

        const { jobId } = await submitRunPodJob(workflow, undefined, undefined, endpointId);
        const { imageBase64 } = await waitForRunPodResult(jobId, 300000, 3000, endpointId);

        // Upload replacement image
        const imageBuffer = Buffer.from(imageBase64, 'base64');
        const storagePath = `lora-datasets/${loraId}/retry_${round}_${failedImg.id}.png`;

        const { error: uploadError } = await deps.supabase.storage
          .from('story-images')
          .upload(storagePath, imageBuffer, { contentType: 'image/png', upsert: true });

        if (uploadError) {
          console.warn(`[LoRAPipeline] Upload failed for retry: ${uploadError.message}`);
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
        const hardPass = passesRequirements(evaluation);
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
              face_visible: evaluation.requirements.faceVisible,
              no_anatomy_errors: evaluation.requirements.noAnatomyErrors,
              image_sharp: evaluation.requirements.imageSharp,
              passes_hard_requirements: hardPass,
              reason: `Retry round ${round}: ${passed ? 'improved and passed' : 'still failing'}`,
            },
          })
          .eq('id', failedImg.id);

        if (passed) {
          newEvaluations.push(evaluation);
          console.log(`[LoRAPipeline] Retry SUCCESS: ${failedImg.id} now scores ${score} (was ${failedImg.eval_score})`);
        } else {
          console.log(`[LoRAPipeline] Retry round ${round}: ${failedImg.id} still failing (score ${score}, issues: ${newIssues.join(', ')})`);
        }

        // Small delay between retries
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        console.warn(`[LoRAPipeline] Retry failed for ${failedImg.id}: ${err}`);
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
    console.warn(`[LoRAPipeline] Eval failed for ${img.id}: ${err}`);
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
  config: LoraTrainingConfig,
  deps: PipelineDeps,
  promptPrefix?: string,
): Promise<void> {
  let query = deps.supabase
    .from('lora_dataset_images')
    .select('*')
    .eq('lora_id', loraId)
    .eq('eval_status', 'passed')
    .is('caption', null);
  if (promptPrefix) {
    query = query.like('prompt_template', `${promptPrefix}%`);
  }
  const { data: images } = await query;

  if (!images || images.length === 0) {
    console.log('[LoRAPipeline] No images need captioning');
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

      console.log(`[LoRAPipeline] Captioned ${img.id}: ${caption.substring(0, 60)}...`);

      // Heartbeat every 3 images
      const idx = images.indexOf(img);
      if (idx % 3 === 2 || idx === images.length - 1) {
        await deps.supabase
          .from('character_loras')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', loraId);
      }
    } catch (err) {
      console.warn(`[LoRAPipeline] Caption failed for ${img.id}: ${err}`);
    }
  }
}

/**
 * Package approved+captioned images into a tar.gz and upload to Supabase Storage.
 * Returns a signed download URL for the training pod.
 */
async function packageDataset(loraId: string, deps: PipelineDeps, promptPrefix?: string): Promise<string> {
  let pkgQuery = deps.supabase
    .from('lora_dataset_images')
    .select('id, image_url, storage_path, caption')
    .eq('lora_id', loraId)
    .eq('eval_status', 'passed');
  if (promptPrefix) {
    pkgQuery = pkgQuery.like('prompt_template', `${promptPrefix}%`);
  }
  const { data: images } = await pkgQuery
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
      console.warn(`[LoRAPipeline] Failed to download ${img.id}: ${err}`);
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
  const storagePath = `datasets/${loraId}.tar.gz`;
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

  console.log(`[LoRAPipeline] Dataset: ${entries.length} images, ${(tarBuffer.length / 1024 / 1024).toFixed(1)}MB`);
  return signedData.signedUrl;
}

/**
 * Create a RunPod GPU pod for Kohya training.
 */
async function createTrainingPodForLora(
  loraId: string,
  config: LoraTrainingConfig,
  datasetUrl: string,
  deps: PipelineDeps,
): Promise<void> {
  // Generate a signed upload URL for the trained LoRA output
  const loraFilename = `lora_${config.triggerWord}_${Date.now()}.safetensors`;
  const loraStoragePath = `characters/${loraFilename}`;
  const { data: uploadData, error: uploadErr } = await deps.supabase.storage
    .from(DATASET_BUCKET)
    .createSignedUploadUrl(`trained/${loraStoragePath}`);

  if (uploadErr || !uploadData) {
    throw new Error(`Failed to create upload URL: ${uploadErr?.message}`);
  }

  const appUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://nosafeword.co.za';
  const webhookUrl = `${appUrl}/api/lora-training-webhook`;
  const webhookSecret = process.env.TRAINING_WEBHOOK_SECRET || '';

  const { podId } = await createTrainingPod({
    name: `kohya-${config.triggerWord}-${Date.now()}`,
    dockerImage: KOHYA_DOCKER_IMAGE,
    env: {
      DATASET_URL: datasetUrl,
      CHECKPOINT_PATH: '/workspace/models/checkpoints/sd_xl_base_1.0.safetensors',
      CHECKPOINT_FALLBACK_URL: 'https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors',
      CIVITAI_API_KEY: process.env.CIVITAI_API_KEY || '',
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
        saveEveryNEpochs: config.saveEveryNEpochs,
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
      storage_path: `trained/${loraStoragePath}`,
      training_params: {
        trigger_word: config.triggerWord,
        steps: 0, // Unknown until training completes
        learning_rate: 1.0,
        lora_rank: config.networkDim,
        batch_size: 2,
        resolution: config.resolution,
        lr_scheduler: 'cosine_with_restarts',
        currentPass: config.currentPass,
      },
    })
    .eq('id', loraId);

  console.log(`[LoRAPipeline] Training pod created: ${podId}`);
}
