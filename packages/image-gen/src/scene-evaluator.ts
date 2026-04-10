/**
 * Scene image evaluator — tiered evaluation pipeline for generated images.
 *
 * Tier 0: Pre-flight tag validation (text-only, ~$0.0003) — checks booru tags before GPU spend
 * Tier 1: Person count validation (vision, ~$0.001) — fast-fail on wrong count
 * Tier 2: Full scene evaluation (vision, ~$0.001) — scores setting, clothing, pose, lighting, composition
 *
 * All vision calls use Haiku for cost efficiency. Person count uses Sonnet for accuracy
 * on this critical gate (matching existing person-validator.ts behavior).
 */

import Anthropic from '@anthropic-ai/sdk';
import type { CompositionType } from './scene-profiles';

// ── Types ──

export type FailureCategory =
  | 'corrupted_image'
  | 'wrong_person_count'
  | 'weak_identity'
  | 'wrong_setting'
  | 'wrong_clothing'
  | 'wrong_pose'
  | 'wrong_lighting'
  | 'wrong_composition'
  | 'characters_identical'
  | 'evaluation_error';

export interface EvaluationScores {
  personCount: { expected: number; detected: number; passed: boolean };
  setting: number;
  clothing: number;
  pose: number;
  lighting: number;
  composition: number;
  characterDistinction: number | null;
}

export interface EvaluationResult {
  passed: boolean;
  tier: 0 | 1 | 2;
  scores: EvaluationScores;
  overallScore: number;
  failureCategories: FailureCategory[];
  diagnosis: string;
  rawResponse: Record<string, unknown>;
}

export interface EvaluationContext {
  imageBase64: string;
  originalProse: string;
  booruTags: string;
  compositionType: CompositionType;
  contentMode: 'sfw' | 'nsfw';
  expectedPersonCount: number;
  characterNames: string[];
}

export interface PreflightResult {
  passed: boolean;
  missingElements: string[];
  diagnosis: string;
}

// ── Score Weights ──

const SCORE_WEIGHTS = {
  setting: 0.20,
  clothing: 0.15,
  pose: 0.15,
  lighting: 0.10,
  composition: 0.10,
  characterDistinction: 0.05,
} as const;

const PASS_THRESHOLD = 3.5;
const MIN_INDIVIDUAL_SCORE = 2;

// ── Tier 0: Pre-flight Tag Validation ──

const PREFLIGHT_SYSTEM = `You are a quality-assurance checker for AI image generation tags.
Given an original scene description and the booru-style tags derived from it,
check whether critical scene elements survived the conversion.

Reply with JSON ONLY:
{
  "passed": true/false,
  "missingElements": ["element1", "element2"],
  "diagnosis": "brief explanation"
}

Check for:
- Setting/location (e.g., "mechanic workshop" → should have workshop-related tags)
- Specific clothing items (e.g., "unzipped overalls" → should have overalls tag)
- Character interaction (e.g., "hand on chest" → should have hand placement tags)
- Lighting specifics (e.g., "single work lamp" → should have specific lighting tags)
- Composition (e.g., "two-shot" → should have composition tags)

Only flag elements that are COMPLETELY missing. Minor rephrasing is fine.`;

/**
 * Tier 0: Validate booru tags against the original prose description.
 * Text-only call (no image), very cheap (~$0.0003).
 * Run BEFORE spending GPU credits.
 */
export async function validateTagsPreflight(
  originalProse: string,
  booruTags: string,
): Promise<PreflightResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { passed: true, missingElements: [], diagnosis: 'skipped — no API key' };

  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system: PREFLIGHT_SYSTEM,
      messages: [{
        role: 'user',
        content: `ORIGINAL SCENE:\n${originalProse}\n\nBOORU TAGS:\n${booruTags}`,
      }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
    const parsed = JSON.parse(text);
    return {
      passed: parsed.passed ?? true,
      missingElements: parsed.missingElements ?? [],
      diagnosis: parsed.diagnosis ?? '',
    };
  } catch (err) {
    console.error('[SceneEvaluator] Preflight validation failed:', err instanceof Error ? err.message : err);
    return { passed: true, missingElements: [], diagnosis: 'preflight check failed — proceeding anyway' };
  }
}

// ── Tier 0.5: Corruption Detection ──

/**
 * Detect corrupted/noise images before spending on full evaluation.
 * Uses a single cheap Haiku call to determine if the image is a real photograph
 * or random noise/static/corruption artifacts.
 */
