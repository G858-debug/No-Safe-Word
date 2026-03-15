/**
 * Retrain LoRA pipelines for all 4 characters from scratch.
 * Archives existing failed LoRAs, creates new records, runs pipeline.
 *
 * Usage:
 *   npx tsx scripts/retrain-all-characters.ts --dry-run
 *   npx tsx scripts/retrain-all-characters.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(__dirname, '../.env.local');
const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
for (const line of envLines) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

import { createClient } from '@supabase/supabase-js';
import { runPipeline } from '../packages/image-gen/src/character-lora/pipeline';
import type { CharacterInput, CharacterStructured } from '../packages/image-gen/src/character-lora/types';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const dryRun = process.argv.includes('--dry-run');

const STORY_CHAR_IDS = [
  '18ff00c0-5fac-481d-9573-febce9106b4c', // Zanele
  '25c35710-b1b5-4232-946c-3cbce3bcca99', // Langa Mkhize
  'cc70f7f8-6731-472b-b2f7-ed42d772f1de', // Sibusiso Ndlovu
  'd4dce2ea-464e-456b-98d1-2e14ec8a877f', // Lindiwe Dlamini
];

async function retrainCharacter(storyCharId: string) {
  // Fetch full story_characters data with joins
  const { data: sc, error: scErr } = await (sb as any)
    .from('story_characters')
    .select(`
      id, character_id, approved_image_id, approved_seed, approved_prompt,
      approved_fullbody_image_id, approved_fullbody_seed,
      characters ( id, name, description )
    `)
    .eq('id', storyCharId)
    .single();

  if (scErr || !sc) {
    console.error(`[Retrain] Could not find story character ${storyCharId}:`, scErr);
    return;
  }

  const char = sc.characters as { id: string; name: string; description: Record<string, string> };
  const desc = char.description as Record<string, string>;

  console.log(`\n${'='.repeat(55)}`);
  console.log(`${char.name} | story_char: ${storyCharId}`);

  // Fetch image URLs
  const [portraitImg, fullBodyImg] = await Promise.all([
    (sb as any).from('images').select('stored_url, sfw_url').eq('id', sc.approved_image_id).single(),
    (sb as any).from('images').select('stored_url, sfw_url').eq('id', sc.approved_fullbody_image_id).single(),
  ]);

  const portraitUrl = portraitImg.data?.sfw_url || portraitImg.data?.stored_url;
  const fullBodyUrl = fullBodyImg.data?.sfw_url || fullBodyImg.data?.stored_url;

  if (!portraitUrl || !fullBodyUrl) {
    console.error(`[Retrain] Missing image URLs for ${char.name}`);
    return;
  }

  console.log(`Portrait: ${portraitUrl.slice(0, 60)}...`);
  console.log(`Full body: ${fullBodyUrl.slice(0, 60)}...`);

  if (dryRun) {
    console.log('[DRY RUN] Would archive existing LoRAs and start fresh pipeline');
    return;
  }

  // Archive any existing failed LoRAs
  await (sb as any)
    .from('character_loras')
    .update({ status: 'archived' })
    .eq('character_id', char.id)
    .in('status', ['failed', 'evaluating', 'generating_dataset', 'pending']);

  // Create new LoRA record
  const { data: loraRecord, error: insertErr } = await (sb as any)
    .from('character_loras')
    .insert({
      character_id: char.id,
      filename: '',
      storage_path: '',
      trigger_word: 'tok',
      base_model: 'sdxl',
      training_provider: 'replicate',
      training_params: {},
      dataset_size: 0,
      training_attempts: 0,
      status: 'pending',
    })
    .select('id')
    .single();

  if (insertErr || !loraRecord) {
    console.error(`[Retrain] Failed to create LoRA record for ${char.name}:`, insertErr);
    return;
  }

  // Link to story_characters
  await (sb as any)
    .from('story_characters')
    .update({ active_lora_id: loraRecord.id })
    .eq('id', storyCharId);

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
    characterId: char.id,
    characterName: char.name,
    gender: desc.gender || 'female',
    approvedImageUrl: portraitUrl,
    approvedPrompt: sc.approved_prompt || '',
    fullBodyImageUrl: fullBodyUrl,
    fullBodySeed: sc.approved_fullbody_seed || 42,
    portraitSeed: sc.approved_seed || 42,
    structuredData,
    pipelineType: 'story_character',
  };

  console.log(`[Retrain] Starting pipeline for ${char.name} (loraId: ${loraRecord.id})`);

  // Run pipeline and wait (sequential to avoid API rate limits)
  await runPipeline(characterInput, loraRecord.id, { supabase: sb as any });
  console.log(`[Retrain] Pipeline complete for ${char.name}`);
}

async function main() {
  if (dryRun) console.log('=== DRY RUN — no changes will be made ===\n');

  for (const storyCharId of STORY_CHAR_IDS) {
    await retrainCharacter(storyCharId);
  }

  console.log('\n--- All done ---');
}

main().catch(console.error);
