// Character LoRA Pipeline — Main Orchestrator
// Runs all 6 stages sequentially with retry logic.
// Designed to run as a background job (fire-and-forget from API route).
//
// HYBRID APPROACH:
//   Stage 1: Dataset generation (Nano Banana Pro for face/head + ComfyUI for body)
//   Stage 2: Claude Vision quality evaluation against BOTH reference images
//   Stage 3: Auto-captioning from prompt templates
//   Stage 4: Replicate SDXL LoRA training
//   Stage 5: Validation (generate test images with LoRA, evaluate face consistency)
//   Stage 6: Deploy to Supabase Storage + register in character_loras

import type {
  CharacterInput,
  CharacterLoraRow,
  CaptionResult,
  EvaluationResult,
  LoraDatasetImageRow,
  PipelineProgress,
  VariationType,
} from './types';
import { PIPELINE_CONFIG, DEFAULT_TRAINING_PARAMS } from './types';
import { generateDataset, generateReplacements } from './dataset-generator';
import { evaluateDataset } from './quality-evaluator';
import { generateCaptions } from './caption-generator';
import { trainLora, getRetryParams, getReplicateUsername, ensureReplicateModel } from './trainer';
import { validateLora } from './validator';
import { deployLora } from './deployer';
import Replicate from 'replicate';

type CompletedStage = 'dataset' | 'evaluation' | 'captioning' | 'training' | 'validation';

/** Stage ordering for resume comparison */
const STAGE_ORDER: CompletedStage[] = ['dataset', 'evaluation', 'captioning', 'training', 'validation'];

interface PipelineDeps {
  supabase: {
    from: (table: string) => any;
    storage: { from: (bucket: string) => any };
  };
}

/**
 * Run the full character LoRA training pipeline.
 *
 * This function is designed to be called without await (fire-and-forget).
 * All progress is tracked in the character_loras table.
 *
 * Stage checkpointing: after each stage completes, `completed_stage` is
 * persisted to the DB. If the pipeline is re-invoked for the same loraId,
 * it resumes from the next stage after the checkpoint.
 */