export async function detectCorruptedImage(
  imageBase64: string,
): Promise<{ corrupted: boolean; reason: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { corrupted: false, reason: '' };

  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 32,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBase64 } },
          { type: 'text', text: 'Is this a real photograph/image or is it random noise/static/corrupted pixels? Reply with ONLY "REAL" or "NOISE" followed by a brief reason.' },
        ],
      }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
    const isNoise = text.toUpperCase().startsWith('NOISE');
    if (isNoise) {
      return { corrupted: true, reason: text };
    }
    return { corrupted: false, reason: '' };
  } catch (err) {
    console.error('[SceneEvaluator] Corruption check failed:', err instanceof Error ? err.message : err);
    // Don't block on failure — proceed to normal evaluation
    return { corrupted: false, reason: '' };
  }
}

// ── Tier 1: Person Count ──

/**
 * Tier 1: Validate person count in the generated image.
 * Uses Haiku — counting people is a simple vision task (~$0.0003).
 * Fast-fail: if person count is wrong, skip Tier 2.
 */
export async function validatePersonCount(
  imageBase64: string,
  expectedCount: number,
): Promise<{ detected: number; passed: boolean }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { detected: -1, passed: true };

  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBase64 } },
          { type: 'text', text: 'How many distinct people (full or partial bodies) are visible in this image? Reply with ONLY a single integer.' },
        ],
      }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
    const detected = parseInt(text, 10);
    if (isNaN(detected)) {
      console.error(`[SceneEvaluator] Tier 1: could not parse person count from response: "${text}"`);
      return { detected: -1, passed: false };
    }

    console.log(`[SceneEvaluator] Tier 1: detected ${detected} person(s), expected ${expectedCount}`);
    return { detected, passed: detected >= expectedCount };
  } catch (err) {
    console.error('[SceneEvaluator] Person count failed:', err instanceof Error ? err.message : err);
    return { detected: -1, passed: false };
  }
}

// ── Tier 2: Full Scene Evaluation ──

function buildEvalSystemPrompt(compositionType: CompositionType, contentMode: 'sfw' | 'nsfw'): string {
  const isDual = compositionType !== 'solo';
  return `You are an image quality evaluator for AI-generated scene images.
Score the image against the original scene description on a scale of 1-5 for each dimension.
1 = completely wrong, 2 = mostly wrong, 3 = partially correct, 4 = mostly correct, 5 = perfect match.

Reply with JSON ONLY:
{
  "setting": <1-5>,
  "clothing": <1-5>,
  "pose": <1-5>,
  "lighting": <1-5>,
  "composition": <1-5>,
  ${isDual ? '"characterDistinction": <1-5>,' : ''}
  "diagnosis": "brief explanation of what matches and what doesn't"
}

Scoring guidelines:
- **setting**: Does the environment match? (e.g., "mechanic workshop" should show tools, workbenches, not a living room)
- **clothing**: Do the garments match? (e.g., "overalls" should be overalls, not jeans)
- **pose**: Does the body positioning match? (e.g., "hand on chest" should show hand placement)
- **lighting**: Does the lighting match? (e.g., "single work lamp" should show directed light with shadows)
- **composition**: Does the framing match? (e.g., "two-shot, tight framing" should show both characters framed tightly)
${isDual ? '- **characterDistinction**: Do the two characters look like different people? (different face, body type, hair)' : ''}

This is a ${contentMode.toUpperCase()} ${isDual ? 'dual-character' : 'single-character'} scene.
Be strict but fair. Focus on what the description explicitly asks for.`;
}

/**
 * Tier 2: Full scene evaluation using Claude Vision.
 * Single Haiku call scores all dimensions (~$0.001).
 * Only called if Tier 1 (person count) passes.
 */
