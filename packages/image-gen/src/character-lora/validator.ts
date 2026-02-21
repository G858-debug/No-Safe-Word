// Stage 5: Post-Training Validation
// Generates test images using the trained LoRA via the existing ComfyUI pipeline,
// then evaluates them against the reference portrait using Claude Vision.

import Anthropic from '@anthropic-ai/sdk';
import type { CharacterInput, ValidationResult } from './types';
import { PIPELINE_CONFIG } from './types';
import {
  buildPortraitWorkflow,
  submitRunPodJob,
  waitForRunPodResult,
} from '../index';

const VALIDATION_MODEL = 'claude-sonnet-4-6';

/**
 * 6 test prompts covering diverse scenarios.
 * Gender tag (man/woman) is substituted at runtime.
 */
function getValidationPrompts(genderTag: string): Array<{ prompt: string; description: string }> {
  return [
    {
      prompt: `tok ${genderTag}, portrait photo, front view, neutral expression, studio lighting, photorealistic`,
      description: 'Basic portrait',
    },
    {
      prompt: `tok ${genderTag}, three-quarter view portrait, slight smile, natural window lighting, photorealistic`,
      description: 'Different angle',
    },
    {
      prompt: `tok ${genderTag}, wearing an elegant red dress, standing pose, evening lighting, photorealistic`,
      description: 'Different clothing',
    },
    {
      prompt: `tok ${genderTag}, sitting at a restaurant table, warm candlelight, glass of wine, relaxed expression, photorealistic`,
      description: 'Scene context',
    },
    {
      prompt: `tok ${genderTag}, dramatic side lighting, half face in shadow, moody atmosphere, close-up portrait, photorealistic`,
      description: 'Dramatic lighting',
    },
    {
      prompt: `tok ${genderTag}, lying on a bed, silk sheets, soft bedroom lighting, looking at camera, intimate expression, photorealistic`,
      description: 'Intimate context',
    },
  ];
}

interface ValidatorDeps {
  supabase: {
    from: (table: string) => any;
    storage: { from: (bucket: string) => any };
  };
}

/**
 * Validate a trained LoRA by generating test images and evaluating them.
 *
 * Uses the existing ComfyUI/RunPod pipeline with the character LoRA
 * injected into the workflow. Claude Vision evaluates face consistency
 * against the reference portrait.
 */
export async function validateLora(
  character: CharacterInput,
  loraFilename: string,
  loraStorageUrl: string,
  loraId: string,
  deps: ValidatorDeps,
): Promise<ValidationResult> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Missing ANTHROPIC_API_KEY environment variable');
  }

  const genderTag = character.gender.toLowerCase() === 'male' ? 'man' : 'woman';
  const prompts = getValidationPrompts(genderTag);

  console.log(`[LoRA Validate] Running ${prompts.length} test generations...`);

  // Fetch reference image as base64 for comparison
  const referenceBase64 = await fetchImageAsBase64(character.approvedImageUrl);

  // Generate test images using the LoRA
  const testResults: ValidationResult['testResults'] = [];

  for (let i = 0; i < prompts.length; i++) {
    const { prompt, description } = prompts[i];
    console.log(`[LoRA Validate] Test ${i + 1}/${prompts.length}: ${description}`);

    try {
      // Build a portrait workflow with the character LoRA injected
      const workflow = buildPortraitWorkflow({
        positivePrompt: prompt,
        width: 1024,
        height: 1024,
        seed: 42 + i,
        checkpointName: 'lustify-v5-endgame.safetensors',
        cfg: 4.0,
        loras: [
          {
            filename: `characters/${loraFilename}`,
            strengthModel: 0.8,
            strengthClip: 0.8,
          },
          // Keep detail tweaker for quality
          {
            filename: 'detail-tweaker-xl.safetensors',
            strengthModel: 0.5,
            strengthClip: 0.5,
          },
        ],
      });

      // Submit to RunPod with character_lora_downloads for on-the-fly download
      const { jobId } = await submitRunPodJob(workflow, undefined);

      // Note: The RunPod worker will need to download the LoRA file.
      // For now, we pass the download URL in the workflow metadata.
      // The worker handler intercepts this before running the workflow.

      const { imageBase64 } = await waitForRunPodResult(jobId, 300000, 3000);

      // Evaluate with Claude Vision
      const faceScore = await evaluateTestImage(
        anthropic,
        referenceBase64,
        imageBase64,
        description,
      );

      testResults.push({
        prompt,
        faceScore,
        passed: faceScore >= PIPELINE_CONFIG.minValidationFaceScore,
      });

      console.log(
        `[LoRA Validate] ${description}: face_score=${faceScore} ${faceScore >= PIPELINE_CONFIG.minValidationFaceScore ? 'PASS' : 'FAIL'}`
      );
    } catch (error) {
      console.error(`[LoRA Validate] Test failed for "${description}": ${error}`);
      testResults.push({
        prompt,
        faceScore: 0,
        passed: false,
      });
    }
  }

  // Calculate overall result
  const passedCount = testResults.filter((r) => r.passed).length;
  const averageFaceScore =
    testResults.reduce((sum, r) => sum + r.faceScore, 0) / testResults.length;
  const overallPass = passedCount >= PIPELINE_CONFIG.minValidationPasses;

  console.log(
    `[LoRA Validate] Result: ${passedCount}/${testResults.length} passed, avg score=${averageFaceScore.toFixed(1)} → ${overallPass ? 'PASS' : 'FAIL'}`
  );

  // Update DB
  await deps.supabase
    .from('character_loras')
    .update({
      validation_score: Math.round(averageFaceScore * 10) / 10,
    })
    .eq('id', loraId);

  return {
    overallPass,
    averageFaceScore,
    testResults,
  };
}

// ── Internal helpers ────────────────────────────────────────────

async function evaluateTestImage(
  anthropic: Anthropic,
  referenceBase64: string,
  testImageBase64: string,
  description: string,
): Promise<number> {
  const response = await anthropic.messages.create({
    model: VALIDATION_MODEL,
    max_tokens: 128,
    system: `You are evaluating whether two images show the same person. Score face similarity from 0 to 10 where 10 is identical and 7+ means clearly the same person. Consider: facial structure, skin tone, features. Minor differences in expression, angle, lighting are expected. Respond with JSON only: {"face_score": 8, "notes": "brief reason"}`,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'REFERENCE (approved portrait):' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: referenceBase64 },
          },
          { type: 'text', text: `TEST IMAGE (${description}):` },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: testImageBase64 },
          },
          { type: 'text', text: 'Rate face similarity. JSON only.' },
        ],
      },
    ],
  });

  const responseText =
    response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return 0;
    const parsed = JSON.parse(jsonMatch[0]);
    return typeof parsed.face_score === 'number' ? parsed.face_score : 0;
  } catch {
    console.error(`[LoRA Validate] Failed to parse eval response: ${responseText}`);
    return 0;
  }
}

async function fetchImageAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image from ${url}: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}
