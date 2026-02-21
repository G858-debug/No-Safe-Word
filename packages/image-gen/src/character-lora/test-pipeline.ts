#!/usr/bin/env npx tsx
/**
 * Manual test script for the LoRA pipeline stages.
 * Run from the repo root:
 *   npx tsx packages/image-gen/src/character-lora/test-pipeline.ts --stage 1
 *
 * Stages:
 *   1 = Dataset generation (Replicate / Nano Banana Pro)
 *   2 = Quality evaluation (Claude Vision)
 *   3 = Caption generation (local, no API calls)
 *   all = Run stages 1-3 end-to-end
 *
 * Requires: REPLICATE_API_TOKEN and ANTHROPIC_API_KEY in .env.local
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

// Load .env.local
const envPath = path.resolve(__dirname, '../../../../.env.local');
const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
for (const line of envLines) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

import { generateDataset } from './dataset-generator';
import { evaluateDataset } from './quality-evaluator';
import { generateCaptions } from './caption-generator';
import { DATASET_PROMPTS } from './dataset-prompts';
import type { CharacterInput, LoraDatasetImageRow } from './types';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

// ── Config ───────────────────────────────────────────────────
// Use Lindiwe Dlamini as the test character — she has a portrait prompt
const TEST_CHARACTER: CharacterInput = {
  characterId: 'efc71e1c-06aa-4cc1-993d-c852636ce10e',
  characterName: 'Lindiwe Dlamini',
  gender: 'female',
  // We need a real image URL. If there's no stored portrait yet,
  // you can paste a test image URL here:
  approvedImageUrl: process.env.TEST_PORTRAIT_URL || '',
  approvedPrompt: 'young Black South African woman, oval face, high cheekbones, neat braids in low bun, slim curvaceous figure, warm brown skin, dark brown eyes',
};

// Number of prompts to test with (use fewer for quick tests)
const QUICK_TEST_COUNT = 3;

// ── Helpers ──────────────────────────────────────────────────

async function createTestLoraRecord(): Promise<string> {
  const { data, error } = await (supabase as any)
    .from('character_loras')
    .insert({
      character_id: TEST_CHARACTER.characterId,
      filename: '',
      storage_path: '',
      trigger_word: 'tok',
      base_model: 'lustify-v5-endgame',
      training_provider: 'replicate',
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create test LoRA record: ${error.message}`);
  return data.id;
}

async function getDatasetImages(loraId: string): Promise<LoraDatasetImageRow[]> {
  const { data, error } = await (supabase as any)
    .from('lora_dataset_images')
    .select('*')
    .eq('lora_id', loraId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to fetch dataset images: ${error.message}`);
  return data || [];
}

// ── Stage Runners ────────────────────────────────────────────

async function testStage1(loraId: string, quick: boolean) {
  console.log('\n=== STAGE 1: Dataset Generation ===\n');

  if (!TEST_CHARACTER.approvedImageUrl) {
    console.error('ERROR: No approvedImageUrl set. Set TEST_PORTRAIT_URL in .env.local or edit this script.');
    process.exit(1);
  }

  const promptCount = quick ? QUICK_TEST_COUNT : undefined;
  console.log(`Generating ${promptCount || DATASET_PROMPTS.length} images via Nano Banana Pro...`);
  console.log(`Character: ${TEST_CHARACTER.characterName}`);
  console.log(`Reference: ${TEST_CHARACTER.approvedImageUrl.substring(0, 80)}...`);
  console.log(`LoRA ID: ${loraId}`);

  const result = await generateDataset(TEST_CHARACTER, loraId, { supabase }, promptCount);

  console.log('\n--- Stage 1 Results ---');
  console.log(`Generated: ${result.generatedCount}`);
  console.log(`Failed: ${result.failedCount}`);
  console.log(`Images stored in Supabase Storage: character-loras/datasets/${loraId}/`);

  return result;
}

async function testStage2(loraId: string) {
  console.log('\n=== STAGE 2: Quality Evaluation ===\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ERROR: No ANTHROPIC_API_KEY set in .env.local');
    process.exit(1);
  }

  const images = await getDatasetImages(loraId);
  if (images.length === 0) {
    console.error('ERROR: No dataset images found. Run stage 1 first.');
    process.exit(1);
  }

  console.log(`Evaluating ${images.length} images with Claude Vision...`);
  console.log(`Reference: ${TEST_CHARACTER.approvedImageUrl.substring(0, 80)}...`);

  const result = await evaluateDataset(
    TEST_CHARACTER.approvedImageUrl,
    images,
    { supabase },
  );

  console.log('\n--- Stage 2 Results ---');
  console.log(`Evaluated: ${result.totalEvaluated}`);
  console.log(`Passed: ${result.passed}`);
  console.log(`Failed: ${result.failed}`);

  return result;
}

async function testStage3(loraId: string) {
  console.log('\n=== STAGE 3: Caption Generation ===\n');

  const images = await getDatasetImages(loraId);
  const passedImages = images.filter((img) => img.eval_status === 'passed');

  if (passedImages.length === 0) {
    console.log('No passed images found. Using all images for captioning test...');
  }

  const imagesToCaption = passedImages.length > 0 ? passedImages : images;
  if (imagesToCaption.length === 0) {
    console.error('ERROR: No dataset images found. Run stage 1 first.');
    process.exit(1);
  }

  console.log(`Generating captions for ${imagesToCaption.length} images...`);

  const result = await generateCaptions(
    imagesToCaption,
    TEST_CHARACTER.gender,
    { supabase },
  );

  console.log('\n--- Stage 3 Results ---');
  console.log(`Captioned: ${result.captionedCount}`);
  console.log('\nSample captions:');
  for (const sample of result.captions.slice(0, 3)) {
    console.log(`  [${sample.promptId}] ${sample.caption}`);
  }

  return result;
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const stage = process.argv[2]?.replace('--stage=', '').replace('--stage', '') || process.argv[3] || '1';
  const quick = process.argv.includes('--quick');

  console.log('╔══════════════════════════════════════════╗');
  console.log('║   LoRA Pipeline Test Runner              ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`Stage: ${stage}, Quick mode: ${quick}`);

  // Check for existing test LoRA or create one
  let loraId: string;
  const existingLoraId = process.argv.find((a) => a.startsWith('--lora-id='))?.split('=')[1];

  if (existingLoraId) {
    loraId = existingLoraId;
    console.log(`Using existing LoRA record: ${loraId}`);
  } else if (stage === '2' || stage === '3') {
    // For stages 2-3, we need an existing LoRA with dataset images
    console.error('ERROR: Stages 2-3 require --lora-id=<id> from a previous stage 1 run.');
    process.exit(1);
  } else {
    loraId = await createTestLoraRecord();
    console.log(`Created test LoRA record: ${loraId}`);
  }

  try {
    if (stage === '1' || stage === 'all') {
      await testStage1(loraId, quick);
    }
    if (stage === '2' || stage === 'all') {
      await testStage2(loraId);
    }
    if (stage === '3' || stage === 'all') {
      await testStage3(loraId);
    }

    console.log('\n✓ Test complete!');
    console.log(`LoRA ID: ${loraId} (use --lora-id=${loraId} for subsequent stages)`);
  } catch (error) {
    console.error('\n✗ Test failed:', error);
    process.exit(1);
  }
}

main();
