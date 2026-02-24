/**
 * Resume stuck LoRA pipelines from where they left off.
 *
 * Usage:
 *   npx tsx scripts/resume-lora-pipelines.ts                    # resume all stuck
 *   npx tsx scripts/resume-lora-pipelines.ts --lora-id=<id>     # resume specific one
 *   npx tsx scripts/resume-lora-pipelines.ts --dry-run           # show what would happen
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

import { generateCaptions } from '../packages/image-gen/src/character-lora/caption-generator';
import { trainLora } from '../packages/image-gen/src/character-lora/trainer';
import { deployLora } from '../packages/image-gen/src/character-lora/deployer';
import { PIPELINE_CONFIG } from '../packages/image-gen/src/character-lora/types';
import type { LoraDatasetImageRow, CaptionResult } from '../packages/image-gen/src/character-lora/types';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const charNames: Record<string, string> = {
  'b4344cb6-1615-4169-9e1c-3e6bbc4bcd2c': 'Zanele',
  'd757c016-20cf-43de-b671-a80842798e23': 'Langa Mkhize',
  'efc71e1c-06aa-4cc1-993d-c852636ce10e': 'Lindiwe Dlamini',
  'cfc4548b-6e95-4186-8d4a-a566e6c6d454': 'Sibusiso Ndlovu',
};

async function getLoraState(loraId: string) {
  const { data: lora } = await (sb as any)
    .from('character_loras')
    .select('*')
    .eq('id', loraId)
    .single();

  const { data: images } = await (sb as any)
    .from('lora_dataset_images')
    .select('*')
    .eq('lora_id', loraId)
    .order('created_at');

  const allImgs = (images || []) as LoraDatasetImageRow[];
  const passed = allImgs.filter((i) => i.eval_status === 'passed');
  const failed = allImgs.filter((i) => i.eval_status === 'failed');
  const captioned = allImgs.filter((i) => i.caption);

  return { lora, images: allImgs, passed, failed, captioned };
}

async function resumePipeline(loraId: string, dryRun: boolean) {
  const state = await getLoraState(loraId);
  const { lora, passed, failed, captioned, images } = state;
  const name = charNames[lora.character_id] || lora.character_id;
  const charGender = ['Sibusiso', 'Langa'].some((n) => name.includes(n)) ? 'male' : 'female';

  console.log(`\n${'='.repeat(55)}`);
  console.log(`${name} | Current: ${lora.status.toUpperCase()} | LoRA: ${loraId}`);
  console.log(`Dataset: ${images.length} imgs | Passed: ${passed.length} | Failed: ${failed.length} | Captioned: ${captioned.length}`);

  // Determine action
  let action: string;
  let resumeFrom: string;

  if (lora.status === 'evaluating') {
    if (passed.length >= 15) {
      action = `Proceed with ${passed.length} passed images (lowered threshold from 20)`;
      resumeFrom = captioned.length > 0 ? 'training' : 'captioning';
    } else {
      action = `Only ${passed.length} passed — insufficient for training`;
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
  } else if (lora.status === 'failed' && passed.length >= 15) {
    // Failed with enough data to retry — likely ZIP size, training dest, or training error
    if (captioned.length > 0) {
      action = `Retry training (${captioned.length} captioned images). Previous error: ${lora.error}`;
      resumeFrom = 'training';
    } else {
      action = `Caption ${passed.length} passed images, then train. Previous error: ${lora.error}`;
      resumeFrom = 'captioning';
    }
  } else if (lora.status === 'captioning') {
    resumeFrom = 'captioning';
    action = `Resume captioning with ${passed.length} passed images`;
  } else {
    action = `Status "${lora.status}" with ${passed.length} passed — skipping`;
    resumeFrom = 'skip';
  }

  console.log(`Action: ${action}`);
  console.log(`Resume from: ${resumeFrom}`);

  if (dryRun || resumeFrom === 'skip') return;

  if (resumeFrom === 'fail') {
    await (sb as any).from('character_loras').update({ status: 'failed', error: action }).eq('id', loraId);
    console.log('Marked as failed.');
    return;
  }

  const characterSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  try {
    // ── STAGE 3: Captioning ──
    if (resumeFrom === 'captioning') {
      console.log(`\n--- Captioning ${passed.length} images ---`);
      await (sb as any).from('character_loras').update({ status: 'captioning' }).eq('id', loraId);

      const captionResult = await generateCaptions(passed, charGender, { supabase: sb });
      console.log(`Captioned: ${captionResult.totalCaptioned}`);
      resumeFrom = 'training';
    }

    // ── STAGE 4: Training ──
    if (resumeFrom === 'training') {
      console.log(`\n--- Training ---`);
      await (sb as any).from('character_loras').update({ status: 'training' }).eq('id', loraId);

      // Get captioned images
      const { data: captionedImgs } = await (sb as any)
        .from('lora_dataset_images')
        .select('*')
        .eq('lora_id', loraId)
        .not('caption', 'is', null)
        .eq('eval_status', 'passed');

      const captionedForTraining: CaptionResult['captionedImages'] = (captionedImgs || []).map(
        (img: LoraDatasetImageRow) => ({
          imageUrl: img.image_url,
          caption: img.caption!,
          storagePath: img.storage_path,
        })
      );

      console.log(`Training with ${captionedForTraining.length} images...`);

      // Check if there's an existing Replicate training that succeeded or is still processing
      let trainingResult: { trainingId: string; loraUrl: string; loraBuffer: Buffer; attempt: number } | null = null;

      if (lora.training_id) {
        console.log(`Checking existing training ${lora.training_id}...`);
        let existing: any;
        try {
          const resp = await fetch(`https://api.replicate.com/v1/trainings/${lora.training_id}`, {
            headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` },
          });
          existing = await resp.json();
        } catch (fetchErr: any) {
          console.error(`Failed to check training: ${fetchErr.message}`);
          if (fetchErr.cause) console.error(`Cause: ${JSON.stringify(fetchErr.cause)}`);
          existing = { status: 'unknown' };
        }

        if (existing.status === 'succeeded' && existing.output?.weights) {
          // Get file size via HEAD instead of downloading the full 177MB file
          const headResp = await fetch(existing.output.weights, { method: 'HEAD' });
          const fileSize = parseInt(headResp.headers.get('content-length') || '0', 10);
          console.log(`Existing training already succeeded! Weights: ${(fileSize / 1024 / 1024).toFixed(1)}MB`);
          trainingResult = {
            trainingId: lora.training_id,
            loraUrl: existing.output.weights,
            loraBuffer: Buffer.alloc(0), // Not needed — deployer uses loraUrl directly
            attempt: lora.training_attempts || 1,
          };
          // Store actual file size for DB
          (trainingResult as any).fileSizeBytes = fileSize;
        } else if (existing.status === 'processing' || existing.status === 'starting') {
          console.log(`Existing training still ${existing.status}. Polling...`);
          let status = existing;
          let pollCount = 0;
          const maxPolls = 120;
          while (status.status !== 'succeeded' && status.status !== 'failed' && status.status !== 'canceled' && pollCount < maxPolls) {
            await new Promise(r => setTimeout(r, PIPELINE_CONFIG.replicatePollingInterval));
            const pollResp = await fetch(`https://api.replicate.com/v1/trainings/${lora.training_id}`, {
              headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` },
            });
            status = await pollResp.json();
            pollCount++;
            if (pollCount % 4 === 0) {
              console.log(`Polling... status=${status.status} (${pollCount * 15}s elapsed)`);
            }
          }
          if (status.status === 'succeeded' && status.output?.weights) {
            const headResp = await fetch(status.output.weights, { method: 'HEAD' });
            const fileSize = parseInt(headResp.headers.get('content-length') || '0', 10);
            console.log(`Training complete! Weights: ${(fileSize / 1024 / 1024).toFixed(1)}MB`);
            trainingResult = {
              trainingId: lora.training_id,
              loraUrl: status.output.weights,
              loraBuffer: Buffer.alloc(0),
              attempt: lora.training_attempts || 1,
            };
            (trainingResult as any).fileSizeBytes = fileSize;
          } else {
            console.log(`Existing training ended with status: ${status.status}. Will start new training.`);
          }
        } else {
          console.log(`Existing training status: ${existing.status}. Will start new training.`);
        }
      }

      // If no usable existing training, start a new one
      if (!trainingResult) {
        const attempt = (lora.training_attempts || 0) + 1;

        // Check for existing ZIP from a previous attempt to skip slow re-download
        let existingZipUrl: string | undefined;
        for (let a = attempt; a >= 1; a--) {
          const zipPath = `character-loras/training/${loraId}/dataset_attempt${a}.zip`;
          const { data: urlData } = (sb as any).storage
            .from('story-images')
            .getPublicUrl(zipPath);
          try {
            const headResp = await fetch(urlData.publicUrl, { method: 'HEAD' });
            if (headResp.ok && headResp.headers.get('content-length') !== '0') {
              existingZipUrl = urlData.publicUrl;
              console.log(`Found existing ZIP at attempt ${a}: ${zipPath}`);
              break;
            }
          } catch {
            // ZIP doesn't exist at this attempt, try earlier
          }
        }

        trainingResult = await trainLora(
          captionedForTraining,
          characterSlug,
          loraId,
          attempt,
          { supabase: sb },
          undefined, // paramsOverrides
          existingZipUrl,
        );
      }

      console.log(`Training complete! ID: ${trainingResult.trainingId}`);
      console.log(`LoRA size: ${(trainingResult.loraBuffer.length / 1024 / 1024).toFixed(1)}MB`);

      // ── STAGE 6: Deploy (skipping validation for resume) ──
      console.log(`\n--- Deploying ---`);

      const deployResult = await deployLora(
        trainingResult.loraBuffer,
        lora.character_id,
        name,
        loraId,
        captionedForTraining.length,
        { supabase: sb },
        trainingResult.loraUrl,
        (trainingResult as any).fileSizeBytes,
      );

      console.log(`DEPLOYED: ${deployResult.filename} (${(deployResult.fileSizeBytes / 1024 / 1024).toFixed(1)}MB)`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`\nRESUME FAILED for ${name}: ${msg}`);
    await (sb as any).from('character_loras').update({ status: 'failed', error: `Resume failed: ${msg}` }).eq('id', loraId);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const specificId = args.find((a) => a.startsWith('--lora-id='))?.split('=')[1];

  if (dryRun) console.log('=== DRY RUN — no changes will be made ===\n');

  // Find pipelines to resume
  let query = (sb as any)
    .from('character_loras')
    .select('id, status, character_id, error')
    .order('created_at', { ascending: false });

  if (specificId) {
    query = query.eq('id', specificId);
  } else {
    query = query.in('status', ['evaluating', 'training', 'captioning', 'validating', 'failed']);
  }

  const { data: loras } = await query;

  if (!loras || loras.length === 0) {
    console.log('No stuck pipelines found.');
    return;
  }

  // Filter to latest per character, skip old early failures
  const seen = new Set<string>();
  const toResume: typeof loras = [];
  for (const lora of loras) {
    if (seen.has(lora.character_id)) continue;
    if (lora.status === 'failed' && lora.error?.includes('Nano Banana SDK broken')) continue;
    seen.add(lora.character_id);
    toResume.push(lora);
  }

  console.log(`Found ${toResume.length} pipeline(s) to resume:\n`);

  for (const lora of toResume) {
    await resumePipeline(lora.id, dryRun);
  }

  console.log('\n--- All done ---');
}

main().catch(console.error);
