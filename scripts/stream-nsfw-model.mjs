/**
 * Stream Fux Capacity 5.1 FP16 from Civitai directly to RunPod S3 (network volume).
 * Uses parallel HTTP Range requests to download N chunks simultaneously,
 * each uploaded as a separate S3 multipart part. No local disk storage required.
 *
 * Required in .env.local:
 *   CIVITAI_TOKEN / CIVITAI_API_KEY
 *   RUNPOD_S3_ACCESS_KEY
 *   RUNPOD_S3_SECRET_KEY
 *   RUNPOD_S3_ENDPOINT
 *   RUNPOD_S3_REGION
 *   RUNPOD_NETWORK_VOLUME_ID
 */

import { createHmac, createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { request as httpsRequest } from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const content = readFileSync(resolve(__dirname, '..', '.env.local'), 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch { /* no .env.local — rely on environment variables */ }
}
loadEnv();

const CIVITAI_TOKEN  = process.env.CIVITAI_TOKEN || process.env.CIVITAI_API_KEY;
const S3_ACCESS_KEY  = process.env.RUNPOD_S3_ACCESS_KEY;
const S3_SECRET_KEY  = process.env.RUNPOD_S3_SECRET_KEY;
const S3_ENDPOINT    = (process.env.RUNPOD_S3_ENDPOINT || 'https://s3api-eu-ro-1.runpod.io').replace(/\/$/, '');
const S3_REGION      = process.env.RUNPOD_S3_REGION || 'eu-ro-1';
const BUCKET         = process.env.RUNPOD_NETWORK_VOLUME_ID;
const S3_HOST        = new URL(S3_ENDPOINT).hostname;

const NSFW_MODEL_KEY        = 'models/diffusion_models/fuxCapacityNSFWPorn_51FP16.safetensors';
const CIVITAI_VERSION_ID    = '2605292';
const PART_SIZE             = 100 * 1024 * 1024; // 100 MB per part
const PARALLEL_WORKERS      = 4;
const EXPECTED_MIN_BYTES    = 20 * 1024 * 1024 * 1024;

const missing = [];
if (!CIVITAI_TOKEN)  missing.push('CIVITAI_TOKEN or CIVITAI_API_KEY');
if (!S3_ACCESS_KEY)  missing.push('RUNPOD_S3_ACCESS_KEY');
if (!S3_SECRET_KEY)  missing.push('RUNPOD_S3_SECRET_KEY');
if (!BUCKET)         missing.push('RUNPOD_NETWORK_VOLUME_ID');
if (missing.length) { console.error('Missing env vars:', missing.join(', ')); process.exit(1); }

// ---------------------------------------------------------------------------
// AWS Sig V4
// ---------------------------------------------------------------------------
function sha256(data) { return createHash('sha256').update(data).digest('hex'); }
function hmacSha256(key, data) { return createHmac('sha256', key).update(data).digest(); }

function getSigningKey(secret, dateStamp, region, service) {
  return hmacSha256(hmacSha256(hmacSha256(hmacSha256('AWS4' + secret, dateStamp), region), service), 'aws4_request');
}

function getAmzDate() {
  return new Date().toISOString().replace(/[:\-]|\.\d{3}/g, '');
}

function signRequest({ method, path, query = '', headers, payloadHash, date }) {
  const dateStamp = date.slice(0, 8);
  const sortedKeys = Object.keys(headers).map(k => k.toLowerCase()).sort();
  const signedHeaders = sortedKeys.join(';');
  const canonicalHeaders = sortedKeys.map(k => {
    const orig = Object.keys(headers).find(h => h.toLowerCase() === k);
    return `${k}:${headers[orig].trim()}`;
  }).join('\n') + '\n';

  const canonicalRequest = [method, path, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/${S3_REGION}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', date, credentialScope, sha256(canonicalRequest)].join('\n');
  const sig = createHmac('sha256', getSigningKey(S3_SECRET_KEY, dateStamp, S3_REGION, 's3')).update(stringToSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${S3_ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;
}

// ---------------------------------------------------------------------------
// Civitai: get final download URL (follow redirects to CDN)
// ---------------------------------------------------------------------------
function resolveDownloadUrl(versionId, token) {
  // Follow Civitai → CDN redirect, then probe with Range: bytes=0-0
  // Presigned CDN URLs are self-authenticating — do NOT send Authorization header to them
  return new Promise((resolve, reject) => {
    const followRedirect = (url, isCivitai = true, hops = 0) => {
      if (hops > 5) return reject(new Error('Too many redirects'));
      const u = new URL(url);
      const headers = isCivitai ? { Authorization: `Bearer ${token}` } : {};
      const req = httpsRequest({
        hostname: u.hostname, port: 443, path: u.pathname + u.search,
        method: 'GET', headers: { ...headers, Range: 'bytes=0-0' },
        agent: false,
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          followRedirect(res.headers.location, false, hops + 1);
        } else if (res.statusCode === 200 || res.statusCode === 206) {
          const range = res.headers['content-range'];
          const contentLength = range
            ? parseInt(range.split('/')[1], 10)
            : parseInt(res.headers['content-length'] || '0', 10);
          res.resume();
          resolve({ url, contentLength });
        } else {
          reject(new Error(`GET ${res.statusCode} at ${url.slice(0, 80)}`));
        }
      });
      req.on('error', reject);
      req.end();
    };
    followRedirect(`https://civitai.com/api/download/models/${versionId}?token=${token}`);
  });
}

// ---------------------------------------------------------------------------
// Civitai: download a byte range into a Buffer
// ---------------------------------------------------------------------------
function downloadRange(url, token, start, end) {
  // url is already the resolved CDN URL — no Authorization header (presigned URL is self-auth)
  return new Promise((resolve, reject) => {
    const fetch = (fetchUrl, isCivitai = false, hops = 0) => {
      if (hops > 5) return reject(new Error('Too many redirects'));
      const u = new URL(fetchUrl);
      const headers = isCivitai
        ? { Authorization: `Bearer ${token}`, Range: `bytes=${start}-${end}` }
        : { Range: `bytes=${start}-${end}` };
      const req = httpsRequest({
        hostname: u.hostname, port: 443,
        path: u.pathname + u.search,
        method: 'GET', headers, agent: false,
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetch(res.headers.location, false, hops + 1);
        }
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          return reject(new Error(`Range download → ${res.statusCode} for bytes ${start}-${end}`));
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end();
    };
    fetch(url);
  });
}

// ---------------------------------------------------------------------------
// S3 helpers
// ---------------------------------------------------------------------------
function s3Raw({ method, path, query = '', headers, body = null }) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${S3_ENDPOINT}${path}${query ? '?' + query : ''}`);
    const req = httpsRequest({
      hostname: url.hostname, port: 443,
      path: url.pathname + url.search,
      method, headers, agent: false,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString();
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: responseBody });
        } else {
          reject(new Error(`S3 ${method} ${path} → ${res.statusCode}: ${responseBody.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : body);
    req.end();
  });
}

function s3Sign(method, path, query, extraHeaders, payloadHash) {
  const date = getAmzDate();
  const headers = { Host: S3_HOST, 'x-amz-date': date, 'x-amz-content-sha256': payloadHash, ...extraHeaders };
  headers['Authorization'] = signRequest({ method, path, query, headers, payloadHash, date });
  return headers;
}

async function createMultipartUpload(key) {
  const path = `/${BUCKET}/${key}`;
  const hash = sha256('');
  const headers = s3Sign('POST', path, 'uploads=', {}, hash);
  const res = await s3Raw({ method: 'POST', path, query: 'uploads=', headers });
  const match = res.body.match(/<UploadId>([^<]+)<\/UploadId>/);
  if (!match) throw new Error(`No UploadId in: ${res.body.slice(0, 200)}`);
  return match[1];
}

async function uploadPart(key, uploadId, partNumber, data) {
  const path = `/${BUCKET}/${key}`;
  const query = `partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`;
  const hash = sha256(data);
  const extraHeaders = { 'Content-Length': String(data.length) };
  const headers = s3Sign('PUT', path, query, extraHeaders, hash);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await s3Raw({ method: 'PUT', path, query, headers, body: data });
      return res.headers['etag'].replace(/"/g, '');
    } catch (err) {
      if (attempt === 3) throw err;
      console.warn(`\n    Part ${partNumber} attempt ${attempt} failed (${err.message}), retrying in ${attempt * 2}s...`);
      await new Promise(r => setTimeout(r, attempt * 2000));
      // Re-sign with fresh timestamp on retry
      const newHeaders = s3Sign('PUT', path, query, extraHeaders, hash);
      Object.assign(headers, newHeaders);
    }
  }
}

