/**
 * Re-evaluate existing dataset images using the UPDATED evaluation criteria
 * (face vs body shot differentiation).
 *
 * Body shots are now evaluated WITHOUT face matching — scored on body type,
 * skin tone, head visibility, quality, and framing instead.
 *
 * Usage:
 *   npx tsx scripts/reevaluate-dataset.ts                    # all active LoRAs
 *   npx tsx scripts/reevaluate-dataset.ts --lora-id=XXX      # specific LoRA
 *   npx tsx scripts/reevaluate-dataset.ts --dry-run           # preview only
 *   npx tsx scripts/reevaluate-dataset.ts --body-only         # only re-eval body shots
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

import { evaluateDataset } from '../packages/image-gen/src/character-lora/quality-evaluator';
import type { LoraDatasetImageRow } from '../packages/image-gen/src/character-lora/types';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const BODY_CATEGORIES = ['waist-up', 'full-body', 'body-detail'];

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const bodyOnly = args.includes('--body-only');
  const loraIdArg = args.find((a) => a.startsWith('--lora-id='));
  const targetLoraId = loraIdArg?.split('=')[1];

  if (dryRun) console.log('=== DRY RUN — no changes will be made ===\n');
  if (bodyOnly) console.log('=== BODY ONLY — skipping face shots ===\n');

  // Find LoRAs to process
  let loraQuery = sb
    .from('character_loras')
    .select('id, character_id, status')
    .not('status', 'eq', 'archived')
    .order('created_at', { ascending: false });

  if (targetLoraId) {
    loraQuery = sb
      .from('character_loras')
      .select('id, character_id, status')
      .eq('id', targetLoraId);
  }

  const { data: loras, error: loraError } = await loraQuery;
  if (loraError || !loras || loras.length === 0) {
    console.error('No LoRAs found.', loraError?.message);
    process.exit(1);
  }

  console.log(`Found ${loras.length} LoRA(s) to process.\n`);

  let totalFlippedToPass = 0;
  let totalFlippedToFail = 0;
  let totalReEvaluated = 0;

  for (const lora of loras) {
    console.log(`\n── LoRA ${lora.id} (status: ${lora.status}) ──`);

    // Get character data
    const { data: character } = await (sb as any)
      .from('characters')
      .select('id, name, description')
      .eq('id', lora.character_id)
      .single();

    if (!character) {
      console.log('  Character not found, skipping.');
      continue;
    }

    const desc = character.description as Record<string, string>;
    const bodyType = desc?.bodyType || '';
    const skinTone = desc?.skinTone || '';

    console.log(`  Character: ${character.name} (bodyType: "${bodyType}", skinTone: "${skinTone}")`);

    // Get story character for approved images
    const { data: storyChar } = await (sb as any)
      .from('story_characters')
      .select('approved_image_id, approved_fullbody_image_id')
      .eq('character_id', lora.character_id)
      .not('approved_image_id', 'is', null)
      .not('approved_fullbody_image_id', 'is', null)
      .limit(1)
      .single();

    if (!storyChar) {
      console.log('  No story character with approved images, skipping.');
      continue;
    }

    // Get approved image URLs
    const [portraitImage, fullBodyImage] = await Promise.all([
      sb.from('images').select('stored_url, sfw_url').eq('id', storyChar.approved_image_id).single(),
      sb.from('images').select('stored_url, sfw_url').eq('id', storyChar.approved_fullbody_image_id).single(),
    ]);

    const portraitUrl = (portraitImage.data as any)?.sfw_url || (portraitImage.data as any)?.stored_url;
    const fullBodyUrl = (fullBodyImage.data as any)?.sfw_url || (fullBodyImage.data as any)?.stored_url;

    if (!portraitUrl || !fullBodyUrl) {
      console.log('  Could not resolve approved image URLs, skipping.');
      continue;
    }

    // Fetch dataset images (passed + failed, not replaced)
    let imgQuery = sb
      .from('lora_dataset_images')
      .select('id, image_url, category, variation_type, eval_status, eval_score, prompt_template, source')
      .eq('lora_id', lora.id)
      .in('eval_status', ['passed', 'failed']);

    if (bodyOnly) {
      imgQuery = imgQuery.in('category', BODY_CATEGORIES);
    }

    const { data: images, error: imgError } = await imgQuery;
    if (imgError || !images || images.length === 0) {
      console.log(`  No images to re-evaluate${bodyOnly ? ' (body-only filter)' : ''}.`);
      continue;
    }

    // Record old statuses for comparison
    const oldStatuses = new Map<string, string>();
    for (const img of images) {
      oldStatuses.set(img.id, img.eval_status);
    }

    const bodyCount = images.filter((i: any) => BODY_CATEGORIES.includes(i.category)).length;
    const faceCount = images.length - bodyCount;
    console.log(`  Found ${images.length} images (${faceCount} face, ${bodyCount} body)`);

    if (dryRun) {
      console.log('  [DRY RUN] Would re-evaluate these images. Skipping.');
      continue;
    }

    // Run evaluation with updated criteria
    console.log('  Running evaluation...');
    const evalResult = await evaluateDataset(
      portraitUrl,
      fullBodyUrl,
      images as LoraDatasetImageRow[],
      { supabase: sb },
      { bodyType, skinTone },
    );

    // Compare old vs new statuses
    let flippedToPass = 0;
    let flippedToFail = 0;

    // Re-fetch updated images to see new statuses
    const { data: updatedImages } = await sb
      .from('lora_dataset_images')
      .select('id, eval_status, eval_score, human_approved')
      .in('id', images.map((i: any) => i.id));

    for (const img of updatedImages || []) {
      const oldStatus = oldStatuses.get(img.id);
      const newStatus = img.eval_status;

      if (oldStatus === 'failed' && newStatus === 'passed') {
        flippedToPass++;
        // Auto-approve newly passing images
        await sb
          .from('lora_dataset_images')
          .update({ human_approved: true } as any)
          .eq('id', img.id);
      } else if (oldStatus === 'passed' && newStatus === 'failed') {
        flippedToFail++;
      }
    }

    console.log(`  Results: ${evalResult.passed} passed, ${evalResult.failed} failed`);
    console.log(`  Flipped: ${flippedToPass} failed→passed, ${flippedToFail} passed→failed`);

    if (flippedToPass > 0) {
      console.log(`  Auto-approved ${flippedToPass} newly passing images.`);
    }

    totalFlippedToPass += flippedToPass;
    totalFlippedToFail += flippedToFail;
    totalReEvaluated += images.length;
  }

  console.log('\n═══════════════════════════════════════');
  console.log(`Re-evaluated ${totalReEvaluated} images.`);
  console.log(`${totalFlippedToPass} flipped from failed→passed.`);
  console.log(`${totalFlippedToFail} flipped from passed→failed.`);
  console.log('═══════════════════════════════════════');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
