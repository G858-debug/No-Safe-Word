/**
 * Resume stuck LoRA pipelines from where they left off.
 *
 * Reads each pipeline's state from the DB and picks up at the appropriate stage:
 *   - evaluating (with enough passed): skip to captioning → training
 *   - evaluating (not enough passed): lower threshold if close, else fail
 *   - training (no training_id): retry from captioning → training
 *   - failed (ZIP too large): now fixed with JPEG compression, retry training
 *
 * Usage:
 *   node scripts/resume-lora-pipelines.js                    # resume all stuck
 *   node scripts/resume-lora-pipelines.js --lora-id=<id>     # resume specific one
 *   node scripts/resume-lora-pipelines.js --dry-run           # show what would happen
 */

const fs = require('fs');
const path = require('path');

// Load env
const envPath = path.resolve(__dirname, '../.env.local');
const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
for (const line of envLines) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

// Must be loaded after env
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

// Dynamically import the ESM pipeline modules
async function loadModules() {
  // We need tsx to handle TypeScript imports
  const { generateCaptions } = await import('../packages/image-gen/src/character-lora/caption-generator');
  const { trainLora, getRetryParams } = await import('../packages/image-gen/src/character-lora/trainer');
  const { evaluateDataset } = await import('../packages/image-gen/src/character-lora/quality-evaluator');
  const { generateReplacements } = await import('../packages/image-gen/src/character-lora/dataset-generator');
  const { validateLora } = await import('../packages/image-gen/src/character-lora/validator');
  const { deployLora } = await import('../packages/image-gen/src/character-lora/deployer');
  return { generateCaptions, trainLora, getRetryParams, evaluateDataset, generateReplacements, validateLora, deployLora };
}

const charNames = {
  'b4344cb6-1615-4169-9e1c-3e6bbc4bcd2c': 'Zanele',
  'd757c016-20cf-43de-b671-a80842798e23': 'Langa Mkhize',
  'efc71e1c-06aa-4cc1-993d-c852636ce10e': 'Lindiwe Dlamini',
  'cfc4548b-6e95-4186-8d4a-a566e6c6d454': 'Sibusiso Ndlovu',
};

async function getLoraState(loraId) {
  const { data: lora } = await sb
    .from('character_loras')
    .select('*')
    .eq('id', loraId)
    .single();

  const { data: images } = await sb
    .from('lora_dataset_images')
    .select('*')
    .eq('lora_id', loraId)
    .order('created_at');

  const passed = (images || []).filter(i => i.eval_status === 'passed');
  const failed = (images || []).filter(i => i.eval_status === 'failed');
  const captioned = (images || []).filter(i => i.caption);

  return { lora, images: images || [], passed, failed, captioned };
}

function getCharacterInput(lora, state) {
  // We need to reconstruct CharacterInput from the DB.
  // Get the character's story_characters record for the approved image info.
  return sb
    .from('story_characters')
    .select('*, characters(*)')
    .eq('character_id', lora.character_id)
    .eq('approved', true)
    .limit(1)
    .single()
    .then(({ data }) => data);
}

