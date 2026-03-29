// Stage 2: Quality Evaluation using Claude Vision
// Evaluates each generated dataset image with CATEGORY-SPECIFIC criteria:
//
// Face shots (face-closeup, head-shoulders):
//   - Face identity match is PRIMARY criterion
//   - Both portrait + full-body references sent
//   - Weights: face-closeup 80/0/20, head-shoulders 60/0/40
//
// Body shots (waist-up, full-body, body-detail):
//   - Face matching is NOT evaluated (face will differ — expected)
//   - Only full-body reference sent (no portrait — avoids face comparison)
//   - Scores on: head visibility, body type, skin tone, quality, anatomy
//   - Weights: waist-up/full-body 0/60/40, body-detail 0/70/30
//
// Cost optimisation: uses Haiku for evaluation and batches multiple images
// per API call (default 5 per batch). For a 40-image dataset split 50/50:
//   Face: 20 images ÷ 5 = 4 calls.  Body: 20 images ÷ 5 = 4 calls.
//   Total: 8 API calls (was 40 with single-image Sonnet evaluation).

import Anthropic from '@anthropic-ai/sdk';
import type {
  EvalDetails,
  EvaluationResult,
  LoraDatasetImageRow,
  ImageCategory,
} from './types';
import { PIPELINE_CONFIG } from './types';
import { anthropicCreateWithRetry } from '../anthropic-retry';

const EVALUATION_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_BATCH_SIZE = 5;

// ── Category-specific evaluation prompts (single-image — used as fallback) ──

const FACE_EVAL_SYSTEM_PROMPT = `You are evaluating AI-generated images for character consistency in a LoRA training dataset. You will receive:
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

4. FACE-ONLY CROP FLAG (boolean): always set false for face shots.

5. HEAD CROPPING CHECK: always set head_cropped: false for face shots.

Respond in JSON format only:
{
  "face_score": 8,
  "body_score": 9,
  "quality_score": 8,
  "face_only_crop": false,
  "head_cropped": false,
  "verdict": "PASS",
  "issues": []
}`;

// ── Batched evaluation prompts ──────────────────────────────────

const FACE_EVAL_SYSTEM_PROMPT_BATCH = `You are evaluating AI-generated images for character consistency in a LoRA training dataset. You will receive:
1. A REFERENCE PORTRAIT (the approved character portrait — face is the ground truth)
2. A REFERENCE FULL-BODY (the approved full-body image — body type is the ground truth)
3. Multiple GENERATED IMAGES to evaluate (labeled Image 1, Image 2, etc.)

Evaluate EACH generated image on these criteria:

1. FACE CONSISTENCY (0-10): Does this look like the SAME person as the reference portrait?
   - Same facial structure, nose shape, lip shape, eye shape
   - Same skin tone and complexion
   - Minor expression/angle changes are expected and good
   - Score 7+ = clearly the same person

2. BODY TYPE CONSISTENCY (0-10): Does the body match the reference full-body image?
   - Same build, proportions. Clothing changes are expected.
   - Score 7+ = consistent body type
   - If the generated image only shows the face (close-up), score 8 by default

3. IMAGE QUALITY (0-10): Is this a high-quality training image?
   - Sharp, well-rendered, no anatomical errors, no artifacts
   - Single person only — no other people visible
   - Score 7+ = training-quality image

4. FACE-ONLY CROP FLAG: always false for face shots.
5. HEAD CROPPING CHECK: always false for face shots.

Respond with a JSON array of exactly N objects, one per generated image, in the same order as submitted.
Each object:
{ "face_score": 8, "body_score": 9, "quality_score": 8, "face_only_crop": false, "head_cropped": false, "verdict": "PASS", "issues": [] }

Return ONLY the JSON array. No other text.`;

function getFramingRules(category: string): string {
  switch (category) {
    case 'full-body':
      return `This is a FULL-BODY shot. Framing requirements:
   - The full figure from head to feet MUST be visible
   - If legs or feet are not visible, this is a framing failure: set body_score to 2/10
   - Standing or walking pose expected unless prompt specified otherwise`;
    case 'waist-up':
      return `This is a WAIST-UP shot. Framing requirements:
   - Head to waist/hip area must be visible — that is sufficient
   - Mid-thigh cropping is PERFECTLY ACCEPTABLE — do NOT penalize
   - Legs and feet are NOT expected to be visible — do NOT deduct points for missing legs
   - Seated poses are acceptable
   - DO NOT apply full-body framing criteria to this image`;
    case 'body-detail':
      return `This is a BODY-DETAIL shot. Framing requirements:
   - Partial body framing is intentional for this category
   - Focus evaluation on image quality, skin texture, and clothing detail
   - No specific framing requirements beyond the head being visible`;
    default:
      return `Evaluate framing based on whether the body is reasonably visible.`;
  }
}