export async function runPipeline(
  character: CharacterInput,
  loraId: string,
  deps: PipelineDeps,
): Promise<void> {
  const startTime = Date.now();

  try {
    // Check for existing checkpoint to enable resume
    const { data: loraRow } = await deps.supabase
      .from('character_loras')
      .select('completed_stage, training_id, training_attempts')
      .eq('id', loraId)
      .single();

    const completedStage = loraRow?.completed_stage as CompletedStage | null;
    const isResume = completedStage !== null;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`[LoRA Pipeline] ${isResume ? 'RESUMING' : 'Starting'} HYBRID pipeline for ${character.characterName}`);
    console.log(`[LoRA Pipeline] LoRA ID: ${loraId}`);
    if (isResume) {
      console.log(`[LoRA Pipeline] Resuming after completed stage: ${completedStage}`);
    }
    console.log(`${'='.repeat(60)}\n`);

    // ── PREFLIGHT: Validate everything before burning API credits ─
    await preflightCheck(character, deps);

    // Helper: should we skip this stage?
    const shouldSkip = (stage: CompletedStage) =>
      completedStage !== null &&
      STAGE_ORDER.indexOf(stage) <= STAGE_ORDER.indexOf(completedStage);

    // ── STAGE 1: Hybrid Dataset Generation ────────────────────
    let passedImages: LoraDatasetImageRow[];
    let passedCount: number;

    if (shouldSkip('evaluation')) {
      // Both dataset + evaluation are done — load passed images from DB
      console.log('[LoRA Pipeline] Skipping dataset generation + evaluation (already checkpointed)');
      const { data: passed } = await deps.supabase
        .from('lora_dataset_images')
        .select('*')
        .eq('lora_id', loraId)
        .eq('eval_status', 'passed');

      passedImages = passed || [];
      passedCount = passedImages.length;
      console.log(`[LoRA Pipeline] Loaded ${passedCount} passed images from DB`);
    } else if (shouldSkip('dataset')) {
      // Dataset exists but evaluation hasn't completed — re-evaluate
      console.log('[LoRA Pipeline] Skipping dataset generation (already checkpointed), re-running evaluation');
      const { data: allImgs } = await deps.supabase
        .from('lora_dataset_images')
        .select('*')
        .eq('lora_id', loraId)
        .in('eval_status', ['pending', 'passed', 'failed']);

      const result = await runEvaluation(character, loraId, allImgs || [], [], deps);
      passedImages = result.passedImages;
      passedCount = result.passed;

      await checkpoint(loraId, 'evaluation', deps);
    } else {
      // Fresh start — generate + evaluate
      await updateStatus(loraId, 'generating_dataset', deps);
      const datasetResult = await generateDataset(character, loraId, deps);

      if (datasetResult.totalGenerated === 0) {
        throw new Error('Dataset generation produced no images');
      }

      console.log(
        `[LoRA Pipeline] Dataset: ${datasetResult.totalGenerated} images generated` +
        (datasetResult.failedPrompts.length > 0
          ? ` (${datasetResult.failedPrompts.length} generation failures will be retried)`
          : '')
      );

      await checkpoint(loraId, 'dataset', deps);

      const result = await runEvaluation(
        character, loraId, datasetResult.imageRecords, datasetResult.failedPrompts, deps,
      );
      passedImages = result.passedImages;
      passedCount = result.passed;

      await checkpoint(loraId, 'evaluation', deps);
    }

    if (passedCount < PIPELINE_CONFIG.minPassedImages) {
      throw new Error(
        `Only ${passedCount} images passed evaluation (minimum ${PIPELINE_CONFIG.minPassedImages} required). ` +
          `Pipeline cannot proceed with insufficient training data.`
      );
    }

    console.log(`[LoRA Pipeline] ${passedCount} images approved for training`);

    // ── STAGE 3: Captioning ──────────────────────────────────
    let captionedImages: CaptionResult['captionedImages'];

    if (shouldSkip('captioning')) {
      console.log('[LoRA Pipeline] Skipping captioning (already checkpointed)');
      const { data: captioned } = await deps.supabase
        .from('lora_dataset_images')
        .select('*')
        .eq('lora_id', loraId)
        .eq('eval_status', 'passed')
        .not('caption', 'is', null);

      captionedImages = (captioned || []).map((img: LoraDatasetImageRow) => ({
        imageUrl: img.image_url,
        caption: img.caption!,
        storagePath: img.storage_path,
      }));
      console.log(`[LoRA Pipeline] Loaded ${captionedImages.length} captioned images from DB`);
    } else {
      await updateStatus(loraId, 'captioning', deps);
      const captionResult = await generateCaptions(passedImages, character.gender, deps);
      captionedImages = captionResult.captionedImages;

      await checkpoint(loraId, 'captioning', deps);
    }

    // ── STAGE 4 & 5: Training + Validation (with retry loop) ─
    let loraBuffer: Buffer | null = null;
    let loraUrl: string | null = null;
    let loraFilename: string | null = null;
    let trainingSuccess = false;

    // If training was already checkpointed, check if the Replicate training succeeded
    if (shouldSkip('training') && loraRow?.training_id) {
      console.log(`[LoRA Pipeline] Checking existing training ${loraRow.training_id}...`);
      const resp = await fetch(`https://api.replicate.com/v1/trainings/${loraRow.training_id}`, {
        headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` },
      });
      const existing = await resp.json();

      if (existing.status === 'succeeded' && existing.output?.weights) {
        loraUrl = existing.output.weights;
        loraBuffer = Buffer.alloc(0);
        loraFilename = `char_${slugify(character.characterName)}_${loraId.slice(0, 8)}.safetensors`;
        trainingSuccess = true;
        console.log(`[LoRA Pipeline] Existing training succeeded, reusing weights`);
      } else {
        console.log(`[LoRA Pipeline] Existing training status: ${existing.status}, retraining...`);
      }
    }

    if (!trainingSuccess) {
      const startAttempt = (loraRow?.training_attempts || 0) + 1;

      for (
        let attempt = startAttempt;
        attempt <= PIPELINE_CONFIG.maxTrainingAttempts && !trainingSuccess;
        attempt++
      ) {
        try {
          await updateStatus(loraId, 'training', deps);

          const paramsOverrides = attempt > 1 ? getRetryParams(attempt) : {};
          const characterSlug = slugify(character.characterName);

          const trainingResult = await trainLora(
            captionedImages,
            characterSlug,
            loraId,
            attempt,
            deps,
            paramsOverrides,
          );

          loraBuffer = trainingResult.loraBuffer;
          loraUrl = trainingResult.loraUrl;

          const tempFilename = `char_${characterSlug}_${loraId.slice(0, 8)}.safetensors`;
          loraFilename = tempFilename;

          await checkpoint(loraId, 'training', deps);

          // Use the Replicate weights URL directly for validation
          await updateStatus(loraId, 'validating', deps);

          const validationResult = await validateLora(
            character,
            tempFilename,
            loraUrl,
            loraId,
            deps,
          );

          if (validationResult.overallPass) {
            trainingSuccess = true;
            await checkpoint(loraId, 'validation', deps);
            console.log(
              `[LoRA Pipeline] Training attempt ${attempt} PASSED validation ` +
                `(avg score: ${validationResult.averageFaceScore.toFixed(1)})`
            );
          } else {
            console.log(
              `[LoRA Pipeline] Training attempt ${attempt} FAILED validation ` +
                `(avg score: ${validationResult.averageFaceScore.toFixed(1)}). ` +
                (attempt < PIPELINE_CONFIG.maxTrainingAttempts
                  ? 'Retrying with adjusted params...'
                  : 'No more attempts.')
            );
          }
        } catch (error) {
          console.error(
            `[LoRA Pipeline] Training attempt ${attempt} error: ${error}`
          );
          if (attempt >= PIPELINE_CONFIG.maxTrainingAttempts) {
            throw error;
          }
        }
      }
    }

    if (!trainingSuccess || !loraFilename || !loraUrl) {
      throw new Error(
        `LoRA training failed after ${PIPELINE_CONFIG.maxTrainingAttempts} attempts`
      );
    }

    // ── STAGE 6: Deployment ──────────────────────────────────
    const deployResult = await deployLora(
      loraBuffer || Buffer.alloc(0),
      character.characterId,
      character.characterName,
      loraId,
      passedCount,
      deps,
      loraUrl,
    );

    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`\n${'='.repeat(60)}`);
    console.log(
      `[LoRA Pipeline] COMPLETE for ${character.characterName} in ${elapsed} minutes`
    );
    console.log(
      `[LoRA Pipeline] File: ${deployResult.filename} (${(deployResult.fileSizeBytes / 1024 / 1024).toFixed(1)}MB)`
    );
    console.log(`${'='.repeat(60)}\n`);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    console.error(`[LoRA Pipeline] FAILED: ${errorMessage}`);

    await deps.supabase
      .from('character_loras')
      .update({
        status: 'failed',
        error: errorMessage,
      })
      .eq('id', loraId);
  }
}

/**
 * Run evaluation with replacement loop.
 * Extracted so it can be called both from fresh runs and from checkpoint resume.
 */
async function runEvaluation(
  character: CharacterInput,
  loraId: string,
  imageRecords: LoraDatasetImageRow[],
  failedPrompts: Array<{ promptTemplate: string; variationType: VariationType; source: string }>,
  deps: PipelineDeps,
): Promise<EvaluationResult> {
  await updateStatus(loraId, 'evaluating', deps);

  let allImages = [...imageRecords];
  let evalResult = await evaluateDataset(
    character.approvedImageUrl,
    character.fullBodyImageUrl,
    allImages,
    deps,
  );

  let pendingGenerationFailures = [...failedPrompts];

  for (
    let round = 0;
    round < PIPELINE_CONFIG.maxReplacementRounds &&
    evalResult.passed < PIPELINE_CONFIG.targetPassedImages;
    round++
  ) {
    console.log(
      `[LoRA Pipeline] Replacement round ${round + 1}: ${evalResult.passed} passed, need ${PIPELINE_CONFIG.targetPassedImages}` +
      (pendingGenerationFailures.length > 0
        ? ` (+ ${pendingGenerationFailures.length} generation retries)`
        : '')
    );

    const evalFailures = allImages
      .filter((img) => !evalResult.passedImages.some((p) => p.id === img.id))
      .map((img) => ({
        promptTemplate: img.prompt_template,
        variationType: img.variation_type as VariationType,
      }));

    for (const img of allImages) {
      if (!evalResult.passedImages.some((p) => p.id === img.id)) {
        await deps.supabase
          .from('lora_dataset_images')
          .update({ eval_status: 'replaced' })
          .eq('id', img.id);
      }
    }

    const allFailures = [
      ...evalFailures,
      ...pendingGenerationFailures.map((f) => ({
        promptTemplate: f.promptTemplate,
        variationType: f.variationType,
      })),
    ];

    const replacements = await generateReplacements(character, loraId, allFailures, deps);

    const generatedTemplates = new Set(
      replacements.map((r) => r.prompt_template.replace(/_replacement$/, ''))
    );
    pendingGenerationFailures = pendingGenerationFailures.filter(
      (f) => !generatedTemplates.has(f.promptTemplate)
    );

    if (replacements.length > 0) {
      const replacementEval = await evaluateDataset(
        character.approvedImageUrl,
        character.fullBodyImageUrl,
        replacements,
        deps,
      );

      evalResult.passedImages = [...evalResult.passedImages, ...replacementEval.passedImages];
      evalResult.passed = evalResult.passedImages.length;
    }

    allImages = [...allImages, ...replacements];
  }

  return evalResult;
}

/**
 * Get the current progress of a LoRA pipeline for status polling.
 */
export async function getPipelineProgress(
  characterId: string,
  deps: PipelineDeps,
): Promise<PipelineProgress | null> {
  const { data: lora, error } = await deps.supabase
    .from('character_loras')
    .select('*')
    .eq('character_id', characterId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !lora) return null;

  const loraRecord = lora as CharacterLoraRow;

  const { count: generated } = await deps.supabase
    .from('lora_dataset_images')
    .select('*', { count: 'exact', head: true })
    .eq('lora_id', loraRecord.id);

  const { count: approved } = await deps.supabase
    .from('lora_dataset_images')
    .select('*', { count: 'exact', head: true })
    .eq('lora_id', loraRecord.id)
    .eq('eval_status', 'passed');

  const timeEstimates: Record<string, string> = {
    pending: '~25 minutes',
    generating_dataset: '~20 minutes',
    evaluating: '~15 minutes',
    captioning: '~12 minutes',
    training: '~10 minutes',
    validating: '~5 minutes',
    deployed: 'Complete',
    failed: 'Failed',
    archived: 'Archived',
  };

  return {
    loraId: loraRecord.id,
    status: loraRecord.status,
    progress: {
      datasetGenerated: generated || 0,
      datasetApproved: approved || 0,
      trainingAttempt: loraRecord.training_attempts,
      validationScore: loraRecord.validation_score,
    },
    error: loraRecord.error,
    estimatedTimeRemaining: timeEstimates[loraRecord.status] || null,
  };
}

// ── Internal helpers ────────────────────────────────────────────

/**
 * Validate all external dependencies and inputs before starting the pipeline.
 * Catches config errors (bad params, missing tokens, unreachable URLs) before
 * spending 20+ minutes on dataset generation.
 */
async function preflightCheck(
  character: CharacterInput,
  deps: PipelineDeps,
): Promise<void> {
  const errors: string[] = [];

  console.log('[LoRA Preflight] Running pre-flight checks...');

  // 1. Replicate API token
  if (!process.env.REPLICATE_API_TOKEN) {
    errors.push('Missing REPLICATE_API_TOKEN environment variable');
  } else {
    try {
      const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
      const owner = await getReplicateUsername(replicate);
      console.log(`[LoRA Preflight] Replicate account: ${owner}`);

      // Pre-create destination model so training doesn't 404
      const destModel = `lora-${slugify(character.characterName)}`;
      await ensureReplicateModel(replicate, owner, destModel);
    } catch (err) {
      errors.push(`Replicate API check failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 2. Anthropic API key (needed for quality evaluation + validation)
  if (!process.env.ANTHROPIC_API_KEY) {
    errors.push('Missing ANTHROPIC_API_KEY environment variable');
  }

  // 3. Reference images are accessible
  for (const [label, url] of [
    ['Portrait reference', character.approvedImageUrl],
    ['Full-body reference', character.fullBodyImageUrl],
  ] as const) {
    try {
      const resp = await fetch(url, { method: 'HEAD' });
      if (!resp.ok) {
        errors.push(`${label} URL returned ${resp.status}: ${url.slice(0, 80)}`);
      }
    } catch (err) {
      errors.push(`${label} URL unreachable: ${url.slice(0, 80)}`);
    }
  }

  // 4. Training params are valid for Replicate
  const params = { ...DEFAULT_TRAINING_PARAMS };
  if (!['constant', 'linear'].includes(params.lr_scheduler)) {
    errors.push(`Invalid lr_scheduler "${params.lr_scheduler}" — must be "constant" or "linear"`);
  }
  if (params.resolution > 1024) {
    errors.push(`Resolution ${params.resolution} exceeds SDXL max of 1024`);
  }

  if (errors.length > 0) {
    const msg = `Preflight check failed:\n  - ${errors.join('\n  - ')}`;
    console.error(`[LoRA Preflight] ${msg}`);
    throw new Error(msg);
  }

  console.log('[LoRA Preflight] All checks passed');
}

async function updateStatus(
  loraId: string,
  status: string,
  deps: PipelineDeps,
): Promise<void> {
  console.log(`[LoRA Pipeline] → Stage: ${status}`);

  await deps.supabase
    .from('character_loras')
    .update({ status, error: null })
    .eq('id', loraId);
}

async function checkpoint(
  loraId: string,
  stage: CompletedStage,
  deps: PipelineDeps,
): Promise<void> {
  console.log(`[LoRA Pipeline] ✓ Checkpoint: ${stage}`);

  await deps.supabase
    .from('character_loras')
    .update({ completed_stage: stage })
    .eq('id', loraId);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