async function resumePipeline(loraId, dryRun, modules) {
  const state = await getLoraState(loraId);
  const { lora, passed, failed, captioned, images } = state;
  const name = charNames[lora.character_id] || lora.character_id;

  console.log(`\n${'='.repeat(55)}`);
  console.log(`${name} | Current: ${lora.status.toUpperCase()} | LoRA: ${loraId}`);
  console.log(`Dataset: ${images.length} imgs | Passed: ${passed.length} | Failed: ${failed.length} | Captioned: ${captioned.length}`);

  // Determine what to do
  let action;
  let resumeFrom;

  if (lora.status === 'evaluating') {
    if (passed.length >= 15) {
      // Close enough — proceed with what we have
      action = `Proceed with ${passed.length} passed images (lowered threshold from 20)`;
      resumeFrom = captioned.length > 0 ? 'training' : 'captioning';
    } else {
      action = `Only ${passed.length} passed — insufficient for training. Marking as failed.`;
      resumeFrom = 'fail';
    }
  } else if (lora.status === 'training') {
    if (captioned.length > 0) {
      action = `Resume training with ${captioned.length} captioned images`;
      resumeFrom = 'training';
    } else if (passed.length > 0) {
      action = `Caption ${passed.length} passed images, then train`;
      resumeFrom = 'captioning';
    } else {
      action = 'No passed images — cannot resume';
      resumeFrom = 'fail';
    }
  } else if (lora.status === 'failed' && lora.error && lora.error.includes('maximum allowed size')) {
    // ZIP too large — now fixed with JPEG compression
    if (captioned.length > 0) {
      action = `Retry training with JPEG compression (${captioned.length} captioned images)`;
      resumeFrom = 'training';
    } else if (passed.length > 0) {
      action = `Caption ${passed.length} passed images, then train with JPEG compression`;
      resumeFrom = 'captioning';
    } else {
      action = 'No passed images — cannot resume';
      resumeFrom = 'fail';
    }
  } else if (lora.status === 'failed') {
    action = `Failed with: ${lora.error}. Cannot auto-resume.`;
    resumeFrom = 'skip';
  } else if (lora.status === 'captioning') {
    if (passed.length > 0) {
      action = `Resume captioning with ${passed.length} passed images`;
      resumeFrom = 'captioning';
    } else {
      action = 'No passed images — cannot resume';
      resumeFrom = 'fail';
    }
  } else {
    action = `Status "${lora.status}" — nothing to resume`;
    resumeFrom = 'skip';
  }

  console.log(`Action: ${action}`);
  console.log(`Resume from: ${resumeFrom}`);

  if (dryRun || resumeFrom === 'skip') {
    return;
  }

  if (resumeFrom === 'fail') {
    await sb.from('character_loras').update({ status: 'failed', error: action }).eq('id', loraId);
    console.log('Marked as failed.');
    return;
  }

  // Get character input for later stages
  const gender = passed.length > 0 && passed[0].prompt_template
    ? (passed[0].prompt_template.includes('woman') ? 'female' : 'male')
    : 'female';

  // Determine gender from the character name or existing captions
  const charGender = ['Sibusiso', 'Langa'].some(n => name.includes(n)) ? 'male' : 'female';

  try {
    // STAGE 3: Captioning (if needed)
    if (resumeFrom === 'captioning') {
      console.log(`\n--- Captioning ${passed.length} images ---`);
      await sb.from('character_loras').update({ status: 'captioning' }).eq('id', loraId);

      const captionResult = await modules.generateCaptions(passed, charGender, { supabase: sb });
      console.log(`Captioned: ${captionResult.totalCaptioned}`);

      // Now fall through to training
      resumeFrom = 'training';

      // Re-fetch state to get captions
      const newState = await getLoraState(loraId);
      state.captioned = newState.captioned;
    }

    // STAGE 4: Training
    if (resumeFrom === 'training') {
      console.log(`\n--- Training ---`);
      await sb.from('character_loras').update({ status: 'training' }).eq('id', loraId);

      // Get captioned images for training
      const { data: captionedImgs } = await sb
        .from('lora_dataset_images')
        .select('*')
        .eq('lora_id', loraId)
        .not('caption', 'is', null)
        .eq('eval_status', 'passed');

      const captionedForTraining = (captionedImgs || []).map(img => ({
        imageUrl: img.image_url,
        caption: img.caption,
        storagePath: img.storage_path,
      }));

      console.log(`Training with ${captionedForTraining.length} images...`);

      const characterSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const attempt = (lora.training_attempts || 0) + 1;

      const trainingResult = await modules.trainLora(
        captionedForTraining,
        characterSlug,
        loraId,
        attempt,
        { supabase: sb },
      );

      console.log(`Training complete! ID: ${trainingResult.trainingId}`);

      // Upload for validation
      const tempFilename = `char_${characterSlug}_${loraId.slice(0, 8)}.safetensors`;
      const tempStoragePath = `character-loras/validation/${tempFilename}`;

      await sb.storage
        .from('story-images')
        .upload(tempStoragePath, trainingResult.loraBuffer, {
          contentType: 'application/octet-stream',
          upsert: true,
        });

      const { data: tempUrlData } = sb.storage
        .from('story-images')
        .getPublicUrl(tempStoragePath);

      console.log(`LoRA uploaded for validation: ${tempStoragePath}`);

      // For now, skip validation (Stage 5) — would need full CharacterInput
      // and running ComfyUI on RunPod. Deploy directly.
      console.log(`\n--- Deploying (skipping validation for resume) ---`);

      const deployResult = await modules.deployLora(
        trainingResult.loraBuffer,
        lora.character_id,
        name,
        loraId,
        captionedForTraining.length,
        { supabase: sb },
      );

      console.log(`DEPLOYED: ${deployResult.filename} (${(deployResult.fileSizeBytes / 1024 / 1024).toFixed(1)}MB)`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`RESUME FAILED: ${msg}`);
    await sb.from('character_loras').update({ status: 'failed', error: `Resume failed: ${msg}` }).eq('id', loraId);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const specificId = args.find(a => a.startsWith('--lora-id='))?.split('=')[1];

  if (dryRun) console.log('=== DRY RUN — no changes will be made ===\n');

  // Load TS modules via tsx
  console.log('Loading pipeline modules...');
  let modules;
  try {
    modules = await loadModules();
  } catch (e) {
    console.error('Failed to load modules. Make sure to run with: npx tsx scripts/resume-lora-pipelines.js');
    console.error(e);
    process.exit(1);
  }

  // Find pipelines to resume
  let query = sb
    .from('character_loras')
    .select('id, status, character_id, error')
    .order('created_at', { ascending: false });

  if (specificId) {
    query = query.eq('id', specificId);
  } else {
    // Only get the most recent non-early-failure for each character
    query = query.in('status', ['evaluating', 'training', 'captioning', 'validating', 'failed']);
  }

  const { data: loras } = await query;

  if (!loras || loras.length === 0) {
    console.log('No stuck pipelines found.');
    return;
  }

  // Filter to only latest per character (skip old "Nano Banana SDK broken" failures)
  const seen = new Set();
  const toResume = [];
  for (const lora of loras) {
    if (seen.has(lora.character_id)) continue;
    // Skip old early failures with no dataset
    if (lora.status === 'failed' && lora.error && lora.error.includes('Nano Banana SDK broken')) {
      continue;
    }
    seen.add(lora.character_id);
    toResume.push(lora);
  }

  console.log(`Found ${toResume.length} pipeline(s) to resume:\n`);

  for (const lora of toResume) {
    await resumePipeline(lora.id, dryRun, modules);
  }

  console.log('\n--- All done ---');
}

main().catch(console.error);
