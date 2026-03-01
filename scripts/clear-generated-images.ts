/**
 * Clear all generated images from the database EXCEPT approved character portraits.
 *
 * Preserves:
 *   - images referenced by story_characters.approved_image_id
 *   - images referenced by story_characters.approved_fullbody_image_id
 *   - their storage files in the "characters/" prefix
 *
 * Deletes:
 *   - All generation_jobs rows
 *   - All images NOT referenced by approved portraits
 *   - Resets story_image_prompts (clears image_id, sets status back to 'pending', clears debug_data)
 *   - Removes story image files from storage ("stories/" prefix)
 *
 * Usage:
 *   npx tsx scripts/clear-generated-images.ts              # execute cleanup
 *   npx tsx scripts/clear-generated-images.ts --dry-run    # preview only
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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const dryRun = process.argv.includes('--dry-run');

async function main() {
  console.log(dryRun ? '=== DRY RUN ===' : '=== EXECUTING CLEANUP ===');

  // 1. Get approved portrait image IDs to preserve
  const { data: storyChars, error: scError } = await supabase
    .from('story_characters')
    .select('approved_image_id, approved_fullbody_image_id');

  if (scError) {
    console.error('Failed to fetch story_characters:', scError.message);
    process.exit(1);
  }

  const preserveIds = new Set<string>();
  for (const sc of storyChars || []) {
    if (sc.approved_image_id) preserveIds.add(sc.approved_image_id);
    if (sc.approved_fullbody_image_id) preserveIds.add(sc.approved_fullbody_image_id);
  }
  console.log(`Preserving ${preserveIds.size} approved portrait image(s): ${[...preserveIds].join(', ')}`);

  // 2. Get all images
  const { data: allImages, error: imgError } = await supabase
    .from('images')
    .select('id, stored_url');

  if (imgError) {
    console.error('Failed to fetch images:', imgError.message);
    process.exit(1);
  }

  const imagesToDelete = (allImages || []).filter(img => !preserveIds.has(img.id));
  const imageIdsToDelete = imagesToDelete.map(img => img.id);
  console.log(`Total images: ${allImages?.length || 0}`);
  console.log(`Images to delete: ${imagesToDelete.length}`);

  // 3. Get all generation_jobs
  const { count: jobCount } = await supabase
    .from('generation_jobs')
    .select('id', { count: 'exact', head: true });
  console.log(`Generation jobs to delete: ${jobCount || 0}`);

  // 4. Get story_image_prompts that reference images
  const { data: prompts } = await supabase
    .from('story_image_prompts')
    .select('id, image_id, status')
    .not('image_id', 'is', null);
  console.log(`Story image prompts to reset: ${prompts?.length || 0}`);

  // 5. Collect storage paths from stories/ prefix to delete
  const storagePaths: string[] = [];
  for (const img of imagesToDelete) {
    if (img.stored_url) {
      const parts = img.stored_url.split('/story-images/');
      if (parts.length === 2) {
        storagePaths.push(parts[1]);
      }
    }
  }
  console.log(`Storage files to delete: ${storagePaths.length}`);

  if (dryRun) {
    console.log('\n--- Would delete these storage paths ---');
    for (const p of storagePaths) console.log(`  ${p}`);
    console.log('\n--- Would delete these image IDs ---');
    for (const id of imageIdsToDelete) console.log(`  ${id}`);
    console.log('\nDry run complete. No changes made.');
    return;
  }

  // === Execute cleanup ===

  // Step A: Delete all generation_jobs (they FK to images, so delete first)
  const { error: jobDelError } = await supabase
    .from('generation_jobs')
    .delete()
    .gte('created_at', '1970-01-01'); // match all rows
  if (jobDelError) {
    console.error('Failed to delete generation_jobs:', jobDelError.message);
  } else {
    console.log(`Deleted all generation_jobs`);
  }

  // Step B: Reset story_image_prompts (clear image_id, set status to pending, clear debug_data)
  const { error: promptResetError } = await supabase
    .from('story_image_prompts')
    .update({ image_id: null, status: 'pending', debug_data: null })
    .not('image_id', 'is', null);
  if (promptResetError) {
    console.error('Failed to reset story_image_prompts:', promptResetError.message);
  } else {
    console.log(`Reset story_image_prompts (image_id=null, status=pending)`);
  }

  // Also reset any prompts stuck in generating/generated/failed state without image_id
  const { error: promptStatusResetError } = await supabase
    .from('story_image_prompts')
    .update({ status: 'pending', debug_data: null })
    .in('status', ['generating', 'generated', 'failed']);
  if (promptStatusResetError) {
    console.error('Failed to reset stuck prompts:', promptStatusResetError.message);
  }

  // Step C: Delete non-portrait images (in batches to avoid query limits)
  const BATCH_SIZE = 100;
  for (let i = 0; i < imageIdsToDelete.length; i += BATCH_SIZE) {
    const batch = imageIdsToDelete.slice(i, i + BATCH_SIZE);
    const { error: imgDelError } = await supabase
      .from('images')
      .delete()
      .in('id', batch);
    if (imgDelError) {
      console.error(`Failed to delete images batch ${i}-${i + batch.length}:`, imgDelError.message);
    } else {
      console.log(`Deleted images batch ${i + 1}-${i + batch.length}`);
    }
  }

  // Step D: Delete storage files (in batches of 100)
  for (let i = 0; i < storagePaths.length; i += BATCH_SIZE) {
    const batch = storagePaths.slice(i, i + BATCH_SIZE);
    const { error: storageError } = await supabase.storage
      .from('story-images')
      .remove(batch);
    if (storageError) {
      console.error(`Failed to delete storage batch:`, storageError.message);
    } else {
      console.log(`Deleted ${batch.length} storage files`);
    }
  }

  console.log('\nCleanup complete!');
}

main().catch(console.error);