async function completeMultipartUpload(key, uploadId, parts) {
  const path = `/${BUCKET}/${key}`;
  const query = `uploadId=${encodeURIComponent(uploadId)}`;
  const xml = `<CompleteMultipartUpload>${
    parts.map(({ partNumber, etag }) =>
      `<Part><PartNumber>${partNumber}</PartNumber><ETag>${etag}</ETag></Part>`
    ).join('')
  }</CompleteMultipartUpload>`;
  const hash = sha256(xml);
  const headers = s3Sign('POST', path, query, { 'Content-Type': 'application/xml', 'Content-Length': String(xml.length) }, hash);
  await s3Raw({ method: 'POST', path, query, headers, body: xml });
}

async function abortMultipartUpload(key, uploadId) {
  try {
    const path = `/${BUCKET}/${key}`;
    const query = `uploadId=${encodeURIComponent(uploadId)}`;
    const headers = s3Sign('DELETE', path, query, {}, sha256(''));
    await s3Raw({ method: 'DELETE', path, query, headers });
    console.log('Multipart upload aborted.');
  } catch (e) {
    console.warn('Abort failed (non-fatal):', e.message);
  }
}

async function getExistingSize(key) {
  try {
    const path = `/${BUCKET}/${key}`;
    const headers = s3Sign('HEAD', path, '', {}, sha256(''));
    const res = await s3Raw({ method: 'HEAD', path, query: '', headers });
    return parseInt(res.headers['content-length'] || '0', 10);
  } catch {
    return null;
  }
}

