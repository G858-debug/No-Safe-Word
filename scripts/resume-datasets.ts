/**
 * Resume dataset generation for characters that were interrupted mid-pipeline.
 *
 * For each character with status 'generating_dataset' or 'evaluating':
 *   1. Evaluate any pending (unevaluated) images
 *   2. If passed < 25: generate more body shots (SDXL for female, NB2 for male)
 *   3. Evaluate new images
 *   4. Run replacement rounds for failures (up to 3)
 *   5. Pre-seed human_approved, set status → awaiting_dataset_approval
 *
 * Usage:
 *   npx tsx scripts/resume-datasets.ts
 *   npx tsx scripts/resume-datasets.ts --character=zanele,lindiwe
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

import { generateSdxlBodyShots, generateNanoBananaMaleBodyShots, generateReplacements, generateNanoBananaImages } from '../packages/image-gen/src/character-lora/dataset-generator';
import { getNanoBananaPrompts, adaptPromptForGender } from '../packages/image-gen/src/character-lora/dataset-prompts';
import { evaluateDataset } from '../packages/image-gen/src/character-lora/quality-evaluator';
import { PIPELINE_CONFIG } from '../packages/image-gen/src/character-lora/types';
import type { CharacterInput, CharacterStructured, LoraDatasetImageRow, VariationType, ImageSource } from '../packages/image-gen/src/character-lora/types';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const CHARACTER_FILTER = process.argv
  .find((a) => a.startsWith('--character='))
  ?.replace('--character=', '')
  .split(',')
  .map((n) => n.trim().toLowerCase());

async function resumeCharacter(loraId: string, characterName: string, characterInput: CharacterInput, portraitUrl: string, fullBodyUrl: string) {
  const name = characterName;
  const evalData = { bodyType: characterInput.structuredData.bodyType, skinTone: characterInput.structuredData.skinTone };

  // 1. Check current state
  const { data: allDbImages } = await (sb as any)
    .from('lora_dataset_images')
    .select('*')
    .eq('lora_id', loraId)
    .not('eval_status', 'eq', 'replaced');

  const images = (allDbImages || []) as LoraDatasetImageRow[];
  const pending = images.filter((i) => i.eval_status === 'pending');
  const passed = images.filter((i) => i.eval_status === 'passed');
  const failed = images.filter((i) => i.eval_status === 'failed');

  console.log(`[${name}] Current state: ${passed.length} passed, ${failed.length} failed, ${pending.length} pending (${images.length} total active)`);

  // 2. Evaluate any pending images
  if (pending.length > 0) {
    console.log(`[${name}] Evaluating ${pending.length} pending images...`);
    const evalResult = await evaluateDataset(portraitUrl, fullBodyUrl, pending, { supabase: sb }, evalData);
    console.log(`[${name}] Pending evaluation: ${evalResult.passed} passed, ${evalResult.failed} failed`);
  }

  // Re-count after evaluating pending
  const { count: passedCount } = await (sb as any)
    .from('lora_dataset_images')
    .select('*', { count: 'exact', head: true })
    .eq('lora_id', loraId)
    .eq('eval_status', 'passed');

  let totalPassed = passedCount || 0;
  console.log(`[${name}] After pending eval: ${totalPassed} passed`);

  // 3. If we need more images, generate top-ups
  const target = PIPELINE_CONFIG.targetPassedImages; // 25
  if (totalPassed < target) {
    // Figure out what's missing: how many more body/face shots we need
    const { data: currentImages } = await (sb as any)
      .from('lora_dataset_images')
      .select('category, eval_status')
      .eq('lora_id', loraId)
      .eq('eval_status', 'passed');

    const passedByCategory: Record<string, number> = {};
    for (const img of (currentImages || [])) {
      passedByCategory[img.category] = (passedByCategory[img.category] || 0) + 1;
    }

    const passedFace = (passedByCategory['face-closeup'] || 0) + (passedByCategory['head-shoulders'] || 0);
    const passedBody = (passedByCategory['full-body'] || 0) + (passedByCategory['waist-up'] || 0) + (passedByCategory['body-detail'] || 0);

    console.log(`[${name}] Breakdown: ${passedFace} face, ${passedBody} body`);

    const needed = target - totalPassed;

    // Generate body shots first (they don't use NB2 for females)
    const bodyNeeded = Math.max(0, 15 - passedBody);
    const faceNeeded = Math.max(0, needed - Math.min(bodyNeeded, needed));

    if (bodyNeeded > 0 && bodyNeeded <= needed) {
      const bodyToGen = Math.min(bodyNeeded + 3, needed + 3); // generate a few extra for replacement buffer
      console.log(`[${name}] Generating ${bodyToGen} more body shots...`);

      let bodyRecords: LoraDatasetImageRow[];
      if (characterInput.gender === 'female') {
        const result = await generateSdxlBodyShots(characterInput, loraId, bodyToGen, { supabase: sb });
        bodyRecords = result.records;
      } else {
        const result = await generateNanoBananaMaleBodyShots(characterInput, loraId, bodyToGen, { supabase: sb });
        bodyRecords = result.records;
      }

      if (bodyRecords.length > 0) {
        console.log(`[${name}] Evaluating ${bodyRecords.length} new body shots...`);
        const bodyEval = await evaluateDataset(portraitUrl, fullBodyUrl, bodyRecords, { supabase: sb }, evalData);
        console.log(`[${name}] Body eval: ${bodyEval.passed} passed, ${bodyEval.failed} failed`);
      }
    }

    // Re-check passed count
    const { count: afterBodyPassed } = await (sb as any)
      .from('lora_dataset_images')
      .select('*', { count: 'exact', head: true })
      .eq('lora_id', loraId)
      .eq('eval_status', 'passed');

    totalPassed = afterBodyPassed || 0;
    console.log(`[${name}] After body top-up: ${totalPassed} passed`);

    // If still short, generate face shots
    if (totalPassed < target) {
      const faceToGen = Math.min(target - totalPassed + 2, 10); // extra buffer
      console.log(`[${name}] Generating ${faceToGen} more face shots via NB2...`);

      const nbPrompts = getNanoBananaPrompts().map((p) => ({
        ...p,
        prompt: adaptPromptForGender(p.prompt, characterInput.gender),
      }));
      const nbLimited = nbPrompts.slice(0, faceToGen);

      const nbResult = await generateNanoBananaImages(characterInput, loraId, nbLimited, { supabase: sb });
      if (nbResult.records.length > 0) {
        console.log(`[${name}] Evaluating ${nbResult.records.length} new face shots...`);
        const faceEval = await evaluateDataset(portraitUrl, fullBodyUrl, nbResult.records, { supabase: sb }, evalData);
        console.log(`[${name}] Face eval: ${faceEval.passed} passed, ${faceEval.failed} failed`);
      }

      const { count: afterFacePassed } = await (sb as any)
        .from('lora_dataset_images')
        .select('*', { count: 'exact', head: true })
        .eq('lora_id', loraId)
        .eq('eval_status', 'passed');

      totalPassed = afterFacePassed || 0;
      console.log(`[${name}] After face top-up: ${totalPassed} passed`);
    }
  }

  // 4. Run replacement rounds for any remaining failures
  for (let round = 0; round < PIPELINE_CONFIG.maxReplacementRounds && totalPassed < target; round++) {
    const { data: failedImages } = await (sb as any)
      .from('lora_dataset_images')
      .select('*')
      .eq('lora_id', loraId)
      .eq('eval_status', 'failed');

    if (!failedImages || failedImages.length === 0) break;

    console.log(`[${name}] Replacement round ${round + 1}: ${totalPassed} passed, ${failedImages.length} failed`);

    // Get eval details for failed
    const failedIds = failedImages.map((img: any) => img.id);
    const { data: failedWithDetails } = await (sb as any)
      .from('lora_dataset_images')
      .select('id, eval_details')
      .in('id', failedIds);

    const evalDetailsMap = new Map(
      (failedWithDetails || []).map((row: any) => [row.id, row.eval_details])
    );

    const evalFailures = failedImages.map((img: any) => ({
      promptTemplate: img.prompt_template,
      variationType: img.variation_type as VariationType,
      source: img.source as ImageSource,
      evalDetails: evalDetailsMap.get(img.id),
    }));

    // Mark failed as replaced
    for (const img of failedImages) {
      await (sb as any)
        .from('lora_dataset_images')
        .update({ eval_status: 'replaced' })
        .eq('id', img.id);
    }

    const replacements = await generateReplacements(characterInput, loraId, evalFailures, { supabase: sb }, { round });

    if (replacements.length > 0) {
      const replEval = await evaluateDataset(portraitUrl, fullBodyUrl, replacements, { supabase: sb }, evalData);
      console.log(`[${name}] Replacement round ${round + 1}: ${replEval.passed} passed, ${replEval.failed} failed`);
    }

    const { count: afterRepl } = await (sb as any)
      .from('lora_dataset_images')
      .select('*', { count: 'exact', head: true })
      .eq('lora_id', loraId)
      .eq('eval_status', 'passed');

    totalPassed = afterRepl || 0;
    console.log(`[${name}] After round ${round + 1}: ${totalPassed} passed`);
  }

  // 5. Final count
  const { count: finalPassed } = await (sb as any)
    .from('lora_dataset_images')
    .select('*', { count: 'exact', head: true })
    .eq('lora_id', loraId)
    .eq('eval_status', 'passed');

  totalPassed = finalPassed || 0;
  console.log(`[${name}] Final: ${totalPassed} passed images`);

  if (totalPassed < PIPELINE_CONFIG.minPassedImages) {
    await (sb as any)
      .from('character_loras')
      .update({ status: 'failed', error: `Only ${totalPassed} passed (need ${PIPELINE_CONFIG.minPassedImages})` })
      .eq('id', loraId);
    throw new Error(`[${name}] Only ${totalPassed} passed — below minimum ${PIPELINE_CONFIG.minPassedImages}`);
  }

  // 6. Pre-seed human_approved + finalize
  await (sb as any)
    .from('lora_dataset_images')
    .update({ human_approved: true })
    .eq('lora_id', loraId)
    .eq('eval_status', 'passed');

  await (sb as any)
    .from('lora_dataset_images')
    .update({ human_approved: false })
    .eq('lora_id', loraId)
    .in('eval_status', ['failed', 'replaced']);

  await (sb as any)
    .from('character_loras')
    .update({ status: 'awaiting_dataset_approval', completed_stage: 'evaluation', error: null })
    .eq('id', loraId);

  console.log(`[${name}] ✓ DONE — ${totalPassed} images ready for approval`);
  return totalPassed;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Resume Interrupted Dataset Generation                  ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // Find characters with interrupted pipelines
  const { data: loras, error } = await (sb as any)
    .from('character_loras')
    .select('id, character_id, status, completed_stage, characters(id, name, description)')
    .in('status', ['generating_dataset', 'evaluating', 'failed'])
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to fetch loras: ${error.message}`);
  if (!loras || loras.length === 0) {
    console.log('No interrupted datasets found.');
    return;
  }

  // Deduplicate by character_id (take latest)
  const seen = new Set<string>();
  const uniqueLoras = loras.filter((l: any) => {
    if (seen.has(l.character_id)) return false;
    seen.add(l.character_id);
    return true;
  });

  // Apply name filter
  const filtered = CHARACTER_FILTER
    ? uniqueLoras.filter((l: any) => CHARACTER_FILTER!.some((f) => l.characters?.name?.toLowerCase().includes(f)))
    : uniqueLoras;

  console.log(`Found ${filtered.length} character(s) to resume:\n`);

  for (const l of filtered) {
    const char = l.characters as { id: string; name: string; description: Record<string, any> };
    const desc = char.description as Record<string, string>;

    // Get approved image URLs
    const { data: sc } = await (sb as any)
      .from('story_characters')
      .select('approved_image_id, approved_seed, approved_prompt, approved_fullbody_image_id, approved_fullbody_seed')
      .eq('character_id', char.id)
      .eq('approved', true)
      .eq('approved_fullbody', true)
      .limit(1)
      .single();

    if (!sc) {
      console.log(`[${char.name}] SKIP — no approved portraits found`);
      continue;
    }

    const [portraitImage, fullBodyImage] = await Promise.all([
      (sb as any).from('images').select('stored_url, sfw_url').eq('id', sc.approved_image_id).single(),
      (sb as any).from('images').select('stored_url, sfw_url').eq('id', sc.approved_fullbody_image_id).single(),
    ]);

    const portraitUrl = portraitImage.data?.sfw_url || portraitImage.data?.stored_url;
    const fullBodyUrl = fullBodyImage.data?.sfw_url || fullBodyImage.data?.stored_url;

    if (!portraitUrl || !fullBodyUrl) {
      console.log(`[${char.name}] SKIP — missing image URLs`);
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

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ${char.name} (${desc.gender}) — Resume from ${l.status}`);
    console.log(`${'═'.repeat(60)}\n`);

    try {
      await resumeCharacter(l.id, char.name, characterInput, portraitUrl, fullBodyUrl);
    } catch (err) {
      console.error(`[${char.name}] FAILED: ${err}`);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('  DONE — Check LoRA Studio to approve datasets');
  console.log('═'.repeat(60));
}

main().catch(console.error);