function buildBodyEvalPrompt(category: string): string {
  return `You are evaluating body images for a LoRA training dataset.

You will receive:
1. A REFERENCE FULL-BODY (the approved body image — this is the ground truth for body proportions)
2. A GENERATED IMAGE (a body shot variation for training)

The image category is: ${category}

Score each image on three criteria (1-10 each):

FACE (face_score): How clearly visible and well-rendered is the face?
  - Is the head fully in frame (crown to chin)?
  - If the head is cropped, partially out of frame, or missing → set head_cropped: true and score 2
  - A clearly visible, well-rendered face scores 7-9

BODY (body_score): Do the body proportions match the REFERENCE image?
  - Compare the generated image's body shape directly against the reference
  - Same general build, proportions, and silhouette as the reference
  - Same skin tone as the reference — only deduct for fundamental mismatches
  - Minor variations from pose/angle/clothing are expected and acceptable
  - Score 7+ = proportions clearly match the reference
  - Score 4-6 = noticeably different build from reference
  - Score 1-3 = completely different body type from reference
  - Deduct points if proportions look physically impossible or cartoon-like
  ${getFramingRules(category)}

QUALITY (quality_score): Overall image quality, lighting, and realism.
  - Sharp and well-rendered (no blurry areas)
  - No anatomical errors (extra fingers, distorted limbs)
  - No artifacts or glitches
  - Single person only — no other people visible
  - Person is clothed
  - Score 7+ = training-quality image

FACE-ONLY CROP FLAG: If the category indicates body should be visible
but the generated image ONLY shows the head/face (body not visible), set face_only_crop to true.

REJECT if: body_score below 6, face_score below 6, quality_score below 6,
OR if proportions look physically impossible (cartoon-like exaggeration).

Respond in JSON format only:
{
  "face_score": 7,
  "body_score": 8,
  "quality_score": 8,
  "proportions_realistic": true,
  "face_only_crop": false,
  "head_cropped": false,
  "verdict": "PASS",
  "reason": "brief reason",
  "issues": []
}`;
}

function buildBodyEvalPromptBatch(category: string): string {
  return `You are evaluating body images for a LoRA training dataset.

You will receive:
1. A REFERENCE FULL-BODY (the approved body image — this is the ground truth for body proportions)
2. Multiple GENERATED IMAGES to evaluate (labeled Image 1, Image 2, etc.)

The image category is: ${category}

Score EACH generated image on three criteria (1-10 each):

FACE (face_score): How clearly visible and well-rendered is the face?
  - Is the head fully in frame (crown to chin)?
  - If the head is cropped, partially out of frame, or missing → set head_cropped: true and score 2

BODY (body_score): Do the body proportions match the REFERENCE image?
  - Same general build, proportions, silhouette as the reference
  - Same skin tone — only deduct for fundamental mismatches
  - Score 7+ = match, 4-6 = noticeably different, 1-3 = completely different
  ${getFramingRules(category)}

QUALITY (quality_score): Sharp, well-rendered, no anatomical errors, single person, clothed.

FACE-ONLY CROP FLAG: If body should be visible but only head/face shows, set face_only_crop to true.

Respond with a JSON array of exactly N objects, one per generated image, in order.
Each object:
{ "face_score": 7, "body_score": 8, "quality_score": 8, "proportions_realistic": true, "face_only_crop": false, "head_cropped": false, "verdict": "PASS", "reason": "brief", "issues": [] }

Return ONLY the JSON array. No other text.`;
}

// ── Types ─────────────────────────────────────────────────────────

export interface CharacterEvalData {
  bodyType: string;
  skinTone: string;
}

interface QualityEvaluatorDeps {
  supabase: {
    from: (table: string) => any;
  };
}

/**
 * Evaluate all dataset images with category-specific criteria.
 * Face shots are scored on face identity match.
 * Body shots are scored on body type, skin tone, framing, and quality (no face matching).
 *
 * Uses batched evaluation: groups images by type (face/body), sends up to 5
 * per API call. Falls back to single-image evaluation on parse failure.
 */
