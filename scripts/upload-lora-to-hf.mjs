/**
 * Download bodylicious-flux.safetensors from RunPod S3 to /tmp,
 * then upload to HuggingFace Hub.
 */
import { createHmac, createHash } from 'crypto';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local
const envPath = resolve(__dirname, '..', '.env.local');
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
const HF_TOKEN = process.env.HUGGINGFACE_TOKEN;

const LORA_KEY = 'models/loras/bodylicious-flux.safetensors';
const TMP_FILE = '/tmp/bodylicious-flux.safetensors';
const HF_REPO = 'nosafe/bodylicious-flux';

function sha256(data) { return createHash('sha256').update(data).digest('hex'); }
function hmacSha256(key, data) { return createHmac('sha256', key).update(data).digest(); }
function getSigningKey(secret, dateStamp, region, service) {
  return hmacSha256(hmacSha256(hmacSha256(hmacSha256('AWS4' + secret, dateStamp), region), service), 'aws4_request');
}

function signedHeaders(method, key) {
  const date = new Date().toISOString().replace(/[:\-]|\.\d{3}/g, '');
  const dateStamp = date.slice(0, 8);
  const path = `/${BUCKET}/${key}`;
  const payloadHash = 'UNSIGNED-PAYLOAD';
  const headers = { Host: S3_HOST, 'x-amz-date': date, 'x-amz-content-sha256': payloadHash };
  const sortedKeys = Object.keys(headers).map(k => k.toLowerCase()).sort();
  const signedHdrs = sortedKeys.join(';');
  const canonicalHeaders = sortedKeys.map(k => {
    const orig = Object.keys(headers).find(h => h.toLowerCase() === k);
    return `${k}:${headers[orig].trim()}`;
  }).join('\n') + '\n';
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHdrs, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/${S3_REGION}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', date, credentialScope, sha256(canonicalRequest)].join('\n');
  const sig = createHmac('sha256', getSigningKey(S3_SECRET_KEY, dateStamp, S3_REGION, 's3')).update(stringToSign).digest('hex');
  const auth = `AWS4-HMAC-SHA256 Credential=${S3_ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHdrs}, Signature=${sig}`;
  return { url: `${S3_ENDPOINT}${path}`, headers: { ...headers, Authorization: auth } };
}

async function main() {
  // Step 1: Download from RunPod S3
  console.log(`Downloading ${LORA_KEY} from RunPod S3...`);
  const { url, headers } = signedHeaders('GET', LORA_KEY);
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`S3 download failed: ${resp.status}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  console.log(`Downloaded: ${Math.round(buffer.length / 1024 / 1024)}MB`);
  
  // Save to tmp
  writeFileSync(TMP_FILE, buffer);
  console.log(`Saved to ${TMP_FILE}`);
  
  // Step 2: Upload to HuggingFace
  console.log(`\nUploading to HuggingFace repo: ${HF_REPO}...`);
  
  // Create repo if it doesn't exist, then upload
  const pyScript = `
import sys
from huggingface_hub import HfApi, create_repo

api = HfApi(token="${HF_TOKEN}")

# Create repo (ignore if exists)
try:
    create_repo("${HF_REPO}", repo_type="model", private=False, token="${HF_TOKEN}")
    print("Created repo: ${HF_REPO}")
except Exception as e:
    if "409" in str(e) or "already" in str(e).lower():
        print("Repo already exists")
    else:
        print(f"Repo creation: {e}")

# Upload file
api.upload_file(
    path_or_fileobj="${TMP_FILE}",
    path_in_repo="bodylicious-flux.safetensors",
    repo_id="${HF_REPO}",
    repo_type="model",
)
print("Upload complete!")
print(f"URL: https://huggingface.co/${HF_REPO}/resolve/main/bodylicious-flux.safetensors")
`;
  
  execSync(`python3 -c '${pyScript.replace(/'/g, "'\\''")}'`, { stdio: 'inherit' });
  
  // Clean up
  unlinkSync(TMP_FILE);
  console.log('Temp file cleaned up.');
}

main().catch(err => { console.error(err); process.exit(1); });
