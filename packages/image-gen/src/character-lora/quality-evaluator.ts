// Stage 2: Quality Evaluation using Claude Vision
// Evaluates each generated dataset image against BOTH reference images
// (portrait + full-body) with category-weighted scoring.
//
// Face close-ups: face 80%, quality 20%
// Head-shoulders: face 60%, quality 40%
// Waist-up / full-body: face 40%, body 40%, quality 20%
// Body detail: face 30%, body 50%, quality 20%

import Anthropic from '@anthropic-ai/sdk';
import type {
  EvalDetails,
  EvaluationResult,
  LoraDatasetImageRow,
  ImageCategory,
} from './types';
import { PIPELINE_CONFIG } from './types';

const EVALUATION_MODEL = 'claude-sonnet-4-6';

const EVALUATION_SYSTEM_PROMPT = `You are evaluating AI-generated images for character consistency in a LoRA training dataset. You will receive:
1. A REFERENCE PORTRAIT (the approved character portrait — face is the ground truth)
2. A REFERENCE FULL-BODY (the approved full-body image — body type is the ground truth)
3. A GENERATED IMAGE (a variation for training)

Evaluate the generated image on these criteria:

1. FACE CONSISTENCY (0-10): Does this look like the SAME person as the reference portrait?
   - Same facial structure, nose shape, lip shape, eye shape
   - Same skin tone and complexion
   - Minor expression/angle changes are expected and good
   - Score 7+ = clearly the same person

2. BODY TYPE CONSISTENCY (0-10): Does the body match the reference full-body image?
   - Same build (slim, athletic, curvy, etc.)
   - Same proportions
   - Clothing changes are expected
   - Score 7+ = consistent body type
   - If the generated image only shows the face (close-up), score 8 by default

3. IMAGE QUALITY (0-10): Is this a high-quality training image?
   - Sharp and well-rendered (no blurry areas)
   - No anatomical errors (extra fingers, distorted limbs)
   - No artifacts or glitches
   - Good lighting and composition
   - Single person only — no other people visible
   - Score 7+ = training-quality image

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
 * Evaluate all dataset images against both reference images.
 * Uses category-weighted scoring for PASS/FAIL determination.
 *
 * Uses URL-based image sources for the Anthropic API to avoid the 5 MB base64
 * limit — Nano Banana Pro generates 7-9 MB PNGs that exceed the base64 limit.
 * URL source supports up to 20 MB with automatic server-side resizing.
 */
export async function evaluateDataset(
  referencePortraitUrl: string,
  referenceFullBodyUrl: string,
  images: LoraDatasetImageRow[],
  deps: QualityEvaluatorDeps,
): Promise<EvaluationResult> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Missing ANTHROPIC_API_KEY environment variable');
  }

  console.log(`[LoRA Eval] Evaluating ${images.length} images...`);

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
        evaluateSingleImage(anthropic, referencePortraitUrl, referenceFullBodyUrl, image, deps)
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
        console.error(
          `[LoRA Eval] Evaluation error for ${batch[i].prompt_template}: ${result.reason}`
        );
        failedImages.push(batch[i]);

        await deps.supabase
          .from('lora_dataset_images')
          .update({
            eval_status: 'failed',
            eval_details: {
              face_score: 0,
              body_score: 0,
              quality_score: 0,
              verdict: 'FAIL',
              issues: [`Evaluation error: ${result.reason}`],
            },
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

// ── Category-Weighted Scoring ─────────────────────────────────────

interface CategoryWeights {
  face: number;
  body: number;
  quality: number;
}

function getCategoryWeights(category: ImageCategory): CategoryWeights {
  switch (category) {
    case 'face-closeup':
      return { face: 0.8, body: 0.0, quality: 0.2 };
    case 'head-shoulders':
      return { face: 0.6, body: 0.0, quality: 0.4 };
    case 'waist-up':
    case 'full-body':
      return { face: 0.4, body: 0.4, quality: 0.2 };
    case 'body-detail':
      return { face: 0.3, body: 0.5, quality: 0.2 };
    default:
      return { face: 0.5, body: 0.3, quality: 0.2 };
  }
}

function computeWeightedScore(details: EvalDetails, category: ImageCategory): number {
  const weights = getCategoryWeights(category);
  return (
    details.face_score * weights.face +
    details.body_score * weights.body +
    details.quality_score * weights.quality
  );
}

// ── Internal Helpers ──────────────────────────────────────────────

async function evaluateSingleImage(
  anthropic: Anthropic,
  portraitUrl: string,
  fullBodyUrl: string,
  image: LoraDatasetImageRow,
  deps: QualityEvaluatorDeps,
): Promise<EvalDetails> {
  // Use URL source type to avoid the 5 MB base64 limit.
  // Nano Banana Pro generates 7-9 MB PNGs that exceed the base64 limit but
  // URL sources support up to 20 MB with automatic server-side resizing.
  const response = await anthropic.messages.create({
    model: EVALUATION_MODEL,
    max_tokens: 256,
    system: EVALUATION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'REFERENCE PORTRAIT (approved — face ground truth):' },
          {
            type: 'image',
            source: { type: 'url', url: portraitUrl },
          },
          { type: 'text', text: 'REFERENCE FULL-BODY (approved — body type ground truth):' },
          {
            type: 'image',
            source: { type: 'url', url: fullBodyUrl },
          },
          {
            type: 'text',
            text: `GENERATED IMAGE (${image.prompt_template}, category: ${image.category}, source: ${image.source}):`,
          },
          {
            type: 'image',
            source: { type: 'url', url: image.image_url },
          },
          {
            type: 'text',
            text: 'Evaluate the generated image against both references. Respond with JSON only.',
          },
        ],
      },
    ],
  });

  const responseText =
    response.content[0].type === 'text' ? response.content[0].text : '';

  let evalResult: EvalDetails;
  try {
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

  // Compute weighted score based on image category
  const category = (image.category || 'face-closeup') as ImageCategory;
  const weightedScore = computeWeightedScore(evalResult, category);

  // PASS/FAIL: weighted score >= 7 AND no individual category below 5
  const noCategryBelowFloor =
    evalResult.face_score >= 5 &&
    evalResult.quality_score >= 5 &&
    // Only enforce body score floor for categories that show the body
    (category === 'face-closeup' || category === 'head-shoulders' || evalResult.body_score >= 5);

  evalResult.verdict = weightedScore >= PIPELINE_CONFIG.minEvalScore && noCategryBelowFloor
    ? 'PASS'
    : 'FAIL';

  // Update database record
  const evalStatus = evalResult.verdict === 'PASS' ? 'passed' : 'failed';

  await deps.supabase
    .from('lora_dataset_images')
    .update({
      eval_status: evalStatus,
      eval_score: Math.round(weightedScore * 10) / 10,
      eval_details: evalResult,
    })
    .eq('id', image.id);

  console.log(
    `[LoRA Eval] ${evalResult.verdict} ${image.prompt_template} ` +
    `(face=${evalResult.face_score}, body=${evalResult.body_score}, quality=${evalResult.quality_score}, ` +
    `weighted=${weightedScore.toFixed(1)}, category=${category})`
  );

  return evalResult;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
