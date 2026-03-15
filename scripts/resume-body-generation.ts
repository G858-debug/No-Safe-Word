/**
 * Resume body shot generation for failed female LoRA pipelines.
 *
 * These characters have 14 passed face/head shots but 0 body shots
 * because the DB source constraint was missing 'sdxl-img2img'.
 * Now that the constraint is fixed (migration 019), this script
 * generates the missing body shots and moves the LoRA to
 * 'awaiting_dataset_approval' for human review.
 *
 * Usage:
 *   npx tsx scripts/resume-body-generation.ts              # run
 *   npx tsx scripts/resume-body-generation.ts --dry-run    # preview only
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

// Load env
const envPath = path.resolve(__dirname, '../.env.local');
const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
for (const line of envLines) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

import { generateSdxlBodyShots, generateSdxlMaleBodyShots } from '../packages/image-gen/src/character-lora/dataset-generator';
import { evaluateDataset } from '../packages/image-gen/src/character-lora/quality-evaluator';
import type { CharacterInput, CharacterStructured, LoraDatasetImageRow } from '../packages/image-gen/src/character-lora/types';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  if (dryRun) console.log('=== DRY RUN — no changes will be made ===\n');

  // Find failed female LoRAs with existing face shots
  const { data: failedLoras } = await (sb as any)
    .from('character_loras')
    .select('id, character_id, status, completed_stage, error')
    .eq('status', 'failed')
    .order('created_at', { ascending: false });

  if (!failedLoras || failedLoras.length === 0) {
    console.log('No failed LoRAs found.');
    return;
  }

  // Filter to LoRAs that have face shots but no body shots
  const candidates: Array<{
    lora: any;
    character: any;
    storyChar: any;
    passedFace: LoraDatasetImageRow[];
    passedBody: LoraDatasetImageRow[];
  }> = [];

  const seenChars = new Set<string>();

  for (const lora of failedLoras) {
    if (seenChars.has(lora.character_id)) continue;
    seenChars.add(lora.character_id);

    // Check images
    const { data: images } = await (sb as any)
      .from('lora_dataset_images')
      .select('*')
      .eq('lora_id', lora.id)
      .eq('eval_status', 'passed');

    const passed = (images || []) as LoraDatasetImageRow[];
    const faceShots = passed.filter((i) => i.source === 'nano-banana');
    const bodyShots = passed.filter((i) => i.source !== 'nano-banana');

    if (faceShots.length === 0 || bodyShots.length > 0) continue; // Skip if no face shots or already has body shots

    // Get character data
    const { data: character } = await (sb as any)
      .from('characters')
      .select('id, name, description')
      .eq('id', lora.character_id)
      .single();

    if (!character) continue;

    const gender = (character.description as any)?.gender || 'unknown';

    // Get story character for approved images
    const { data: storyChar } = await (sb as any)
      .from('story_characters')
      .select(`
        id, character_id, approved_image_id, approved_seed, approved_prompt,
        approved_fullbody_image_id, approved_fullbody_seed
      `)
      .eq('character_id', lora.character_id)
      .eq('approved', true)
      .eq('approved_fullbody', true)
      .limit(1)
      .single();

    if (!storyChar) {
      console.log(`${character.name}: No approved story character found, skipping.`);
      continue;
    }

    candidates.push({ lora, character, storyChar, passedFace: faceShots, passedBody: bodyShots });
  }

  if (candidates.length === 0) {
    console.log('No eligible female LoRAs found (need failed status with face shots but no body shots).');
    return;
  }

  console.log(`Found ${candidates.length} female LoRA(s) to resume body generation:\n`);

  for (const { lora, character, storyChar, passedFace } of candidates) {
    const name = character.name;
    console.log(`${'='.repeat(55)}`);
    console.log(`${name} | LoRA: ${lora.id}`);
    console.log(`Existing: ${passedFace.length} passed face shots, 0 body shots`);
    console.log(`Error: ${lora.error}`);

    if (dryRun) {
      console.log(`[DRY RUN] Would generate ~16 body shots, evaluate, then set to awaiting_dataset_approval`);
      console.log();
      continue;
    }

    try {
      // Build CharacterInput
      const desc = character.description as Record<string, string>;

      const [portraitImage, fullBodyImage] = await Promise.all([
        (sb as any).from('images').select('stored_url, sfw_url').eq('id', storyChar.approved_image_id).single(),
        (sb as any).from('images').select('stored_url, sfw_url').eq('id', storyChar.approved_fullbody_image_id).single(),
      ]);

      const portraitUrl = portraitImage.data?.sfw_url || portraitImage.data?.stored_url;
      const fullBodyUrl = fullBodyImage.data?.sfw_url || fullBodyImage.data?.stored_url;

      if (!portraitUrl || !fullBodyUrl) {
        console.log(`  ERROR: Missing approved image URLs, skipping.`);
        continue;
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
        characterName: name,
        gender: 'female',
        approvedImageUrl: portraitUrl,
        approvedPrompt: storyChar.approved_prompt || '',
        fullBodyImageUrl: fullBodyUrl,
        fullBodySeed: storyChar.approved_fullbody_seed || 42,
        portraitSeed: storyChar.approved_seed || 42,
        structuredData,
        pipelineType: 'story_character',
      };

      // Update status
      await (sb as any)
        .from('character_loras')
        .update({ status: 'generating_dataset', error: null })
        .eq('id', lora.id);

      console.log(`\n  Generating body shots (${gender})...`);
      const generateFn = gender === 'female' ? generateSdxlBodyShots : generateSdxlMaleBodyShots;
      const sdxlResult = await generateFn(characterInput, lora.id, 16, { supabase: sb });
      console.log(`  Generated: ${sdxlResult.records.length} body images, ${sdxlResult.failures.length} failures`);

      if (sdxlResult.records.length === 0) {
        console.log(`  ERROR: No body images generated. Marking as failed.`);
        await (sb as any)
          .from('character_loras')
          .update({ status: 'failed', error: 'Body shot generation produced no images' })
          .eq('id', lora.id);
        continue;
      }

      // Evaluate new body images
      console.log(`\n  Evaluating ${sdxlResult.records.length} new body images...`);
      await (sb as any)
        .from('character_loras')
        .update({ status: 'evaluating' })
        .eq('id', lora.id);

      const evalResult = await evaluateDataset(
        portraitUrl,
        fullBodyUrl,
        sdxlResult.records,
        { supabase: sb },
        {
          bodyType: structuredData.bodyType,
          skinTone: structuredData.skinTone,
        },
      );

      console.log(`  Evaluation: ${evalResult.passed} passed, ${evalResult.failed} failed`);

      // Total passed = existing face shots + new body passes
      const totalPassed = passedFace.length + evalResult.passed;
      console.log(`  Total passed: ${totalPassed} (${passedFace.length} face + ${evalResult.passed} body)`);

      if (totalPassed < 20) {
        console.log(`  WARNING: Only ${totalPassed} passed (need 20). Marking as failed.`);
        await (sb as any)
          .from('character_loras')
          .update({
            status: 'failed',
            error: `Only ${totalPassed} images passed evaluation after body generation (minimum 20 required).`,
          })
          .eq('id', lora.id);
        continue;
      }

      // Pre-seed human_approved on all passed images
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

      // Update to awaiting_dataset_approval
      await (sb as any)
        .from('character_loras')
        .update({
          status: 'awaiting_dataset_approval',
          completed_stage: 'evaluation',
          error: null,
        })
        .eq('id', lora.id);

      console.log(`  SUCCESS: ${totalPassed} images ready for review. Status → awaiting_dataset_approval`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`  FAILED: ${msg}`);
      await (sb as any)
        .from('character_loras')
        .update({ status: 'failed', error: `Body generation resume failed: ${msg}` })
        .eq('id', lora.id);
    }

    console.log();
  }

  console.log('--- Done ---');
}

main().catch(console.error);
