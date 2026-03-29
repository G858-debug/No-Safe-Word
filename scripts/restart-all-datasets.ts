/**
 * Restart dataset generation for ALL characters with approved face + body portraits.
 *
 * For each character:
 *   1. Deletes all existing dataset images (storage + DB)
 *   2. Resets LoRA status to generating_dataset
 *   3. Generates full dataset (NB2 face + SDXL→img2img body for female, NB2 for male)
 *   4. Evaluates all images via Claude Vision
 *   5. Runs replacement rounds for failed images (up to 3 rounds)
 *   6. Pre-seeds human_approved based on eval results
 *   7. Sets status → awaiting_dataset_approval
 *
 * After this script completes, go to the LoRA Studio UI to approve datasets and begin training.
 *
 * Usage:
 *   npx tsx scripts/restart-all-datasets.ts
 *   npx tsx scripts/restart-all-datasets.ts --dry-run    # preview which characters will be processed
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

import { generateDataset, generateReplacements } from '../packages/image-gen/src/character-lora/dataset-generator';
import { evaluateDataset } from '../packages/image-gen/src/character-lora/quality-evaluator';
import { PIPELINE_CONFIG } from '../packages/image-gen/src/character-lora/types';
import type { CharacterInput, CharacterStructured, LoraDatasetImageRow, VariationType, ImageSource } from '../packages/image-gen/src/character-lora/types';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run');
const CHARACTER_FILTER = process.argv
  .find((a) => a.startsWith('--character='))
  ?.replace('--character=', '')
  .split(',')
  .map((n) => n.trim().toLowerCase());

interface DiscoveredCharacter {
  storyCharId: string;
  characterId: string;
  characterName: string;
  gender: string;
  loraId: string;
  loraStatus: string;
  portraitUrl: string;
  fullBodyUrl: string;
  approvedSeed: number;
  fullBodySeed: number;
  approvedPrompt: string;
  description: Record<string, string>;
}

/**
 * Find all story characters that have both approved face + body portraits
 * and have an existing LoRA record.
 */
async function discoverCharacters(): Promise<DiscoveredCharacter[]> {
  // Find all story characters with both approvals
  const { data: storyChars, error } = await (sb as any)
    .from('story_characters')
    .select(`
      id, character_id, approved, approved_fullbody,
      approved_image_id, approved_seed, approved_prompt,
      approved_fullbody_image_id, approved_fullbody_seed,
      characters ( id, name, description )
    `)
    .eq('approved', true)
    .eq('approved_fullbody', true);

  if (error) throw new Error(`Failed to fetch story characters: ${error.message}`);
  if (!storyChars || storyChars.length === 0) {
    console.log('No characters found with both approved face + body portraits.');
    return [];
  }

  const discovered: DiscoveredCharacter[] = [];

  for (const sc of storyChars) {
    const character = sc.characters as { id: string; name: string; description: Record<string, any> };
    if (!character) continue;

    const desc = character.description as Record<string, string>;

    // Find the most recent LoRA for this character
    const { data: loras } = await (sb as any)
      .from('character_loras')
      .select('id, status')
      .eq('character_id', character.id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!loras || loras.length === 0) {
      console.log(`[${character.name}] No LoRA record found — skipping (create one first)`);
      continue;
    }

    // Fetch approved image URLs
    const [portraitImage, fullBodyImage] = await Promise.all([
      (sb as any).from('images').select('stored_url, sfw_url').eq('id', sc.approved_image_id).single(),
      (sb as any).from('images').select('stored_url, sfw_url').eq('id', sc.approved_fullbody_image_id).single(),
    ]);

    const portraitUrl = portraitImage.data?.sfw_url || portraitImage.data?.stored_url;
    const fullBodyUrl = fullBodyImage.data?.sfw_url || fullBodyImage.data?.stored_url;

    if (!portraitUrl || !fullBodyUrl) {
      console.log(`[${character.name}] Missing approved image URLs — skipping`);
      continue;
    }

    discovered.push({
      storyCharId: sc.id,
      characterId: character.id,
      characterName: character.name,
      gender: desc.gender || 'female',
      loraId: loras[0].id,
      loraStatus: loras[0].status,
      portraitUrl,
      fullBodyUrl,
      approvedSeed: sc.approved_seed || 42,
      fullBodySeed: sc.approved_fullbody_seed || 42,
      approvedPrompt: sc.approved_prompt || '',
      description: desc,
    });
  }

  return discovered;
}

async function deleteExistingDataset(loraId: string, name: string): Promise<number> {
  const { data: existing } = await (sb as any)
    .from('lora_dataset_images')
    .select('id, storage_path')
    .eq('lora_id', loraId);

  const images = (existing || []) as Array<{ id: string; storage_path: string }>;
  if (images.length === 0) {
    console.log(`[${name}] No existing dataset images to delete`);
    return 0;
  }

  // Delete from storage
  const storagePaths = images.map((img) => img.storage_path).filter(Boolean);
  if (storagePaths.length > 0) {
    const { error: storageErr } = await sb.storage
      .from('story-images')
      .remove(storagePaths);
    if (storageErr) {
      console.warn(`[${name}] Storage deletion warning: ${storageErr.message}`);
    }
  }

  // Delete from DB
  const ids = images.map((img) => img.id);
  const { error: deleteErr } = await (sb as any)
    .from('lora_dataset_images')
    .delete()
    .in('id', ids);

  if (deleteErr) {
    throw new Error(`[${name}] DB deletion failed: ${deleteErr.message}`);
  }

  console.log(`[${name}] Deleted ${ids.length} existing dataset images (storage + DB)`);
  return ids.length;
}

