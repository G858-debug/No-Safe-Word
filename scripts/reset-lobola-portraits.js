/**
 * Clears all previously-generated SDXL portrait/fullbody approvals and images
 * for Lobola List characters, and deletes the stored images from Supabase Storage.
 *
 * This resets characters to "not approved" state so they can be regenerated with
 * the Flux/Kontext pipeline and re-approved.
 *
 * Usage:
 *   node scripts/reset-lobola-portraits.js --dry-run   # preview only
 *   node scripts/reset-lobola-portraits.js             # apply changes
 */

const fs = require('fs');
const path = require('path');

const dryRun = process.argv.includes('--dry-run');

const envPath = path.resolve(__dirname, '../.env.local');
const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
for (const line of envLines) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const { createClient } = require('@supabase/supabase-js');
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

async function main() {
  if (dryRun) {
    console.log('DRY RUN — no changes will be made\n');
  }

  const { data: series } = await sb
    .from('story_series')
    .select('id, title')
    .ilike('title', '%lobola%');

  if (!series || series.length === 0) {
    console.error('No Lobola List series found');
    return;
  }

  const seriesId = series[0].id;
  console.log(`Series: ${series[0].title} (${seriesId})\n`);

  // Fetch all story characters (only the actual DB columns)
  const { data: storyChars, error: scErr } = await sb
    .from('story_characters')
    .select(`
      id,
      role,
      approved,
      approved_image_id,
      approved_fullbody,
      approved_fullbody_image_id,
      characters:character_id (id, name)
    `)
    .eq('series_id', seriesId);

  if (scErr || !storyChars) {
    console.error('Error fetching story characters:', scErr);
    return;
  }

  console.log(`Found ${storyChars.length} characters\n`);

  for (const sc of storyChars) {
    const charName = sc.characters?.name || sc.id;
    const characterId = sc.characters?.id;
    console.log(`\n--- ${charName} ---`);
    console.log(`  Portrait approved: ${sc.approved}, Full body approved: ${sc.approved_fullbody}`);

    // Collect all image IDs linked to this story character
    const linkedImageIds = [
      sc.approved_image_id,
      sc.approved_fullbody_image_id,
    ].filter(Boolean);

    // Also find ALL images for this character in the images table (to clean up extras)
    let allCharImageIds = [...linkedImageIds];
    if (characterId) {
      const { data: charImages } = await sb
        .from('images')
        .select('id, stored_url')
        .eq('character_id', characterId);

      if (charImages && charImages.length > 0) {
        const extraIds = charImages.map(i => i.id).filter(id => !allCharImageIds.includes(id));
        if (extraIds.length > 0) {
          console.log(`  Found ${extraIds.length} additional image(s) not linked to story_characters`);
        }
        allCharImageIds = [...allCharImageIds, ...extraIds];

        // Delete from Supabase Storage
        const storagePaths = charImages
          .filter(img => img.stored_url)
          .map(img => {
            const parts = img.stored_url.split('/story-images/');
            return parts.length === 2 ? parts[1] : null;
          })
          .filter(Boolean);

        if (storagePaths.length > 0) {
          console.log(`  Deleting ${storagePaths.length} image file(s) from storage:`);
          storagePaths.forEach(p => console.log(`    - ${p}`));

          if (!dryRun) {
            const { error: storageErr } = await sb.storage
              .from('story-images')
              .remove(storagePaths);
            if (storageErr) {
              console.warn(`  Storage delete warning:`, storageErr.message);
            } else {
              console.log(`  ✓ Deleted from storage`);
            }
          }
        }

        // Delete image records from images table
        if (!dryRun) {
          const { error: imgErr } = await sb
            .from('images')
            .delete()
            .eq('character_id', characterId);
          if (imgErr) {
            console.warn(`  Image records delete warning:`, imgErr.message);
          } else {
            console.log(`  ✓ Deleted ${charImages.length} image record(s)`);
          }
        } else {
          console.log(`  Would delete ${charImages.length} image record(s)`);
        }
      } else {
        console.log(`  No images found in images table`);
      }
    }

    // Reset story_character approval fields
    console.log(`  Resetting approval state...`);
    if (!dryRun) {
      const { error: resetErr } = await sb
        .from('story_characters')
        .update({
          approved: false,
          approved_image_id: null,
          approved_seed: null,
          approved_prompt: null,
          approved_fullbody: false,
          approved_fullbody_image_id: null,
          approved_fullbody_seed: null,
          approved_fullbody_prompt: null,
          prose_description: null, // clears any pending metadata stored here
        })
        .eq('id', sc.id);

      if (resetErr) {
        console.error(`  ✗ Failed to reset ${charName}:`, resetErr.message);
      } else {
        console.log(`  ✓ Approval state reset`);
      }
    } else {
      console.log(`  Would reset: approved=false, approved_image_id=null, approved_fullbody=false, etc.`);
    }
  }

  console.log('\nDone.');
  if (dryRun) {
    console.log('Run without --dry-run to apply changes.');
  } else {
    console.log('All Lobola List character portraits have been cleared.');
    console.log('Go to the Characters tab in the story publisher to regenerate with Flux.');
  }
}

main().catch(console.error);