export async function evaluateDataset(
  referencePortraitUrl: string,
  referenceFullBodyUrl: string,
  images: LoraDatasetImageRow[],
  deps: QualityEvaluatorDeps,
  characterData?: CharacterEvalData,
): Promise<EvaluationResult> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Missing ANTHROPIC_API_KEY environment variable');
  }

  console.log(`[LoRA Eval] Evaluating ${images.length} images (batched, model: ${EVALUATION_MODEL})...`);

  // Split into face and body groups
  const faceImages = images.filter(
    (img) => !BODY_CATEGORIES.includes((img.category || 'face-closeup') as ImageCategory),
  );
  const bodyImages = images.filter(
    (img) => BODY_CATEGORIES.includes((img.category || 'face-closeup') as ImageCategory),
  );

  console.log(`[LoRA Eval] Face images: ${faceImages.length}, Body images: ${bodyImages.length}`);

  // Evaluate each group in batches
  const faceResult = await evaluateBatch(
    anthropic, referencePortraitUrl, referenceFullBodyUrl, faceImages, deps,
  );
  const bodyResult = await evaluateBatch(
    anthropic, referencePortraitUrl, referenceFullBodyUrl, bodyImages, deps,
  );

  const passedImages = [...faceResult.passed, ...bodyResult.passed];
  const failedImages = [...faceResult.failed, ...bodyResult.failed];

  console.log(
    `[LoRA Eval] Results: ${passedImages.length} passed, ${failedImages.length} failed`,
  );

  return {
    totalEvaluated: images.length,
    passed: passedImages.length,
    failed: failedImages.length,
    passedImages,
  };
}

// ── Batched Evaluation ──────────────────────────────────────────

/**
 * Evaluate a group of same-type images in batches.
 *
 * Cost reduction: 40-image dataset → ~8 API calls (was 40).
 *   Face: 20 ÷ 5 = 4 calls.  Body: 20 ÷ 5 = 4 calls.
 *
 * On parse failure for a batch, falls back to evaluateSingleImage per image.
 */
