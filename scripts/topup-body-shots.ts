/**
 * Generate additional body shots for Lindiwe without deleting existing ones.
 *
 * Usage:
 *   npx tsx scripts/topup-body-shots.ts [count]
 *   Default count: 5
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

// Load env (don't overwrite shell env vars)
const envPath = path.resolve(__dirname, '../.env.local');
const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
for (const line of envLines) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

import { generateSdxlBodyShots } from '../packages/image-gen/src/character-lora/dataset-generator';
import { evaluateDataset } from '../packages/image-gen/src/character-lora/quality-evaluator';
import type { CharacterInput, CharacterStructured } from '../packages/image-gen/src/character-lora/types';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const LINDIWE_STORY_CHAR_ID = 'd4dce2ea-464e-456b-98d1-2e14ec8a877f';
const LINDIWE_CHAR_ID = 'efc71e1c-06aa-4cc1-993d-c852636ce10e';

async function main() {
  const count = parseInt(process.argv[2] || '5', 10);
  console.log(`=== Top-up ${count} Body Shots for Lindiwe ===\n`);

  // 1. Find most recent LoRA
  const { data: loras, error: loraErr } = await (sb as any)
    .from('character_loras')
    .select('id, status, completed_stage')
    .eq('character_id', LINDIWE_CHAR_ID)
    .order('created_at', { ascending: false })
    .limit(1);

  if (loraErr || !loras || loras.length === 0) {
    console.error('No LoRA found:', loraErr?.message);
    return;
  }

  const lora = loras[0];
  console.log(`LoRA: ${lora.id} (status: ${lora.status})`);

  // 2. Count existing body shots
  const { count: existingCount } = await (sb as any)
    .from('lora_dataset_images')
    .select('*', { count: 'exact', head: true })
    .eq('lora_id', lora.id)
    .eq('source', 'sdxl-img2img');

  console.log(`Existing body shots: ${existingCount}`);

  // 3. Get character data
  const { data: storyChar } = await (sb as any)
    .from('story_characters')
    .select(`
      id, character_id, approved_image_id, approved_seed, approved_prompt,
      approved_fullbody_image_id, approved_fullbody_seed,
      characters ( id, name, description )
    `)
    .eq('id', LINDIWE_STORY_CHAR_ID)
    .single();

  if (!storyChar) {
    console.error('Story character not found');
    return;
  }

  const character = storyChar.characters as { id: string; name: string; description: Record<string, any> };
  const desc = character.description as Record<string, string>;

  const [portraitImage, fullBodyImage] = await Promise.all([
    (sb as any).from('images').select('stored_url, sfw_url').eq('id', storyChar.approved_image_id).single(),
    (sb as any).from('images').select('stored_url, sfw_url').eq('id', storyChar.approved_fullbody_image_id).single(),
  ]);

  const portraitUrl = portraitImage.data?.sfw_url || portraitImage.data?.stored_url;
  const fullBodyUrl = fullBodyImage.data?.sfw_url || fullBodyImage.data?.stored_url;

  if (!portraitUrl || !fullBodyUrl) {
    console.error('Missing approved image URLs');
    return;
  }

  const structuredData: CharacterStructured = {
    gender: desc.gender || 'female',
    ethnicity: desc.ethnicity || '',
    bodyType: desc.bodyType || '',
    skinTone: desc.skinTone || '',
    hairColor: desc.hairColor || '',
    hairStyle: desc.hairStyle || '',
    eyeColor: desc.eyeColor || '',
    age: desc.age || '',
    distinguishingFeatures: desc.distinguishingFeatures,
  };

  const characterInput: CharacterInput = {
    characterId: character.id,
    characterName: character.name,
    gender: 'female',
    approvedImageUrl: portraitUrl,
    approvedPrompt: storyChar.approved_prompt || '',
    fullBodyImageUrl: fullBodyUrl,
    fullBodySeed: storyChar.approved_fullbody_seed || 42,
    portraitSeed: storyChar.approved_seed || 42,
    structuredData,
    pipelineType: 'story_character',
  };

  // 4. Generate additional body shots
  console.log(`\n--- Generating ${count} additional body shots ---\n`);
  const sdxlResult = await generateSdxlBodyShots(characterInput, lora.id, count, { supabase: sb });
  console.log(`\nGenerated: ${sdxlResult.records.length} images, ${sdxlResult.failures.length} failures`);

  if (sdxlResult.records.length === 0) {
    console.error('No images generated!');
    return;
  }

  // 5. Evaluate new images only
  console.log(`\n--- Evaluating ${sdxlResult.records.length} new body images ---\n`);
  const evalResult = await evaluateDataset(
    portraitUrl,
    fullBodyUrl,
    sdxlResult.records,
    { supabase: sb },
    { bodyType: structuredData.bodyType, skinTone: structuredData.skinTone },
  );

  console.log(`\nEvaluation: ${evalResult.passed} passed, ${evalResult.failed} failed`);

  // 6. Count total passed
  const { count: totalPassed } = await (sb as any)
    .from('lora_dataset_images')
    .select('*', { count: 'exact', head: true })
    .eq('lora_id', lora.id)
    .eq('eval_status', 'passed');

  console.log(`Total passed: ${totalPassed} (face + body)`);

  // Pre-seed human_approved for new images
  await (sb as any)
    .from('lora_dataset_images')
    .update({ human_approved: true })
    .eq('lora_id', lora.id)
    .eq('eval_status', 'passed');

  await (sb as any)
    .from('lora_dataset_images')
    .update({ human_approved: false })
    .eq('lora_id', lora.id)
    .in('eval_status', ['failed', 'replaced']);

  await (sb as any)
    .from('character_loras')
    .update({
      status: 'awaiting_dataset_approval',
      completed_stage: 'evaluation',
      error: null,
    })
    .eq('id', lora.id);

  console.log(`\nSUCCESS: ${totalPassed} total images ready for review.`);
  console.log('\n--- Done ---');
}

main().catch(console.error);
