/**
 * Download bodylicious-flux.safetensors from RunPod S3 volume
 * and upload to Supabase Storage for use with Replicate multi-LoRA model.
 */
import { createHmac, createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local
const envPath = resolve('/Users/Howard/Projects/No-Safe-Word/.env.local');
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const S3_ACCESS_KEY = process.env.RUNPOD_S3_ACCESS_KEY;
const S3_SECRET_KEY = process.env.RUNPOD_S3_SECRET_KEY;
const S3_ENDPOINT = process.env.RUNPOD_S3_ENDPOINT.replace(/\/$/, '');
const S3_REGION = process.env.RUNPOD_S3_REGION || 'eu-ro-1';
const BUCKET = process.env.RUNPOD_NETWORK_VOLUME_ID;
const S3_HOST = new URL(S3_ENDPOINT).hostname;

const LORA_KEY = 'models/loras/bodylicious-flux.safetensors';

// AWS Sig V4
function sha256(data) { return createHash('sha256').update(data).digest('hex'); }
function hmacSha256(key, data) { return createHmac('sha256', key).update(data).digest(); }
function getSigningKey(secret, dateStamp, region, service) {
  return hmacSha256(hmacSha256(hmacSha256(hmacSha256('AWS4' + secret, dateStamp), region), service), 'aws4_request');
}

function signedFetchUrl(method, key) {
  const date = new Date().toISOString().replace(/[:\-]|\.\d{3}/g, '');
  const dateStamp = date.slice(0, 8);
  const path = `/${BUCKET}/${key}`;
  const payloadHash = 'UNSIGNED-PAYLOAD';
  const headers = { Host: S3_HOST, 'x-amz-date': date, 'x-amz-content-sha256': payloadHash };
  
  const sortedKeys = Object.keys(headers).map(k => k.toLowerCase()).sort();
  const signedHeaders = sortedKeys.join(';');
  const canonicalHeaders = sortedKeys.map(k => {
    const orig = Object.keys(headers).find(h => h.toLowerCase() === k);
    return `${k}:${headers[orig].trim()}`;
  }).join('\n') + '\n';
  
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/${S3_REGION}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', date, credentialScope, sha256(canonicalRequest)].join('\n');
  const sig = createHmac('sha256', getSigningKey(S3_SECRET_KEY, dateStamp, S3_REGION, 's3')).update(stringToSign).digest('hex');
  const auth = `AWS4-HMAC-SHA256 Credential=${S3_ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;
  
  return { url: `${S3_ENDPOINT}${path}`, headers: { ...headers, Authorization: auth } };
}

async function main() {
  // Step 1: Download from RunPod S3
  console.log(`Downloading ${LORA_KEY} from RunPod S3...`);
  const { url, headers } = signedFetchUrl('GET', LORA_KEY);
  
  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`S3 download failed: ${resp.status} ${body}`);
  }
  
  const buffer = Buffer.from(await resp.arrayBuffer());
  console.log(`Downloaded: ${Math.round(buffer.length / 1024 / 1024)}MB`);
  
  // Step 2: Upload to Supabase Storage
  console.log('Uploading to Supabase Storage...');
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  
  const storagePath = 'loras/bodylicious-flux.safetensors';
  const { error } = await supabase.storage
    .from('story-images')
    .upload(storagePath, buffer, {
      contentType: 'application/octet-stream',
      upsert: true,
    });
  
  if (error) throw new Error(`Supabase upload failed: ${error.message}`);
  
  const { data: { publicUrl } } = supabase.storage
    .from('story-images')
    .getPublicUrl(storagePath);
  
  console.log(`\nUploaded! Public URL:\n${publicUrl}`);
  
  // Verify it's accessible
  const check = await fetch(publicUrl, { method: 'HEAD' });
  console.log(`URL check: ${check.status} ${check.ok ? 'OK' : 'FAILED'}`);
}

main().catch(err => { console.error(err); process.exit(1); });
