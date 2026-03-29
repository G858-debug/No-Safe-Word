/**
 * Pony LoRA validation — generates test images with the trained LoRA
 * using CyberRealistic Pony and evaluates face consistency via Claude Vision.
 *
 * Mirrors the Flux validator (character-lora/validator.ts) but uses
 * buildPonyWorkflow instead of buildKontextWorkflow.
 */

import Anthropic from '@anthropic-ai/sdk';
import { buildPonyWorkflow } from './pony-workflow-builder';
import { buildPonyQualityPrefix, buildPonyNegativePrompt } from './pony-prompt-builder';
import { submitRunPodJob, waitForRunPodResult } from './runpod';
import { anthropicCreateWithRetry } from './anthropic-retry';

const VALIDATION_MODEL = 'claude-sonnet-4-6';

/**
 * 6 test prompts in booru tag format for Pony validation.
 * Trigger word 'tok' is prepended; gender tag substituted at runtime.
 */
function getValidationPrompts(genderTag: string): Array<{ tags: string; description: string }> {
  return [
    {
      tags: `${genderTag}, portrait, front view, neutral expression, studio lighting, clean background, photorealistic`,
      description: 'Basic portrait',
    },
    {
      tags: `${genderTag}, three-quarter view, slight smile, natural window lighting, indoor, medium shot, photorealistic`,
      description: 'Different angle',
    },
    {
      tags: `${genderTag}, elegant red dress, standing, evening lighting, warm tones, full body, photorealistic`,
      description: 'Different clothing',
    },
    {
      tags: `${genderTag}, sitting at table, restaurant interior, warm candlelight, wine glass, relaxed expression, medium shot, photorealistic`,
      description: 'Scene context',
    },
    {
      tags: `${genderTag}, dramatic side lighting, half face in shadow, moody, close-up, portrait, photorealistic`,
      description: 'Dramatic lighting',
    },
    {
      tags: `${genderTag}, lying on bed, silk sheets, soft bedroom lighting, looking at viewer, intimate expression, photorealistic`,
      description: 'Intimate context',
    },
  ];
}

interface PonyValidatorDeps {
  supabase: {
    from: (table: string) => any;
    storage: { from: (bucket: string) => any };
  };
}

export interface PonyValidationResult {
  passed: boolean;
  passedCount: number;
  totalCount: number;
  averageFaceScore: number;
  testResults: Array<{
    tags: string;
    faceScore: number;
    passed: boolean;
  }>;
}

/**
 * Validate a trained Pony/SDXL LoRA by generating test images and scoring them.
 */
export async function validatePonyLora(
  character: {
    gender: string;
    approvedImageUrl: string;
  },
  loraFilename: string,
  loraStorageUrl: string,
  triggerWord: string,
  loraId: string,
  deps: PonyValidatorDeps,
): Promise<PonyValidationResult> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Missing ANTHROPIC_API_KEY environment variable');
  }

  const genderTag = character.gender.toLowerCase() === 'male' ? '1boy' : '1girl';
  const prompts = getValidationPrompts(genderTag);
  const ponyEndpointId = process.env.RUNPOD_PONY_ENDPOINT_ID;

  console.log(`[Pony Validate] Running ${prompts.length} test generations...`);

  const referenceBase64 = await fetchImageAsBase64(character.approvedImageUrl);

  const testResults: PonyValidationResult['testResults'] = [];
  const MIN_FACE_SCORE = 7;
  const MIN_PASSES = 5;

  for (let i = 0; i < prompts.length; i++) {
    const { tags, description } = prompts[i];
    console.log(`[Pony Validate] Test ${i + 1}/${prompts.length}: ${description}`);

    try {
      const qualityPrefix = buildPonyQualityPrefix('sfw');
      const positivePrompt = `${qualityPrefix}, ${triggerWord}, ${tags}`;
      const negativePrompt = buildPonyNegativePrompt('sfw');

      const workflow = buildPonyWorkflow({
        positivePrompt,
        negativePrompt,
        width: 1024,
        height: 1024,
        seed: 42 + i,
        filenamePrefix: `pony_validate_${loraId}`,
        loras: [
          {
            filename: `characters/${loraFilename}`,
            strengthModel: 0.8,
            strengthClip: 0.8,
          },
        ],
      });

      const { jobId } = await submitRunPodJob(
        workflow,
        undefined,
        [{ filename: `characters/${loraFilename}`, url: loraStorageUrl }],
        ponyEndpointId,
      );

      const { imageBase64 } = await waitForRunPodResult(jobId, 300000, 3000, ponyEndpointId);

      const faceScore = await evaluateTestImage(
        anthropic,
        referenceBase64,
        imageBase64,
        description,
      );

      testResults.push({
        tags,
        faceScore,
        passed: faceScore >= MIN_FACE_SCORE,
      });

      console.log(
        `[Pony Validate] ${description}: face_score=${faceScore} ${faceScore >= MIN_FACE_SCORE ? 'PASS' : 'FAIL'}`,
      );
    } catch (error) {
      console.error(`[Pony Validate] Test failed for "${description}": ${error}`);
      testResults.push({ tags, faceScore: 0, passed: false });
    }
  }

  const passedCount = testResults.filter((r) => r.passed).length;
  const averageFaceScore =
    testResults.reduce((sum, r) => sum + r.faceScore, 0) / testResults.length;
  const overallPass = passedCount >= MIN_PASSES;

  console.log(
    `[Pony Validate] Result: ${passedCount}/${testResults.length} passed, avg=${averageFaceScore.toFixed(1)} → ${overallPass ? 'PASS' : 'FAIL'}`,
  );

  await deps.supabase
    .from('character_loras')
    .update({ validation_score: averageFaceScore })
    .eq('id', loraId);

  return {
    passed: overallPass,
    passedCount,
    totalCount: testResults.length,
    averageFaceScore,
    testResults,
  };
}

// ── Helpers ──

async function fetchImageAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch image: ${url}`);
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

async function evaluateTestImage(
  anthropic: Anthropic,
  referenceBase64: string,
  testBase64: string,
  description: string,
): Promise<number> {
  const message = await anthropicCreateWithRetry(anthropic, {
    model: VALIDATION_MODEL,
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: referenceBase64 },
          },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: testBase64 },
          },
          {
            type: 'text',
            text: `Image 1 is the reference portrait. Image 2 is a "${description}" test generation using a trained LoRA.

Rate how well Image 2 preserves the person's face identity from Image 1 on a scale of 0-10.
Consider: facial structure, skin tone, hair, eyes, nose, mouth shape, overall likeness.
Ignore differences in clothing, pose, lighting, background, and art style.

Respond with ONLY a single number 0-10, nothing else.`,
          },
        ],
      },
    ],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '0';
  const score = parseInt(text, 10);
  return isNaN(score) ? 0 : Math.min(10, Math.max(0, score));
}
