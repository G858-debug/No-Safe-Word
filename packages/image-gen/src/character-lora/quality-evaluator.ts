// Stage 2: Quality Evaluation using Claude Vision
// Evaluates each generated dataset image against the reference portrait
// for face consistency, body consistency, and image quality.

import Anthropic from '@anthropic-ai/sdk';
import type {
  EvalDetails,
  EvaluationResult,
  LoraDatasetImageRow,
} from './types';
import { PIPELINE_CONFIG } from './types';

const EVALUATION_MODEL = 'claude-sonnet-4-6';

const EVALUATION_SYSTEM_PROMPT = `You are evaluating AI-generated images for character consistency in a LoRA training dataset. You will receive:
1. A REFERENCE image (the approved character portrait)
2. A GENERATED image (a variation for training)

Evaluate the generated image on these criteria:

1. FACE CONSISTENCY (0-10): Does this look like the SAME person as the reference?
   - Same facial structure, nose shape, lip shape, eye shape
   - Same skin tone and complexion
   - Minor expression/angle changes are expected and good
   - Score 7+ = clearly the same person

2. BODY TYPE CONSISTENCY (0-10): Does the body match the reference?
   - Same build (slim, athletic, curvy, etc.)
   - Same proportions
   - Clothing changes are expected
   - Score 7+ = consistent body type

3. IMAGE QUALITY (0-10): Is this a high-quality training image?
   - Sharp and well-rendered (no blurry areas)
   - No anatomical errors (extra fingers, distorted limbs)
   - No artifacts or glitches
   - Good lighting and composition
   - Score 7+ = training-quality image

4. OVERALL VERDICT: PASS or FAIL
   - PASS if ALL three scores are 7+
   - FAIL if ANY score is below 7

Respond in JSON format only:
{
  "face_score": 8,
  "body_score": 9,
  "quality_score": 8,
  "verdict": "PASS",
  "issues": []
}`;

interface QualityEvaluatorDeps {
  supabase: {
    from: (table: string) => any;
  };
}

/**
 * Evaluate all dataset images against the reference portrait.
 * Returns which images passed and which failed.
 */
export async function evaluateDataset(
  referenceImageUrl: string,
  images: LoraDatasetImageRow[],
  deps: QualityEvaluatorDeps,
): Promise<EvaluationResult> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Missing ANTHROPIC_API_KEY environment variable');
  }

  console.log(`[LoRA Eval] Evaluating ${images.length} images...`);

  // Fetch the reference image as base64 once
  const referenceBase64 = await fetchImageAsBase64(referenceImageUrl);

  const passedImages: LoraDatasetImageRow[] = [];
  const failedImages: LoraDatasetImageRow[] = [];

  // Process in batches to respect concurrency limit
  const batches = chunkArray(images, PIPELINE_CONFIG.evaluationConcurrency);

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    console.log(
      `[LoRA Eval] Batch ${batchIdx + 1}/${batches.length} (${batch.length} images)...`
    );

    const results = await Promise.allSettled(
      batch.map((image) =>
        evaluateSingleImage(anthropic, referenceBase64, image, deps)
      )
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        if (result.value.verdict === 'PASS') {
          passedImages.push(batch[i]);
        } else {
          failedImages.push(batch[i]);
        }
      } else {
        // Evaluation itself failed — treat as failed image
        console.error(
          `[LoRA Eval] Evaluation error for ${batch[i].prompt_template}: ${result.reason}`
        );
        failedImages.push(batch[i]);

        // Update record with error
        await deps.supabase
          .from('lora_dataset_images')
          .update({
            eval_status: 'failed',
            eval_details: { face_score: 0, body_score: 0, quality_score: 0, verdict: 'FAIL', issues: [`Evaluation error: ${result.reason}`] },
          })
          .eq('id', batch[i].id);
      }
    }
  }

  console.log(
    `[LoRA Eval] Results: ${passedImages.length} passed, ${failedImages.length} failed`
  );

  return {
    totalEvaluated: images.length,
    passed: passedImages.length,
    failed: failedImages.length,
    passedImages,
  };
}

// ── Internal helpers ────────────────────────────────────────────

async function evaluateSingleImage(
  anthropic: Anthropic,
  referenceBase64: string,
  image: LoraDatasetImageRow,
  deps: QualityEvaluatorDeps,
): Promise<EvalDetails> {
  // Fetch the generated image as base64
  const generatedBase64 = await fetchImageAsBase64(image.image_url);

  const response = await anthropic.messages.create({
    model: EVALUATION_MODEL,
    max_tokens: 256,
    system: EVALUATION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'REFERENCE IMAGE (approved portrait):',
          },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: referenceBase64,
            },
          },
          {
            type: 'text',
            text: `GENERATED IMAGE (${image.prompt_template}, ${image.variation_type}):`,
          },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: generatedBase64,
            },
          },
          {
            type: 'text',
            text: 'Evaluate the generated image against the reference. Respond with JSON only.',
          },
        ],
      },
    ],
  });

  // Parse the JSON response
  const responseText =
    response.content[0].type === 'text' ? response.content[0].text : '';

  let evalResult: EvalDetails;
  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    evalResult = JSON.parse(jsonMatch[0]);
  } catch {
    console.error(
      `[LoRA Eval] Failed to parse eval response for ${image.prompt_template}: ${responseText}`
    );
    evalResult = {
      face_score: 0,
      body_score: 0,
      quality_score: 0,
      verdict: 'FAIL',
      issues: ['Failed to parse evaluation response'],
    };
  }

  // Enforce PASS/FAIL logic (don't trust the model's verdict alone)
  const allAboveThreshold =
    evalResult.face_score >= PIPELINE_CONFIG.minEvalScore &&
    evalResult.body_score >= PIPELINE_CONFIG.minEvalScore &&
    evalResult.quality_score >= PIPELINE_CONFIG.minEvalScore;

  evalResult.verdict = allAboveThreshold ? 'PASS' : 'FAIL';

  // Update database record
  const evalStatus = evalResult.verdict === 'PASS' ? 'passed' : 'failed';
  const avgScore =
    (evalResult.face_score + evalResult.body_score + evalResult.quality_score) / 3;

  await deps.supabase
    .from('lora_dataset_images')
    .update({
      eval_status: evalStatus,
      eval_score: Math.round(avgScore * 10) / 10,
      eval_details: evalResult,
    })
    .eq('id', image.id);

  console.log(
    `[LoRA Eval] ${evalResult.verdict} ${image.prompt_template} ` +
      `(face=${evalResult.face_score}, body=${evalResult.body_score}, quality=${evalResult.quality_score})`
  );

  return evalResult;
}

async function fetchImageAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image from ${url}: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