async function evaluateBatch(
  anthropic: Anthropic,
  portraitUrl: string,
  fullBodyUrl: string,
  images: LoraDatasetImageRow[],
  deps: QualityEvaluatorDeps,
  batchSize: number = DEFAULT_BATCH_SIZE,
): Promise<{ passed: LoraDatasetImageRow[]; failed: LoraDatasetImageRow[] }> {
  const passed: LoraDatasetImageRow[] = [];
  const failed: LoraDatasetImageRow[] = [];

  if (images.length === 0) return { passed, failed };

  const chunks = chunkArray(images, batchSize);

  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const chunk = chunks[chunkIdx];
    const category = (chunk[0].category || 'face-closeup') as ImageCategory;
    const isBodyShot = BODY_CATEGORIES.includes(category);

    console.log(
      `[LoRA Eval] Batch ${chunkIdx + 1}/${chunks.length}: ${chunk.length} ${isBodyShot ? 'body' : 'face'} images`,
    );

    try {
      // Build batched system prompt
      const systemPrompt = isBodyShot
        ? buildBodyEvalPromptBatch(category)
        : FACE_EVAL_SYSTEM_PROMPT_BATCH;

      // Build message content: references first, then generated images
      const messageContent: Anthropic.Messages.ContentBlockParam[] = [];

      if (!isBodyShot) {
        // Face batches: send both portrait + full-body references
        messageContent.push(
          { type: 'text', text: 'REFERENCE PORTRAIT (approved — face ground truth):' },
          { type: 'image', source: { type: 'url', url: portraitUrl } },
          { type: 'text', text: 'REFERENCE FULL-BODY (approved — body type ground truth):' },
          { type: 'image', source: { type: 'url', url: fullBodyUrl } },
        );
      } else {
        // Body batches: only full-body reference
        messageContent.push(
          { type: 'text', text: 'REFERENCE FULL-BODY (approved — body proportions ground truth):' },
          { type: 'image', source: { type: 'url', url: fullBodyUrl } },
        );
      }

      messageContent.push({
        type: 'text',
        text: `REFERENCE IMAGES ABOVE. Now evaluate these ${chunk.length} generated images:`,
      });

      // Add each generated image with a label
      for (let i = 0; i < chunk.length; i++) {
        messageContent.push(
          { type: 'image', source: { type: 'url', url: chunk[i].image_url } },
          { type: 'text', text: `Image ${i + 1} (${chunk[i].prompt_template}, category: ${chunk[i].category})` },
        );
      }

      // API call
      const response = await anthropicCreateWithRetry(
        anthropic,
        {
          model: EVALUATION_MODEL,
          max_tokens: 512 + chunk.length * 128, // Scale tokens with batch size
          system: systemPrompt,
          messages: [{ role: 'user', content: messageContent }],
        },
        { label: `eval batch ${chunkIdx + 1} (${chunk.length} images)` },
      );

      const responseText =
        response.content[0].type === 'text' ? response.content[0].text : '';

      // Parse JSON array response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No JSON array found in batch response');
      }

      const evalResults: EvalDetails[] = JSON.parse(jsonMatch[0]);

      if (evalResults.length !== chunk.length) {
        throw new Error(
          `Batch response has ${evalResults.length} results, expected ${chunk.length}`,
        );
      }

      // Process each result with the same scoring logic as evaluateSingleImage
      for (let i = 0; i < chunk.length; i++) {
        const image = chunk[i];
        const evalResult = evalResults[i];
        const imgCategory = (image.category || 'face-closeup') as ImageCategory;
        const imgIsBody = BODY_CATEGORIES.includes(imgCategory);

        applyVerdictLogic(evalResult, imgCategory, imgIsBody);
        await writeEvalToDb(evalResult, image, imgCategory, imgIsBody, deps);

        if (evalResult.verdict === 'PASS') {
          passed.push(image);
        } else {
          failed.push(image);
        }
      }
    } catch (err) {
      // Batch parse failed — fall back to single-image evaluation
      console.warn(
        `[LoRA Eval] Batch ${chunkIdx + 1} parse failed: ${err}. Falling back to single-image evaluation.`,
      );

      for (const image of chunk) {
        try {
          const result = await evaluateSingleImage(
            anthropic, portraitUrl, fullBodyUrl, image, deps,
          );
          if (result.verdict === 'PASS') {
            passed.push(image);
          } else {
            failed.push(image);
          }
        } catch (singleErr) {
          console.error(
            `[LoRA Eval] Single-image fallback failed for ${image.prompt_template}: ${singleErr}`,
          );
          failed.push(image);
          await deps.supabase
            .from('lora_dataset_images')
            .update({
              eval_status: 'failed',
              eval_details: {
                face_score: 0, body_score: 0, quality_score: 0,
                verdict: 'FAIL',
                issues: [`Evaluation error: ${singleErr}`],
              },
            })
            .eq('id', image.id);
        }
      }
    }
  }

  return { passed, failed };
}

// ── Shared Scoring Logic ────────────────────────────────────────

/**
 * Apply verdict logic to an eval result (shared between batch and single-image paths).
 * Mutates evalResult.verdict and evalResult.issues in place.
 */
function applyVerdictLogic(
  evalResult: EvalDetails,
  category: ImageCategory,
  isBodyShot: boolean,
): void {
  const weightedScore = computeWeightedScore(evalResult, category);

  const noCategoryBelowFloor =
    (isBodyShot || evalResult.face_score >= 5) &&
    evalResult.quality_score >= 6 &&
    (isBodyShot ? evalResult.face_score >= 6 : true) &&
    (category === 'face-closeup' || category === 'head-shoulders' || evalResult.body_score >= 6);

  const proportionsOk = !isBodyShot || evalResult.proportions_realistic !== false;

  if (evalResult.face_only_crop && isBodyShot) {
    evalResult.verdict = 'FAIL';
    evalResult.issues = [
      ...(evalResult.issues || []),
      'Image is a face-only crop — expected full/partial body framing for this category',
    ];
  } else if (!proportionsOk) {
    evalResult.verdict = 'FAIL';
    evalResult.issues = [
      ...(evalResult.issues || []),
      'Anatomically impossible proportions — cartoon-like exaggeration',
    ];
  } else {
    evalResult.verdict = weightedScore >= PIPELINE_CONFIG.minEvalScore && noCategoryBelowFloor
      ? 'PASS'
      : 'FAIL';
  }

  if (evalResult.head_cropped && isBodyShot) {
    evalResult.verdict = 'FAIL';
    evalResult.issues = [
      ...(evalResult.issues || []),
      'head_cropped: Head not fully visible in body shot',
    ];
  }
}