export async function evaluateSceneFull(
  ctx: EvaluationContext,
): Promise<EvaluationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return buildPassResult(ctx, 'skipped — no API key');
  }

  // Tier 0.5: Corruption check — detect random noise / non-photographic output.
  // A quick vision call that's cheaper than running full evaluation on garbage data.
  const corruptionCheck = await detectCorruptedImage(ctx.imageBase64);
  if (corruptionCheck.corrupted) {
    console.error(`[SceneEvaluator] CORRUPTED IMAGE DETECTED: ${corruptionCheck.reason}`);
    return {
      passed: false,
      tier: 1,
      scores: {
        personCount: { expected: ctx.expectedPersonCount, detected: 0, passed: false },
        setting: 0, clothing: 0, pose: 0, lighting: 0, composition: 0,
        characterDistinction: null,
      },
      overallScore: 0,
      failureCategories: ['corrupted_image'],
      diagnosis: `Corrupted image: ${corruptionCheck.reason}`,
      rawResponse: { corrupted: true, reason: corruptionCheck.reason },
    };
  }

  // Tier 1: Person count
  const personCheck = await validatePersonCount(ctx.imageBase64, ctx.expectedPersonCount);
  if (!personCheck.passed) {
    return buildFailResult(ctx, personCheck, 1, 'Person count mismatch');
  }

  // Tier 2: Full evaluation
  try {
    const anthropic = new Anthropic({ apiKey });
    const systemPrompt = buildEvalSystemPrompt(ctx.compositionType, ctx.contentMode);

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: ctx.imageBase64 } },
          {
            type: 'text',
            text: `ORIGINAL SCENE DESCRIPTION:\n${ctx.originalProse}\n\nBOORU TAGS USED:\n${ctx.booruTags}\n\nCHARACTERS: ${ctx.characterNames.join(', ')}\nEXPECTED PEOPLE: ${ctx.expectedPersonCount}`,
          },
        ],
      }],
    });

    const rawText = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
    if (!rawText) throw new Error('Empty response from evaluator model');
    // Strip markdown code fences if present (e.g. ```json ... ```)
    const text = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(text);

    const scores: EvaluationScores = {
      personCount: { expected: ctx.expectedPersonCount, detected: personCheck.detected, passed: true },
      setting: clampScore(parsed.setting),
      clothing: clampScore(parsed.clothing),
      pose: clampScore(parsed.pose),
      lighting: clampScore(parsed.lighting),
      composition: clampScore(parsed.composition),
      characterDistinction: ctx.compositionType !== 'solo' ? clampScore(parsed.characterDistinction) : null,
    };

    const overallScore = computeOverallScore(scores);
    const failureCategories = diagnoseFailures(scores);
    const passed = failureCategories.length === 0 && overallScore >= PASS_THRESHOLD;

    const result: EvaluationResult = {
      passed,
      tier: 2,
      scores,
      overallScore,
      failureCategories,
      diagnosis: parsed.diagnosis || '',
      rawResponse: parsed,
    };

    console.log(
      `[SceneEvaluator] Tier 2: overall=${overallScore.toFixed(2)}, passed=${passed}, ` +
      `failures=[${failureCategories.join(', ')}]`,
    );

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[SceneEvaluator] Full evaluation failed:', message);
    throw err;
  }
}

// ── Helpers ──

function clampScore(val: unknown): number {
  const n = typeof val === 'number' ? val : parseInt(String(val), 10);
  if (isNaN(n)) return 3; // default to neutral on parse failure
  return Math.max(1, Math.min(5, n));
}

function computeOverallScore(scores: EvaluationScores): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [key, weight] of Object.entries(SCORE_WEIGHTS)) {
    const score = scores[key as keyof typeof SCORE_WEIGHTS];
    if (score != null) {
      weightedSum += score * weight;
      totalWeight += weight;
    }
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 3;
}

function diagnoseFailures(scores: EvaluationScores): FailureCategory[] {
  const failures: FailureCategory[] = [];

  if (!scores.personCount.passed) failures.push('wrong_person_count');
  if (scores.setting < MIN_INDIVIDUAL_SCORE) failures.push('wrong_setting');
  if (scores.clothing < MIN_INDIVIDUAL_SCORE) failures.push('wrong_clothing');
  if (scores.pose < MIN_INDIVIDUAL_SCORE) failures.push('wrong_pose');
  if (scores.lighting < MIN_INDIVIDUAL_SCORE) failures.push('wrong_lighting');
  if (scores.composition < MIN_INDIVIDUAL_SCORE) failures.push('wrong_composition');
  if (scores.characterDistinction != null && scores.characterDistinction < MIN_INDIVIDUAL_SCORE) {
    failures.push('characters_identical');
  }
  if (scores.characterDistinction != null && scores.characterDistinction < 3) {
    failures.push('weak_identity');
  }

  return failures;
}

function buildPassResult(ctx: EvaluationContext, diagnosis: string): EvaluationResult {
  return {
    passed: true,
    tier: 0,
    scores: {
      personCount: { expected: ctx.expectedPersonCount, detected: ctx.expectedPersonCount, passed: true },
      setting: 5, clothing: 5, pose: 5, lighting: 5, composition: 5,
      characterDistinction: ctx.compositionType !== 'solo' ? 5 : null,
    },
    overallScore: 5,
    failureCategories: [],
    diagnosis,
    rawResponse: {},
  };
}

function buildFailResult(
  ctx: EvaluationContext,
  personCheck: { detected: number; passed: boolean },
  tier: 1 | 2,
  diagnosis: string,
): EvaluationResult {
  return {
    passed: false,
    tier,
    scores: {
      personCount: { expected: ctx.expectedPersonCount, detected: personCheck.detected, passed: false },
      setting: 0, clothing: 0, pose: 0, lighting: 0, composition: 0,
      characterDistinction: ctx.compositionType !== 'solo' ? 0 : null,
    },
    overallScore: 0,
    failureCategories: ['wrong_person_count'],
    diagnosis,
    rawResponse: {},
  };
}
