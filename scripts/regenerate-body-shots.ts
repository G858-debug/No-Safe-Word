/**
 * Delete existing body shots for Lindiwe and regenerate 16 using the fixed pipeline.
 *
 * Usage:
 *   npx tsx scripts/regenerate-body-shots.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

// Load env
const envPath = path.resolve(__dirname, '../.env.local');
const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
for (const line of envLines) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

import { generateSdxlBodyShots } from '../packages/image-gen/src/character-lora/dataset-generator';
import { evaluateDataset } from '../packages/image-gen/src/character-lora/quality-evaluator';
import type { CharacterInput, CharacterStructured, LoraDatasetImageRow } from '../packages/image-gen/src/character-lora/types';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const LINDIWE_STORY_CHAR_ID = 'd4dce2ea-464e-456b-98d1-2e14ec8a877f';
const LINDIWE_CHAR_ID = 'efc71e1c-06aa-4cc1-993d-c852636ce10e';

async function main() {
  console.log('=== Regenerate Lindiwe Body Shots ===\n');

  // 1. Find most recent LoRA for Lindiwe
  const { data: loras, error: loraErr } = await (sb as any)
    .from('character_loras')
    .select('id, status, completed_stage')
    .eq('character_id', LINDIWE_CHAR_ID)
    .order('created_at', { ascending: false })
    .limit(1);

  if (loraErr || !loras || loras.length === 0) {
    console.error('No LoRA found for Lindiwe:', loraErr?.message);
    return;
  }

  const lora = loras[0];

  console.log(`LoRA: ${lora.id} (status: ${lora.status})`);

  // 2. Delete existing body shots (source = 'sdxl-img2img')
  const { data: existingBody } = await (sb as any)
    .from('lora_dataset_images')
    .select('id, storage_path')
    .eq('lora_id', lora.id)
    .eq('source', 'sdxl-img2img');

  const bodyImages = (existingBody || []) as Array<{ id: string; storage_path: string }>;
  console.log(`Found ${bodyImages.length} existing body shots to delete`);

  if (bodyImages.length > 0) {
    // Delete from storage
    const storagePaths = bodyImages.map((img) => img.storage_path).filter(Boolean);
    if (storagePaths.length > 0) {
      const { error: storageErr } = await sb.storage
        .from('story-images')
        .remove(storagePaths);
      if (storageErr) {
        console.warn(`Storage deletion warning: ${storageErr.message}`);
      } else {
        console.log(`Deleted ${storagePaths.length} files from storage`);
      }
    }

    // Delete DB rows
    const ids = bodyImages.map((img) => img.id);
    const { error: deleteErr } = await (sb as any)
      .from('lora_dataset_images')
      .delete()
      .in('id', ids);

    if (deleteErr) {
      console.error(`DB deletion failed: ${deleteErr.message}`);
      return;
    }
    console.log(`Deleted ${ids.length} rows from lora_dataset_images`);
  }

  // 3. Get story character + approved images
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

  console.log(`\nPortrait URL: ${portraitUrl.slice(0, 80)}...`);
  console.log(`Full body URL: ${fullBodyUrl.slice(0, 80)}...`);

  // 4. Build CharacterInput
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

  console.log(`\nCharacter: ${character.name}`);
  console.log(`Body type: ${structuredData.bodyType}`);
  console.log(`Skin tone: ${structuredData.skinTone}`);
  console.log(`Ethnicity: ${structuredData.ethnicity}`);

  // 5. Update LoRA status
  await (sb as any)
    .from('character_loras')
    .update({ status: 'generating_dataset', error: null })
    .eq('id', lora.id);

  // 6. Generate 16 body shots
  console.log(`\n--- Generating 16 body shots ---\n`);
  const sdxlResult = await generateSdxlBodyShots(characterInput, lora.id, 16, { supabase: sb });
  console.log(`\nGenerated: ${sdxlResult.records.length} images, ${sdxlResult.failures.length} failures`);

  if (sdxlResult.records.length === 0) {
    console.error('No body images generated!');
    await (sb as any)
      .from('character_loras')
      .update({ status: 'failed', error: 'Body shot regeneration produced no images' })
      .eq('id', lora.id);
    return;
  }

  // 7. Evaluate
  console.log(`\n--- Evaluating ${sdxlResult.records.length} body images ---\n`);
  await (sb as any)
    .from('character_loras')
    .update({ status: 'evaluating' })
    .eq('id', lora.id);

  const evalResult = await evaluateDataset(
    portraitUrl,
    fullBodyUrl,
    sdxlResult.records,
    { supabase: sb },
    { bodyType: structuredData.bodyType, skinTone: structuredData.skinTone },
  );

  console.log(`\nEvaluation: ${evalResult.passed} passed, ${evalResult.failed} failed`);

  // 8. Count total passed (face + body)
  const { count: totalPassed } = await (sb as any)
    .from('lora_dataset_images')
    .select('*', { count: 'exact', head: true })
    .eq('lora_id', lora.id)
    .eq('eval_status', 'passed');

  console.log(`Total passed: ${totalPassed} (face + body)`);

  if ((totalPassed || 0) < 20) {
    console.log(`WARNING: Only ${totalPassed} passed (need 20). Marking as failed.`);
    await (sb as any)
      .from('character_loras')
      .update({
        status: 'failed',
        error: `Only ${totalPassed} images passed after body regeneration (minimum 20).`,
      })
      .eq('id', lora.id);
  } else {
    // Pre-seed human_approved
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

    console.log(`\nSUCCESS: ${totalPassed} images ready for review. Status → awaiting_dataset_approval`);
  }

  console.log('\n--- Done ---');
}

main().catch(console.error);