/**
 * Write evaluation result to database for a single image.
 */
async function writeEvalToDb(
  evalResult: EvalDetails,
  image: LoraDatasetImageRow,
  category: ImageCategory,
  isBodyShot: boolean,
  deps: QualityEvaluatorDeps,
): Promise<void> {
  const weightedScore = computeWeightedScore(evalResult, category);

  const evalNotes = evalResult.head_cropped && isBodyShot
    ? 'head_cropped: Head not fully visible in body shot'
    : evalResult.face_only_crop && isBodyShot
      ? 'face_only_crop: Body not visible in body-category image'
      : undefined;

  const evalStatus = evalResult.verdict === 'PASS' ? 'passed' : 'failed';

  await deps.supabase
    .from('lora_dataset_images')
    .update({
      eval_status: evalStatus,
      eval_score: Math.round(weightedScore * 10) / 10,
      eval_details: evalResult,
      ...(evalNotes ? { eval_notes: evalNotes } : {}),
    })
    .eq('id', image.id);

  console.log(
    `[LoRA Eval] ${evalResult.verdict} ${image.prompt_template} ` +
    `(face=${evalResult.face_score}, body=${evalResult.body_score}, quality=${evalResult.quality_score}, ` +
    `weighted=${weightedScore.toFixed(1)}, category=${category}, type=${isBodyShot ? 'body' : 'face'})`,
  );
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
      return { face: 0.0, body: 0.6, quality: 0.4 };
    case 'body-detail':
      return { face: 0.0, body: 0.7, quality: 0.3 };
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

// ── Single-Image Evaluation (kept as fallback) ──────────────────

const BODY_CATEGORIES: ImageCategory[] = ['waist-up', 'full-body', 'body-detail'];

async function evaluateSingleImage(
  anthropic: Anthropic,
  portraitUrl: string,
  fullBodyUrl: string,
  image: LoraDatasetImageRow,
  deps: QualityEvaluatorDeps,
): Promise<EvalDetails> {
  const category = (image.category || 'face-closeup') as ImageCategory;
  const isBodyShot = BODY_CATEGORIES.includes(category);

  const systemPrompt = isBodyShot
    ? buildBodyEvalPrompt(category)
    : FACE_EVAL_SYSTEM_PROMPT;

  const messageContent: Anthropic.Messages.ContentBlockParam[] = isBodyShot
    ? [
        { type: 'text', text: 'REFERENCE FULL-BODY (approved — body proportions ground truth):' },
        { type: 'image', source: { type: 'url', url: fullBodyUrl } },
        {
          type: 'text',
          text: `GENERATED IMAGE (${image.prompt_template}, category: ${image.category}, source: ${image.source}):`,
        },
        { type: 'image', source: { type: 'url', url: image.image_url } },
        { type: 'text', text: 'Evaluate the generated body shot against the reference. Respond with JSON only.' },
      ]
    : [
        { type: 'text', text: 'REFERENCE PORTRAIT (approved — face ground truth):' },
        { type: 'image', source: { type: 'url', url: portraitUrl } },
        { type: 'text', text: 'REFERENCE FULL-BODY (approved — body type ground truth):' },
        { type: 'image', source: { type: 'url', url: fullBodyUrl } },
        {
          type: 'text',
          text: `GENERATED IMAGE (${image.prompt_template}, category: ${image.category}, source: ${image.source}):`,
        },
        { type: 'image', source: { type: 'url', url: image.image_url } },
        { type: 'text', text: 'Evaluate the generated image against both references. Respond with JSON only.' },
      ];

  const response = await anthropicCreateWithRetry(
    anthropic,
    {
      model: EVALUATION_MODEL,
      max_tokens: 256,
      system: systemPrompt,
      messages: [{ role: 'user', content: messageContent }],
    },
    { label: `eval ${image.prompt_template}` },
  );

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
      `[LoRA Eval] Failed to parse eval response for ${image.prompt_template}: ${responseText}`,
    );
    evalResult = {
      face_score: 0,
      body_score: 0,
      quality_score: 0,
      verdict: 'FAIL',
      issues: ['Failed to parse evaluation response'],
    };
  }

  applyVerdictLogic(evalResult, category, isBodyShot);
  await writeEvalToDb(evalResult, image, category, isBodyShot, deps);

  return evalResult;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
