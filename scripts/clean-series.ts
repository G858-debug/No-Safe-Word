/**
 * Delete all data for a specific story series from Supabase, including storage files.
 *
 * Usage:
 *   npx tsx scripts/clean-series.ts --slug "the-lobola-list"            # dry run (default)
 *   npx tsx scripts/clean-series.ts --slug "the-lobola-list" --force    # execute deletions
 *   npx tsx scripts/clean-series.ts --slug "the-lobola-list" --dry-run  # explicit dry run
 *
 * Deletion order respects FK constraints. Characters shared with other series are skipped.
 * Storage deletion failures are non-fatal warnings.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

// ── Load .env.local ──
const envPath = path.resolve(__dirname, '../.env.local');
const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
for (const line of envLines) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ── Parse args ──
const args = process.argv.slice(2);
const slugIdx = args.indexOf('--slug');
const slug = slugIdx !== -1 ? args[slugIdx + 1] : undefined;
const force = args.includes('--force');
const dryRun = !force;

if (!slug) {
  console.error('Usage: npx tsx scripts/clean-series.ts --slug "the-lobola-list" [--force]');
  process.exit(1);
}

const prefix = dryRun ? '[DRY RUN]' : '[DELETE]';

async function main() {
  console.log(dryRun ? '=== DRY RUN MODE ===' : '=== EXECUTING DELETIONS ===');
  console.log();

  // ── STEP 1: Find the series ──
  const { data: series, error: seriesError } = await supabase
    .from('story_series')
    .select('id, title, slug')
    .eq('slug', slug!)
    .single();

  if (seriesError || !series) {
    console.error(`Series not found for slug "${slug}"`);
    process.exit(1);
  }

  const seriesId = series.id;
  console.log(`Found series: "${series.title}" (${seriesId})`);

  // ── STEP 2: Collect all image IDs ──
  // 2a. Images from story_image_prompts
  const { data: promptImages, error: piError } = await supabase
    .from('story_image_prompts')
    .select('image_id, post_id!inner(series_id)')
    .eq('post_id.series_id', seriesId)
    .not('image_id', 'is', null);

  if (piError) {
    console.error('Failed to fetch prompt images:', piError.message);
    process.exit(1);
  }

  const promptImageIds = (promptImages || []).map((r: any) => r.image_id as string);

  // 2b. Images from story_characters (approved portraits + full bodies)
  const { data: charImages, error: ciError } = await supabase
    .from('story_characters')
    .select('approved_image_id, approved_fullbody_image_id')
    .eq('series_id', seriesId);

  if (ciError) {
    console.error('Failed to fetch character images:', ciError.message);
    process.exit(1);
  }

  const charImageIds = (charImages || []).flatMap((r) => [
    r.approved_image_id,
    r.approved_fullbody_image_id,
  ]).filter((id): id is string => id !== null);

  const allImageIds = [...new Set([...promptImageIds, ...charImageIds])];
  console.log(`Found ${allImageIds.length} images to delete`);

  // ── STEP 3: Collect storage paths for those images ──
  const storagePaths: string[] = [];
  if (allImageIds.length > 0) {
    const { data: imageRows, error: irError } = await supabase
      .from('images')
      .select('id, stored_url, sfw_url')
      .in('id', allImageIds);

    if (irError) {
      console.error('Failed to fetch image URLs:', irError.message);
      process.exit(1);
    }

    for (const img of imageRows || []) {
      for (const url of [img.stored_url, img.sfw_url]) {
        if (!url) continue;
        const parts = url.split('/story-images/');
        if (parts.length === 2) {
          storagePaths.push(parts[1]);
          console.log(`  Storage path: ${parts[1]}`);
        }
      }
    }
  }
  console.log(`Found ${storagePaths.length} storage paths`);

  // ── STEP 4: Collect character IDs ──
  const { data: storyChars, error: scError } = await supabase
    .from('story_characters')
    .select('character_id')
    .eq('series_id', seriesId);

  if (scError) {
    console.error('Failed to fetch story characters:', scError.message);
    process.exit(1);
  }

  const characterIds = (storyChars || []).map((r) => r.character_id);
  console.log(`Found ${characterIds.length} characters`);

  // ── STEP 5: Identify characters safe to delete ──
  const safeCharacterIds: string[] = [];
  const sharedCharacterIds: string[] = [];

  for (const charId of characterIds) {
    const { count, error: countError } = await supabase
      .from('story_characters')
      .select('*', { count: 'exact', head: true })
      .eq('character_id', charId)
      .neq('series_id', seriesId);

    if (countError) {
      console.error(`Failed to check character ${charId}:`, countError.message);
      process.exit(1);
    }

    if ((count || 0) === 0) {
      safeCharacterIds.push(charId);
    } else {
      sharedCharacterIds.push(charId);
    }
  }

  // Fetch names for logging
  const charNames = new Map<string, string>();
  if (characterIds.length > 0) {
    const { data: chars } = await supabase
      .from('characters')
      .select('id, name')
      .in('id', characterIds);
    for (const c of chars || []) {
      charNames.set(c.id, c.name);
    }
  }

  const safeNames = safeCharacterIds.map((id) => charNames.get(id) || id);
  const sharedNames = sharedCharacterIds.map((id) => charNames.get(id) || id);
  console.log(`Characters safe to delete: ${safeNames.length > 0 ? safeNames.join(', ') : '(none)'}`);
  if (sharedNames.length > 0) {
    console.log(`Characters shared with other series (skipping): ${sharedNames.join(', ')}`);
  }

  // ── STEP 6: Collect LoRA IDs for safe-to-delete characters ──
  let loraIds: string[] = [];
  let loraDatasetStoragePaths: string[] = [];

  if (safeCharacterIds.length > 0) {
    const { data: loras, error: loraError } = await supabase
      .from('character_loras')
      .select('id')
      .in('character_id', safeCharacterIds);

    if (loraError) {
      console.error('Failed to fetch LoRAs:', loraError.message);
      process.exit(1);
    }

    loraIds = (loras || []).map((r) => r.id);

    // Collect dataset image storage paths before deletion
    if (loraIds.length > 0) {
      const { data: datasetImages } = await supabase
        .from('lora_dataset_images')
        .select('storage_path')
        .in('lora_id', loraIds);

      loraDatasetStoragePaths = (datasetImages || [])
        .map((r) => r.storage_path)
        .filter((p) => p && p.length > 0);
    }
  }

  console.log(`Found ${loraIds.length} LoRA records to delete`);
  console.log(`Found ${loraDatasetStoragePaths.length} LoRA dataset storage paths`);

  // ── Collect post and prompt counts ──
  const { count: postCount } = await supabase
    .from('story_posts')
    .select('*', { count: 'exact', head: true })
    .eq('series_id', seriesId);

  const { data: postIds } = await supabase
    .from('story_posts')
    .select('id')
    .eq('series_id', seriesId);

  let promptCount = 0;
  if (postIds && postIds.length > 0) {
    const { count } = await supabase
      .from('story_image_prompts')
      .select('*', { count: 'exact', head: true })
      .in('post_id', postIds.map((p) => p.id));
    promptCount = count || 0;
  }

  // ── Summary ──
  console.log();
  console.log(`${prefix} Would delete series: "${series.title}" (${seriesId})`);
  console.log(`${prefix} Would delete ${allImageIds.length} images`);
  console.log(`${prefix} Would delete ${safeNames.length} characters: ${safeNames.join(', ') || '(none)'}`);
  console.log(`${prefix} Would delete ${loraIds.length} character_loras`);
  console.log(`${prefix} Would delete ${postCount || 0} story_posts`);
  console.log(`${prefix} Would delete ${promptCount} story_image_prompts`);
  console.log(`${prefix} Would delete ${storagePaths.length + loraDatasetStoragePaths.length} storage files`);

  if (dryRun) {
    console.log();
    console.log(`${prefix} Run with --force to execute`);
    return;
  }

  console.log();

  // ── EXECUTE DELETIONS ──

  // 1. generation_jobs
  if (allImageIds.length > 0) {
    const { count, error } = await supabase
      .from('generation_jobs')
      .delete({ count: 'exact' })
      .in('image_id', allImageIds);
    if (error) {
      console.error('Failed to delete generation_jobs:', error.message);
      process.exit(1);
    }
    console.log(`Deleted ${count || 0} generation_jobs`);
  }

  // 2. story_image_prompts
  if (postIds && postIds.length > 0) {
    const { count, error } = await supabase
      .from('story_image_prompts')
      .delete({ count: 'exact' })
      .in('post_id', postIds.map((p) => p.id));
    if (error) {
      console.error('Failed to delete story_image_prompts:', error.message);
      process.exit(1);
    }
    console.log(`Deleted ${count || 0} story_image_prompts`);
  }

  // 3. lora_dataset_images
  if (loraIds.length > 0) {
    const { count, error } = await supabase
      .from('lora_dataset_images')
      .delete({ count: 'exact' })
      .in('lora_id', loraIds);
    if (error) {
      console.error('Failed to delete lora_dataset_images:', error.message);
      process.exit(1);
    }
    console.log(`Deleted ${count || 0} lora_dataset_images`);
  }

  // 4. character_loras
  if (loraIds.length > 0) {
    // First clear active_lora_id references
    await supabase
      .from('story_characters')
      .update({ active_lora_id: null })
      .eq('series_id', seriesId);

    const { count, error } = await supabase
      .from('character_loras')
      .delete({ count: 'exact' })
      .in('id', loraIds);
    if (error) {
      console.error('Failed to delete character_loras:', error.message);
      process.exit(1);
    }
    console.log(`Deleted ${count || 0} character_loras`);
  }

  // 5. story_characters
  {
    const { count, error } = await supabase
      .from('story_characters')
      .delete({ count: 'exact' })
      .eq('series_id', seriesId);
    if (error) {
      console.error('Failed to delete story_characters:', error.message);
      process.exit(1);
    }
    console.log(`Deleted ${count || 0} story_characters`);
  }

  // 6. story_posts
  {
    const { count, error } = await supabase
      .from('story_posts')
      .delete({ count: 'exact' })
      .eq('series_id', seriesId);
    if (error) {
      console.error('Failed to delete story_posts:', error.message);
      process.exit(1);
    }
    console.log(`Deleted ${count || 0} story_posts`);
  }

  // 7. images
  if (allImageIds.length > 0) {
    const { count, error } = await supabase
      .from('images')
      .delete({ count: 'exact' })
      .in('id', allImageIds);
    if (error) {
      console.error('Failed to delete images:', error.message);
      process.exit(1);
    }
    console.log(`Deleted ${count || 0} images`);
  }

  // 8. characters (safe ones only)
  if (safeCharacterIds.length > 0) {
    const { count, error } = await supabase
      .from('characters')
      .delete({ count: 'exact' })
      .in('id', safeCharacterIds);
    if (error) {
      console.error('Failed to delete characters:', error.message);
      process.exit(1);
    }
    console.log(`Deleted ${count || 0} characters`);
  }

  // 9. story_series
  {
    const { error } = await supabase
      .from('story_series')
      .delete()
      .eq('id', seriesId);
    if (error) {
      console.error('Failed to delete story_series:', error.message);
      process.exit(1);
    }
    console.log(`Deleted series: "${series.title}"`);
  }

  // 10. Storage cleanup
  let storageDeleted = 0;
  const BATCH_SIZE = 100;

  // Story image storage
  for (let i = 0; i < storagePaths.length; i += BATCH_SIZE) {
    const batch = storagePaths.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.storage.from('story-images').remove(batch);
    if (error) {
      console.warn(`  Warning: storage deletion failed for batch ${i}: ${error.message}`);
    } else {
      storageDeleted += batch.length;
    }
  }

  // LoRA dataset image storage
  for (let i = 0; i < loraDatasetStoragePaths.length; i += BATCH_SIZE) {
    const batch = loraDatasetStoragePaths.slice(i, i + BATCH_SIZE);
    // Dataset images may be in different buckets — extract bucket from path
    const { error } = await supabase.storage.from('story-images').remove(batch);
    if (error) {
      console.warn(`  Warning: LoRA dataset storage deletion failed for batch ${i}: ${error.message}`);
    } else {
      storageDeleted += batch.length;
    }
  }

  console.log(`Deleted ${storageDeleted} storage files`);

  // ── Final summary ──
  console.log();
  console.log(`✓ "${series.title}" cleaned successfully`);
  console.log(
    `Deleted: 1 series, ${postCount || 0} posts, ${promptCount} prompts, ` +
    `${allImageIds.length} images, ${safeCharacterIds.length} characters, ` +
    `${loraIds.length} loras, ${storageDeleted} storage files`
  );
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