async function processCharacter(char: DiscoveredCharacter): Promise<{ name: string; totalGenerated: number; totalPassed: number }> {
  const name = char.characterName;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${name} (${char.gender}) — Full Dataset Restart`);
  console.log(`${'═'.repeat(60)}\n`);

  console.log(`[${name}] LoRA: ${char.loraId} (was: ${char.loraStatus})`);
  console.log(`[${name}] Portrait: ${char.portraitUrl.substring(0, 80)}...`);
  console.log(`[${name}] Full-body: ${char.fullBodyUrl.substring(0, 80)}...`);

  const structuredData: CharacterStructured = {
    gender: char.gender,
    ethnicity: char.description.ethnicity || '',
    bodyType: char.description.bodyType || '',
    skinTone: char.description.skinTone || '',
    hairColor: char.description.hairColor || '',
    hairStyle: char.description.hairStyle || '',
    eyeColor: char.description.eyeColor || '',
    age: char.description.age || '',
    distinguishingFeatures: char.description.distinguishingFeatures,
  };

  const characterInput: CharacterInput = {
    characterId: char.characterId,
    characterName: name,
    gender: char.gender,
    approvedImageUrl: char.portraitUrl,
    approvedPrompt: char.approvedPrompt,
    fullBodyImageUrl: char.fullBodyUrl,
    fullBodySeed: char.fullBodySeed,
    portraitSeed: char.approvedSeed,
    structuredData,
    pipelineType: 'story_character',
  };

  // 1. Delete ALL existing dataset images
  await deleteExistingDataset(char.loraId, name);

  // 2. Reset LoRA status
  await (sb as any)
    .from('character_loras')
    .update({ status: 'generating_dataset', completed_stage: null, error: null })
    .eq('id', char.loraId);

  // 3. Generate full dataset
  console.log(`\n[${name}] --- Generating dataset (NB2 face + ${char.gender === 'female' ? 'SDXL→img2img' : 'NB2'} body) ---\n`);

  const datasetResult = await generateDataset(characterInput, char.loraId, { supabase: sb });
  console.log(`[${name}] Dataset: ${datasetResult.totalGenerated} generated, ${datasetResult.failedPrompts.length} failed`);

  if (datasetResult.totalGenerated === 0) {
    await (sb as any)
      .from('character_loras')
      .update({ status: 'failed', error: 'Dataset generation produced no images' })
      .eq('id', char.loraId);
    throw new Error(`[${name}] No images generated!`);
  }

  // Checkpoint: dataset complete
  await (sb as any)
    .from('character_loras')
    .update({ status: 'evaluating', completed_stage: 'dataset', dataset_size: datasetResult.totalGenerated })
    .eq('id', char.loraId);

  // 4. Evaluate with Claude Vision
  console.log(`\n[${name}] --- Evaluating ${datasetResult.totalGenerated} images ---\n`);

  const characterEvalData = {
    bodyType: structuredData.bodyType,
    skinTone: structuredData.skinTone,
  };

  let allImages = [...datasetResult.imageRecords];
  let evalResult = await evaluateDataset(
    char.portraitUrl,
    char.fullBodyUrl,
    allImages,
    { supabase: sb },
    characterEvalData,
  );

  console.log(`[${name}] Initial evaluation: ${evalResult.passed} passed, ${evalResult.failed} failed`);

  // 5. Replacement rounds for failed images (up to 3 rounds)
  let pendingGenerationFailures = [...datasetResult.failedPrompts];

  for (
    let round = 0;
    round < PIPELINE_CONFIG.maxReplacementRounds &&
    evalResult.passed < PIPELINE_CONFIG.targetPassedImages;
    round++
  ) {
    console.log(
      `[${name}] Replacement round ${round + 1}: ${evalResult.passed} passed, need ${PIPELINE_CONFIG.targetPassedImages}` +
      (pendingGenerationFailures.length > 0
        ? ` (+ ${pendingGenerationFailures.length} generation retries)`
        : '')
    );

    // Fetch eval details for failed images
    const failedImages = allImages
      .filter((img) => !evalResult.passedImages.some((p) => p.id === img.id));

    const failedImageIds = failedImages.map((img) => img.id);
    const { data: failedWithDetails } = failedImageIds.length > 0
      ? await (sb as any)
          .from('lora_dataset_images')
          .select('id, eval_details')
          .in('id', failedImageIds)
      : { data: [] };

    const evalDetailsMap = new Map(
      (failedWithDetails || []).map((row: any) => [row.id, row.eval_details])
    );

    const evalFailures = failedImages.map((img) => ({
      promptTemplate: img.prompt_template,
      variationType: img.variation_type as VariationType,
      source: img.source as ImageSource,
      evalDetails: evalDetailsMap.get(img.id),
    }));

    // Mark failed images as replaced
    for (const img of failedImages) {
      await (sb as any)
        .from('lora_dataset_images')
        .update({ eval_status: 'replaced' })
        .eq('id', img.id);
    }

    const allFailures = [
      ...evalFailures,
      ...pendingGenerationFailures.map((f) => ({
        promptTemplate: f.promptTemplate,
        variationType: f.variationType,
      })),
    ];

    const replacements = await generateReplacements(characterInput, char.loraId, allFailures, { supabase: sb }, { round });

    const generatedTemplates = new Set(
      replacements.map((r) => r.prompt_template.replace(/_replacement$/, ''))
    );
    pendingGenerationFailures = pendingGenerationFailures.filter(
      (f) => !generatedTemplates.has(f.promptTemplate)
    );

    if (replacements.length > 0) {
      const replacementEval = await evaluateDataset(
        char.portraitUrl,
        char.fullBodyUrl,
        replacements,
        { supabase: sb },
        characterEvalData,
      );

      evalResult.passedImages = [...evalResult.passedImages, ...replacementEval.passedImages];
      evalResult.passed = evalResult.passedImages.length;
    }

    allImages = [...allImages, ...replacements];
    console.log(`[${name}] After round ${round + 1}: ${evalResult.passed} passed`);
  }

  // 6. Count total passed
  const { count: totalPassed } = await (sb as any)
    .from('lora_dataset_images')
    .select('*', { count: 'exact', head: true })
    .eq('lora_id', char.loraId)
    .eq('eval_status', 'passed');

  console.log(`[${name}] Final count: ${totalPassed} passed images`);

  if ((totalPassed || 0) < PIPELINE_CONFIG.minPassedImages) {
    await (sb as any)
      .from('character_loras')
      .update({ status: 'failed', error: `Only ${totalPassed} images passed (need ${PIPELINE_CONFIG.minPassedImages})` })
      .eq('id', char.loraId);
    throw new Error(`[${name}] Only ${totalPassed} passed — below minimum ${PIPELINE_CONFIG.minPassedImages}`);
  }

  // 7. Pre-seed human_approved
  await (sb as any)
    .from('lora_dataset_images')
    .update({ human_approved: true })
    .eq('lora_id', char.loraId)
    .eq('eval_status', 'passed');

  await (sb as any)
    .from('lora_dataset_images')
    .update({ human_approved: false })
    .eq('lora_id', char.loraId)
    .in('eval_status', ['failed', 'replaced']);

  // 8. Set status → awaiting_dataset_approval
  await (sb as any)
    .from('character_loras')
    .update({
      status: 'awaiting_dataset_approval',
      completed_stage: 'evaluation',
      error: null,
    })
    .eq('id', char.loraId);

  console.log(`\n[${name}] ✓ DONE — ${totalPassed} images ready for approval`);
  console.log(`[${name}] Status → awaiting_dataset_approval\n`);

  return { name, totalGenerated: datasetResult.totalGenerated, totalPassed: totalPassed || 0 };
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Full Dataset Restart — All Approved Characters        ║');
  console.log('║  Pipeline: generate → evaluate → replace → approve     ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // Discover all characters with approved portraits + existing LoRA records
  const characters = await discoverCharacters();

  if (characters.length === 0) {
    console.log('No characters to process.');
    return;
  }

  console.log(`\nFound ${characters.length} character(s) to process:\n`);
  for (const c of characters) {
    console.log(`  • ${c.characterName} (${c.gender}) — LoRA: ${c.loraId} (${c.loraStatus})`);
  }

  if (DRY_RUN) {
    console.log('\n--dry-run flag set — no changes will be made.\n');
    return;
  }

  console.log('');

  const results: Array<{ name: string; totalGenerated?: number; totalPassed?: number; error?: string }> = [];

  const filtered = CHARACTER_FILTER
    ? characters.filter((c) => CHARACTER_FILTER.some((f) => c.characterName.toLowerCase().includes(f)))
    : characters;

  if (filtered.length === 0) {
    console.log(`No characters matched filter: ${CHARACTER_FILTER?.join(', ')}`);
    return;
  }

  for (const char of filtered) {
    try {
      const result = await processCharacter(char);
      results.push(result);
    } catch (error) {
      console.error(`\n[${char.characterName}] FAILED: ${error}`);
      results.push({ name: char.characterName, error: String(error) });
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('  SUMMARY');
  console.log('═'.repeat(60));
  for (const r of results) {
    if (r.error) {
      console.log(`  ${r.name}: FAILED — ${r.error}`);
    } else {
      console.log(`  ${r.name}: ${r.totalGenerated} generated, ${r.totalPassed} passed → awaiting approval`);
    }
  }
  console.log('═'.repeat(60));
  console.log('\nNext step: go to LoRA Studio to approve datasets and begin training.');
}

main().catch(console.error);