async function deleteObject(key) {
  try {
    const path = `/${BUCKET}/${key}`;
    const headers = s3Sign('DELETE', path, '', {}, sha256(''));
    await s3Raw({ method: 'DELETE', path, headers });
  } catch (e) {
    console.warn('Delete failed (non-fatal):', e.message);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\nTarget: s3://${BUCKET}/${NSFW_MODEL_KEY}`);

  const existingSize = await getExistingSize(NSFW_MODEL_KEY);
  if (existingSize !== null && existingSize >= EXPECTED_MIN_BYTES) {
    console.log(`Model already exists (${(existingSize / 1024 / 1024 / 1024).toFixed(2)} GB). Nothing to do.`);
    return;
  }
  if (existingSize !== null) {
    console.log(`Found incomplete file (${(existingSize / 1024 / 1024).toFixed(0)} MB). Deleting...`);
    await deleteObject(NSFW_MODEL_KEY);
  }

  // Resolve final CDN URL and content length
  console.log('Resolving Civitai download URL...');
  const { url: downloadUrl, contentLength } = await resolveDownloadUrl(CIVITAI_VERSION_ID, CIVITAI_TOKEN);
  const totalParts = Math.ceil(contentLength / PART_SIZE);
  console.log(`File: ${(contentLength / 1024 / 1024 / 1024).toFixed(2)} GB → ${totalParts} parts × ${PART_SIZE / 1024 / 1024} MB`);
  console.log(`Workers: ${PARALLEL_WORKERS} parallel\n`);

  const uploadId = await createMultipartUpload(NSFW_MODEL_KEY);
  console.log(`Multipart upload: ${uploadId.slice(0, 40)}...\n`);

  const parts = new Array(totalParts);
  let completed = 0;
  const startTime = Date.now();

  // Worker: processes parts from a shared queue
  async function worker(workerId) {
    while (true) {
      // Atomically claim the next uncompleted part
      const partIdx = parts.findIndex((p, i) => p === undefined && i < totalParts);
      if (partIdx === -1) break;
      parts[partIdx] = null; // mark as claimed

      const partNumber = partIdx + 1;
      const byteStart = partIdx * PART_SIZE;
      const byteEnd = Math.min(byteStart + PART_SIZE - 1, contentLength - 1);
      const partBytes = byteEnd - byteStart + 1;

      process.stdout.write(`  [W${workerId}] Part ${partNumber}/${totalParts} (${(partBytes / 1024 / 1024).toFixed(0)} MB)... `);

      let data;
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          data = await downloadRange(downloadUrl, CIVITAI_TOKEN, byteStart, byteEnd);
          break;
        } catch (err) {
          if (attempt === 4) throw new Error(`Download part ${partNumber} failed after 4 attempts: ${err.message}`);
          console.warn(`\n    [W${workerId}] Download attempt ${attempt} failed (${err.message}), retrying in ${attempt * 3}s...`);
          await new Promise(r => setTimeout(r, attempt * 3000));
        }
      }

      const etag = await uploadPart(NSFW_MODEL_KEY, uploadId, partNumber, data);
      parts[partIdx] = { partNumber, etag };
      completed++;

      const elapsed = (Date.now() - startTime) / 1000;
      const bytesUploaded = completed * PART_SIZE;
      const mbps = (bytesUploaded / 1024 / 1024 / elapsed).toFixed(1);
      const pct = ((completed / totalParts) * 100).toFixed(1);
      console.log(`done  [${mbps} MB/s, ${pct}%]`);
    }
  }

  try {
    await Promise.all(
      Array.from({ length: PARALLEL_WORKERS }, (_, i) => worker(i + 1))
    );

    // Validate all parts completed
    if (parts.some(p => !p)) throw new Error('Some parts did not complete');

    console.log(`\nCompleting multipart upload (${totalParts} parts)...`);
    await completeMultipartUpload(NSFW_MODEL_KEY, uploadId, parts);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    console.log(`\n✓ Upload complete: ${(contentLength / 1024 / 1024 / 1024).toFixed(2)} GB in ${elapsed}s`);
    console.log(`  File: /workspace/${NSFW_MODEL_KEY}`);
    console.log(`  KONTEXT_NSFW_MODEL is already set — NSFW generations will use Fux Capacity.\n`);

  } catch (err) {
    console.error('\nUpload failed:', err.message);
    await abortMultipartUpload(NSFW_MODEL_KEY, uploadId);
    process.exit(1);
  }
}

main();
