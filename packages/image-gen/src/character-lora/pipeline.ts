// Character LoRA Pipeline — Main Orchestrator
// Runs all 6 stages sequentially with retry logic.
// Designed to run as a background job (fire-and-forget from API route).

import type {
  CharacterInput,
  CharacterLoraRow,
  PipelineProgress,
  VariationType,
} from './types';
import { DEFAULT_TRAINING_PARAMS, PIPELINE_CONFIG } from './types';
import { generateDataset, generateReplacements } from './dataset-generator';
import { evaluateDataset } from './quality-evaluator';
import { generateCaptions } from './caption-generator';
import { trainLora, getRetryParams } from './trainer';
import { validateLora } from './validator';
import { deployLora } from './deployer';

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
 */
export async function runPipeline(
  character: CharacterInput,
  loraId: string,
  deps: PipelineDeps,
): Promise<void> {
  const startTime = Date.now();

  try {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[LoRA Pipeline] Starting for ${character.characterName}`);
    console.log(`[LoRA Pipeline] LoRA ID: ${loraId}`);
    console.log(`${'='.repeat(60)}\n`);

    // ── STAGE 1: Dataset Generation ──────────────────────────
    await updateStatus(loraId, 'generating_dataset', deps);

    const datasetResult = await generateDataset(character, loraId, deps);

    if (datasetResult.totalGenerated === 0) {
      throw new Error('Dataset generation produced no images');
    }

    // ── STAGE 2: Quality Evaluation (with replacement loop) ──
    await updateStatus(loraId, 'evaluating', deps);

    let allImages = [...datasetResult.imageRecords];
    let evalResult = await evaluateDataset(
      character.approvedImageUrl,
      allImages,
      deps,
    );

    // Replacement rounds if needed
    for (
      let round = 0;
      round < PIPELINE_CONFIG.maxReplacementRounds &&
      evalResult.passed < PIPELINE_CONFIG.targetPassedImages;
      round++
    ) {
      console.log(
        `[LoRA Pipeline] Replacement round ${round + 1}: ${evalResult.passed} passed, need ${PIPELINE_CONFIG.targetPassedImages}`
      );

      // Find which prompts failed
      const failedPromptIds = allImages
        .filter(
          (img) =>
            !evalResult.passedImages.some((p) => p.id === img.id)
        )
        .map((img) => ({
          promptTemplate: img.prompt_template,
          variationType: img.variation_type as VariationType,
        }));

      // Mark old failed images as replaced
      for (const img of allImages) {
        if (!evalResult.passedImages.some((p) => p.id === img.id)) {
          await deps.supabase
            .from('lora_dataset_images')
            .update({ eval_status: 'replaced' })
            .eq('id', img.id);
        }
      }

      // Generate replacements
      const replacements = await generateReplacements(
        character,
        loraId,
        failedPromptIds,
        deps,
      );

      // Evaluate replacements
      const replacementEval = await evaluateDataset(
        character.approvedImageUrl,
        replacements,
        deps,
      );

      // Merge passed images
      evalResult.passedImages = [
        ...evalResult.passedImages,
        ...replacementEval.passedImages,
      ];
      evalResult.passed = evalResult.passedImages.length;
      allImages = [...allImages, ...replacements];
    }

    // Check minimum threshold
    if (evalResult.passed < PIPELINE_CONFIG.minPassedImages) {
      throw new Error(
        `Only ${evalResult.passed} images passed evaluation (minimum ${PIPELINE_CONFIG.minPassedImages} required). ` +
          `Pipeline cannot proceed with insufficient training data.`
      );
    }

    console.log(
      `[LoRA Pipeline] ${evalResult.passed} images approved for training`
    );

    // ── STAGE 3: Captioning ──────────────────────────────────
    await updateStatus(loraId, 'captioning', deps);

    const captionResult = await generateCaptions(
      evalResult.passedImages,
      character.gender,
      deps,
    );

    // ── STAGE 4 & 5: Training + Validation (with retry loop) ─
    let loraBuffer: Buffer | null = null;
    let loraFilename: string | null = null;
    let trainingSuccess = false;

    for (
      let attempt = 1;
      attempt <= PIPELINE_CONFIG.maxTrainingAttempts && !trainingSuccess;
      attempt++
    ) {
      try {
        // Stage 4: Training
        await updateStatus(loraId, 'training', deps);

        const paramsOverrides = attempt > 1 ? getRetryParams(attempt) : {};
        const characterSlug = slugify(character.characterName);

        const trainingResult = await trainLora(
          captionResult.captionedImages,
          characterSlug,
          loraId,
          attempt,
          deps,
          paramsOverrides,
        );

        loraBuffer = trainingResult.loraBuffer;

        // Deploy to temporary location for validation
        const tempFilename = `char_${characterSlug}_${loraId.slice(0, 8)}.safetensors`;
        const tempStoragePath = `character-loras/validation/${tempFilename}`;

        await deps.supabase.storage
          .from('story-images')
          .upload(tempStoragePath, loraBuffer, {
            contentType: 'application/octet-stream',
            upsert: true,
          });

        const { data: tempUrlData } = deps.supabase.storage
          .from('story-images')
          .getPublicUrl(tempStoragePath);

        loraFilename = tempFilename;

        // Stage 5: Validation
        await updateStatus(loraId, 'validating', deps);

        const validationResult = await validateLora(
          character,
          tempFilename,
          tempUrlData.publicUrl,
          loraId,
          deps,
        );

        if (validationResult.overallPass) {
          trainingSuccess = true;
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

    if (!trainingSuccess || !loraBuffer || !loraFilename) {
      throw new Error(
        `LoRA training failed after ${PIPELINE_CONFIG.maxTrainingAttempts} attempts`
      );
    }

    // ── STAGE 6: Deployment ──────────────────────────────────
    const deployResult = await deployLora(
      loraBuffer,
      character.characterId,
      character.characterName,
      loraId,
      evalResult.passed,
      deps,
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
 * Get the current progress of a LoRA pipeline for status polling.
 */
export async function getPipelineProgress(
  characterId: string,
  deps: PipelineDeps,
): Promise<PipelineProgress | null> {
  // Get the most recent LoRA record for this character
  const { data: lora, error } = await deps.supabase
    .from('character_loras')
    .select('*')
    .eq('character_id', characterId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !lora) return null;

  const loraRecord = lora as CharacterLoraRow;

  // Count dataset image stats
  const { count: generated } = await deps.supabase
    .from('lora_dataset_images')
    .select('*', { count: 'exact', head: true })
    .eq('lora_id', loraRecord.id);

  const { count: approved } = await deps.supabase
    .from('lora_dataset_images')
    .select('*', { count: 'exact', head: true })
    .eq('lora_id', loraRecord.id)
    .eq('eval_status', 'passed');

  // Estimate time remaining based on current stage
  const timeEstimates: Record<string, string> = {
    pending: '~20 minutes',
    generating_dataset: '~15 minutes',
    evaluating: '~12 minutes',
    captioning: '~10 minutes',
    training: '~8 minutes',
    validating: '~3 minutes',
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

async function updateStatus(
  loraId: string,
  status: string,
  deps: PipelineDeps,
): Promise<void> {
  console.log(`[LoRA Pipeline] → Stage: ${status}`);

  await deps.supabase
    .from('character_loras')
    .update({ status })
    .eq('id', loraId);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
