/**
 * Smoke test for the LoRA safetensors upload path.
 *
 * Creates a signed upload URL against lora-training-datasets (same code path
 * as pony-lora-trainer.ts), uploads a 1KB dummy file, then cleans up.
 * Use this to diagnose 400 errors without waiting 90 min for a real training run.
 *
 * Usage:
 *   npx tsx scripts/test-lora-upload.ts
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

const BUCKET = 'lora-training-datasets';
const TEST_PATH = `trained/characters/test_upload_smoke_${Date.now()}.safetensors`;

// Simulate a real LoRA file: safetensors header + 100MB of zeros.
// SDXL dim-8 LoRAs are typically 50-150MB (much larger than SD1.5).
// 100MB covers the realistic range and will catch bucket size limit issues.
const DUMMY_SAFETENSORS = Buffer.concat([
  Buffer.from([0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), // header_size = 2 (little-endian u64)
  Buffer.from('{}'),                                                // empty metadata
  Buffer.alloc(100 * 1024 * 1024, 0x00),                          // 100MB padding
]);

async function run() {
  console.log(`Bucket:    ${BUCKET}`);
  console.log(`Path:      ${TEST_PATH}`);
  console.log(`File size: ${DUMMY_SAFETENSORS.length} bytes`);
  console.log('');

  // Step 1: Create signed upload URL (same call as pony-lora-trainer.ts)
  console.log('1. Creating signed upload URL...');
  const { data: signData, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(TEST_PATH);

  if (signErr || !signData) {
    console.error('FAILED to create signed URL:', signErr?.message);
    process.exit(1);
  }
  console.log('   Signed URL created OK');
  console.log(`   URL: ${signData.signedUrl.slice(0, 120)}...`);
  console.log('');

  // Step 2: Upload via raw PUT with explicit Content-Length (same as the pod)
  console.log('2. Uploading via PUT...');
  const resp = await fetch(signData.signedUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(DUMMY_SAFETENSORS.length),
    },
    body: DUMMY_SAFETENSORS,
  });

  const responseText = await resp.text();
  console.log(`   HTTP ${resp.status} ${resp.statusText}`);
  console.log(`   Response body: ${responseText}`);
  console.log('');

  if (!resp.ok) {
    console.error(`UPLOAD FAILED — exact Supabase error above`);
    process.exit(1);
  }

  console.log('Upload succeeded.');

  // Step 3: Clean up
  console.log('3. Cleaning up test file...');
  const { error: delErr } = await supabase.storage.from(BUCKET).remove([TEST_PATH]);
  if (delErr) {
    console.warn(`   Cleanup warning: ${delErr.message}`);
  } else {
    console.log('   Deleted OK');
  }

  console.log('\nAll good — upload path is working.');
}

run().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
