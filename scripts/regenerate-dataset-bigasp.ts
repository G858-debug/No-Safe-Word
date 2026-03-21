/**
 * Delete existing dataset images for Lindiwe + Zanele and regenerate
 * everything via the bigASP pipeline (NB2 face + SDXL→Flux body).
 *
 * Runs: dataset generation → quality evaluation → awaiting_dataset_approval
 * Stops before captioning/training so Howard can visually inspect.
 *
 * Usage:
 *   npx tsx scripts/regenerate-dataset-bigasp.ts
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

import { generateDataset } from '../packages/image-gen/src/character-lora/dataset-generator';
import { evaluateDataset } from '../packages/image-gen/src/character-lora/quality-evaluator';
import type { CharacterInput, CharacterStructured } from '../packages/image-gen/src/character-lora/types';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const CHARACTERS = [
  {
    name: 'Zanele',
    characterId: 'b4344cb6-1615-4169-9e1c-3e6bbc4bcd2c',
    storyCharId: '18ff00c0-5fac-481d-9573-febce9106b4c',
  },
];

async function deleteExistingDataset(loraId: string, characterName: string): Promise<number> {
  const { data: existing } = await (sb as any)
    .from('lora_dataset_images')
    .select('id, storage_path')
    .eq('lora_id', loraId);

  const images = (existing || []) as Array<{ id: string; storage_path: string }>;
  if (images.length === 0) {
    console.log(`[${characterName}] No existing dataset images to delete`);
    return 0;
  }

  const storagePaths = images.map((img) => img.storage_path).filter(Boolean);
  if (storagePaths.length > 0) {
    const { error: storageErr } = await sb.storage
      .from('story-images')
      .remove(storagePaths);
    if (storageErr) {
      console.warn(`[${characterName}] Storage deletion warning: ${storageErr.message}`);
    }
  }

  const ids = images.map((img) => img.id);
  const { error: deleteErr } = await (sb as any)
    .from('lora_dataset_images')
    .delete()
    .in('id', ids);

  if (deleteErr) {
    throw new Error(`[${characterName}] DB deletion failed: ${deleteErr.message}`);
  }

  console.log(`[${characterName}] Deleted ${ids.length} existing dataset images (storage + DB)`);
  return ids.length;
}

async function processCharacter(char: typeof CHARACTERS[0]) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${char.name} — Full BigASP Dataset Regeneration`);
  console.log(`${'═'.repeat(60)}\n`);

  // 1. Find most recent LoRA
  const { data: loras, error: loraErr } = await (sb as any)
    .from('character_loras')
    .select('id, status, completed_stage')
    .eq('character_id', char.characterId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (loraErr || !loras || loras.length === 0) {
    throw new Error(`[${char.name}] No LoRA record found: ${loraErr?.message}`);
  }

  const lora = loras[0];
  console.log(`[${char.name}] LoRA: ${lora.id} (status: ${lora.status})`);

  // 2. Get story character + approved images
  const { data: storyChar } = await (sb as any)
    .from('story_characters')
    .select(`
      id, character_id, approved_image_id, approved_seed, approved_prompt,
      approved_fullbody_image_id, approved_fullbody_seed,
      characters ( id, name, description )
    `)
    .eq('id', char.storyCharId)
    .single();

  if (!storyChar) throw new Error(`[${char.name}] Story character not found`);

  const character = storyChar.characters as { id: string; name: string; description: Record<string, any> };
  const desc = character.description as Record<string, string>;

  const [portraitImage, fullBodyImage] = await Promise.all([
    (sb as any).from('images').select('stored_url, sfw_url').eq('id', storyChar.approved_image_id).single(),
    (sb as any).from('images').select('stored_url, sfw_url').eq('id', storyChar.approved_fullbody_image_id).single(),
  ]);

  const portraitUrl = portraitImage.data?.sfw_url || portraitImage.data?.stored_url;
  const fullBodyUrl = fullBodyImage.data?.sfw_url || fullBodyImage.data?.stored_url;

  if (!portraitUrl || !fullBodyUrl) {
    throw new Error(`[${char.name}] Missing approved image URLs (portrait: ${!!portraitUrl}, fullbody: ${!!fullBodyUrl})`);
  }

  console.log(`[${char.name}] Portrait: ${portraitUrl.substring(0, 80)}...`);
  console.log(`[${char.name}] Full-body: ${fullBodyUrl.substring(0, 80)}...`);

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

  // 3. Delete ALL existing dataset images
  await deleteExistingDataset(lora.id, char.name);

  // 4. Update LoRA status
  await (sb as any)
    .from('character_loras')
    .update({ status: 'generating_dataset', completed_stage: null, error: null })
    .eq('id', lora.id);

  // 5. Generate full dataset via bigASP pipeline (NB2 face + SDXL→img2img body)
  console.log(`\n[${char.name}] --- Generating full bigASP dataset (NB2 face + SDXL body) ---\n`);
  const datasetResult = await generateDataset(
    characterInput,
    lora.id,
    { supabase: sb },
  );

  console.log(`[${char.name}] Dataset: ${datasetResult.totalGenerated} generated, ${datasetResult.failedPrompts.length} failed`);

  if (datasetResult.totalGenerated === 0) {
    await (sb as any)
      .from('character_loras')
      .update({ status: 'failed', error: 'BigASP dataset generation produced no images' })
      .eq('id', lora.id);
    throw new Error(`[${char.name}] No images generated!`);
  }

  // Checkpoint
  await (sb as any)
    .from('character_loras')
    .update({ status: 'evaluating', completed_stage: 'dataset', dataset_size: datasetResult.totalGenerated })
    .eq('id', lora.id);

  // 6. Evaluate with Claude Vision
  console.log(`\n[${char.name}] --- Evaluating ${datasetResult.totalGenerated} images ---\n`);
  const evalResult = await evaluateDataset(
    portraitUrl,
    fullBodyUrl,
    datasetResult.imageRecords,
    { supabase: sb },
  );

  console.log(`[${char.name}] Evaluation: ${evalResult.passed} passed, ${evalResult.failed} failed`);

  // 7. Count total passed
  const { count: totalPassed } = await (sb as any)
    .from('lora_dataset_images')
    .select('*', { count: 'exact', head: true })
    .eq('lora_id', lora.id)
    .eq('eval_status', 'passed');

  console.log(`[${char.name}] Total passed: ${totalPassed}`);

  // 8. Pre-seed human_approved
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

  // 9. Set status → awaiting_dataset_approval
  await (sb as any)
    .from('character_loras')
    .update({
      status: 'awaiting_dataset_approval',
      completed_stage: 'evaluation',
      error: null,
    })
    .eq('id', lora.id);

  console.log(`\n[${char.name}] ✓ DONE — ${totalPassed} images ready for approval`);
  console.log(`[${char.name}] Status → awaiting_dataset_approval\n`);

  return { name: char.name, loraId: lora.id, totalGenerated: datasetResult.totalGenerated, totalPassed: totalPassed || 0 };
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  BigASP Full Dataset Regeneration — Lindiwe + Zanele   ║');
  console.log('║  Pipeline: NB2 face + SDXL→img2img body → eval → STOP ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const results = [];

  for (const char of CHARACTERS) {
    try {
      const result = await processCharacter(char);
      results.push(result);
    } catch (error) {
      console.error(`\n[${char.name}] FAILED: ${error}`);
      results.push({ name: char.name, error: String(error) });
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('  SUMMARY');
  console.log('═'.repeat(60));
  for (const r of results) {
    if ('error' in r) {
      console.log(`  ${r.name}: FAILED — ${r.error}`);
    } else {
      console.log(`  ${r.name}: ${r.totalGenerated} generated, ${r.totalPassed} passed → awaiting approval`);
    }
  }
  console.log('═'.repeat(60));
}

main().catch(console.error);
