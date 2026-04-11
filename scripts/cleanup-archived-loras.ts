/**
 * Delete archived/failed LoRAs and orphaned images from the database + storage.
 *
 * Archived/failed LoRAs:
 *   - Deletes character_loras with status IN ('archived', 'failed')
 *   - Skips any LoRA still referenced by story_characters.active_lora_id
 *   - Cascades to lora_dataset_images (FK ON DELETE CASCADE)
 *   - Removes storage files: trained .safetensors + dataset images
 *
 * Orphaned images:
 *   - Deletes images NOT referenced by any story_image_prompts or approved portraits
 *   - Cascades to generation_evaluations (FK ON DELETE CASCADE)
 *   - Clears generation_jobs references (FK ON DELETE SET NULL)
 *   - Removes storage files from story-images bucket
 *
 * Usage:
 *   npx tsx --env-file=apps/web/.env.local scripts/cleanup-archived-loras.ts              # dry run
 *   npx tsx --env-file=apps/web/.env.local scripts/cleanup-archived-loras.ts --force      # execute
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const force = process.argv.includes('--force');
const dryRun = !force;
const prefix = dryRun ? '[DRY RUN]' : '[DELETE]';
const BATCH = 100;

async function cleanupArchivedLoras() {
  console.log('\n=== Archived/Failed LoRAs ===\n');

  // 1. Get all active_lora_ids to protect
  const { data: activeRefs } = await supabase
    .from('story_characters')
    .select('active_lora_id')
    .not('active_lora_id', 'is', null);

  const protectedLoraIds = new Set(
    (activeRefs || []).map(r => (r as any).active_lora_id).filter(Boolean),
  );
  console.log(`Protected LoRA IDs (active): ${protectedLoraIds.size}`);

  // 2. Get all archived/failed LoRAs
  const { data: staleLorasRaw, error: queryError } = await (supabase as any)
    .from('character_loras')
    .select('id, character_id, status, filename, storage_url, trigger_word, created_at')
    .in('status', ['archived', 'failed'])
    .order('created_at', { ascending: true });

  if (queryError) {
    console.error('Failed to query character_loras:', queryError.message);
    return;
  }

  const staleLoras = (staleLorasRaw || []) as Array<{
    id: string; character_id: string; status: string;
    filename: string | null; storage_url: string | null;
    trigger_word: string | null; created_at: string;
  }>;

  // Filter out protected ones
  const toDelete = staleLoras.filter(l => !protectedLoraIds.has(l.id));
  const skipped = staleLoras.filter(l => protectedLoraIds.has(l.id));

  console.log(`Found ${staleLoras.length} archived/failed LoRA(s)`);
  if (skipped.length > 0) {
    console.log(`Skipping ${skipped.length} still referenced by active_lora_id:`);
    for (const l of skipped) console.log(`  - ${l.id} (${l.trigger_word}, ${l.status})`);
  }
  console.log(`Will delete ${toDelete.length} LoRA(s):`);
  for (const l of toDelete) {
    console.log(`  ${prefix} ${l.id} — ${l.trigger_word || 'no trigger'} (${l.status}, created ${l.created_at.split('T')[0]})`);
  }

  if (toDelete.length === 0) {
    console.log('Nothing to delete.');
    return;
  }

  // 3. Collect storage paths
  const loraIds = toDelete.map(l => l.id);
  const storagePaths: string[] = [];

  // Trained safetensors files
  for (const l of toDelete) {
    if (l.storage_url) {
      const parts = l.storage_url.split('/lora-training-datasets/');
      if (parts.length === 2) storagePaths.push(parts[1]);
    }
  }

  // Dataset images
  const { data: datasetImages } = await supabase
    .from('lora_dataset_images')
    .select('id, storage_path, image_url')
    .in('lora_id', loraIds);

  const datasetCount = datasetImages?.length || 0;
  if (datasetImages) {
    for (const img of datasetImages) {
      if (img.storage_path) storagePaths.push(img.storage_path);
    }
  }

  console.log(`\n${prefix} Will remove ${datasetCount} dataset image record(s)`);
  console.log(`${prefix} Will remove ${storagePaths.length} storage file(s)`);

  if (dryRun) {
    console.log('\nDry run complete. Use --force to execute deletions.');
    return;
  }

  // 4. Execute deletions
  // Delete LoRA records (cascades to lora_dataset_images)
  for (let i = 0; i < loraIds.length; i += BATCH) {
    const batch = loraIds.slice(i, i + BATCH);
    const { error } = await (supabase as any)
      .from('character_loras')
      .delete()
      .in('id', batch);
    if (error) {
      console.error(`Failed to delete LoRA batch:`, error.message);
    } else {
      console.log(`Deleted ${batch.length} LoRA record(s) (+ cascaded dataset images)`);
    }
  }

  // Delete storage files
  for (let i = 0; i < storagePaths.length; i += BATCH) {
    const batch = storagePaths.slice(i, i + BATCH);
    const { error } = await supabase.storage.from('lora-training-datasets').remove(batch);
    if (error) {
      console.warn(`Storage delete warning:`, error.message);
    } else {
      console.log(`Deleted ${batch.length} storage file(s)`);
    }
  }

  console.log(`\nLoRA cleanup complete: ${toDelete.length} LoRA(s) deleted.`);
}

async function cleanupOrphanedImages() {
  console.log('\n=== Orphaned Images ===\n');

  // 1. Get all image IDs that are actively referenced
  const referencedIds = new Set<string>();

  // From story_image_prompts.image_id
  const { data: promptRefs } = await supabase
    .from('story_image_prompts')
    .select('image_id')
    .not('image_id', 'is', null);
  for (const r of promptRefs || []) {
    if (r.image_id) referencedIds.add(r.image_id);
  }

  // From story_image_prompts.sfw_image_id
  const { data: sfwRefs } = await supabase
    .from('story_image_prompts')
    .select('sfw_image_id')
    .not('sfw_image_id', 'is', null);
  for (const r of sfwRefs || []) {
    if ((r as any).sfw_image_id) referencedIds.add((r as any).sfw_image_id);
  }

  // From story_characters.approved_image_id and approved_fullbody_image_id
  const { data: charRefs } = await supabase
    .from('story_characters')
    .select('approved_image_id, approved_fullbody_image_id');
  for (const r of charRefs || []) {
    if (r.approved_image_id) referencedIds.add(r.approved_image_id);
    if (r.approved_fullbody_image_id) referencedIds.add(r.approved_fullbody_image_id);
  }

  console.log(`Referenced image IDs (to keep): ${referencedIds.size}`);

  // 2. Get ALL images
  const { data: allImages, error: imgError } = await supabase
    .from('images')
    .select('id, stored_url, sfw_url');

  if (imgError) {
    console.error('Failed to query images:', imgError.message);
    return;
  }

  const orphans = (allImages || []).filter(img => !referencedIds.has(img.id));
  console.log(`Total images: ${allImages?.length || 0}`);
  console.log(`Orphaned images to delete: ${orphans.length}`);

  if (orphans.length === 0) {
    console.log('No orphaned images.');
    return;
  }

  // 3. Collect storage paths
  const storagePaths: string[] = [];
  for (const img of orphans) {
    const url = img.stored_url || img.sfw_url;
    if (url) {
      const parts = url.split('/story-images/');
      if (parts.length === 2) storagePaths.push(parts[1]);
    }
  }

  console.log(`${prefix} Will remove ${storagePaths.length} storage file(s)`);

  if (dryRun) {
    if (orphans.length <= 20) {
      for (const img of orphans) console.log(`  ${prefix} ${img.id}`);
    } else {
      console.log(`  (showing first 20 of ${orphans.length})`);
      for (const img of orphans.slice(0, 20)) console.log(`  ${prefix} ${img.id}`);
    }
    console.log('\nDry run complete. Use --force to execute deletions.');
    return;
  }

  // 4. Delete generation_jobs for orphaned images (FK SET NULL, but clean up anyway)
  const orphanIds = orphans.map(img => img.id);
  for (let i = 0; i < orphanIds.length; i += BATCH) {
    const batch = orphanIds.slice(i, i + BATCH);
    await supabase.from('generation_jobs').delete().in('image_id', batch);
  }
  console.log(`Deleted generation_jobs for ${orphanIds.length} orphaned image(s)`);

  // 5. Delete images (cascades to generation_evaluations)
  for (let i = 0; i < orphanIds.length; i += BATCH) {
    const batch = orphanIds.slice(i, i + BATCH);
    const { error } = await supabase.from('images').delete().in('id', batch);
    if (error) {
      console.error(`Failed to delete images batch:`, error.message);
    } else {
      console.log(`Deleted ${batch.length} image record(s)`);
    }
  }

  // 6. Delete storage files
  for (let i = 0; i < storagePaths.length; i += BATCH) {
    const batch = storagePaths.slice(i, i + BATCH);
    const { error } = await supabase.storage.from('story-images').remove(batch);
    if (error) {
      console.warn(`Storage delete warning:`, error.message);
    } else {
      console.log(`Deleted ${batch.length} storage file(s)`);
    }
  }

  console.log(`\nImage cleanup complete: ${orphans.length} orphaned image(s) deleted.`);
}

async function main() {
  console.log(dryRun ? '=== DRY RUN MODE ===' : '=== EXECUTING CLEANUP ===');
  await cleanupArchivedLoras();
  await cleanupOrphanedImages();
  console.log('\n=== Done ===');
}

main().catch(console.error);
