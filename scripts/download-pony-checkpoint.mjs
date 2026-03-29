/**
 * Download CyberRealistic Pony v17 checkpoint to the RunPod network volume.
 *
 * Creates a short-lived GPU pod with the network volume attached,
 * downloads the checkpoint, verifies it, then terminates the pod.
 *
 * Required env vars in .env.local:
 *   RUNPOD_API_KEY           — RunPod API key
 *   RUNPOD_NETWORK_VOLUME_ID — Network volume ID from RunPod dashboard
 *   CIVITAI_API_KEY          — Civitai API key (needed for NSFW model)
 *
 * Usage: node scripts/download-pony-checkpoint.mjs
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local
function loadEnv() {
  try {
    const envPath = resolve(__dirname, "..", ".env.local");
    const envContent = readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    console.error("Could not read .env.local — make sure it exists in the project root.");
    process.exit(1);
  }
}

loadEnv();

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
const VOLUME_ID = process.env.RUNPOD_NETWORK_VOLUME_ID;
const CIVITAI_TOKEN = process.env.CIVITAI_TOKEN || process.env.CIVITAI_API_KEY;
const missing = [];
if (!RUNPOD_API_KEY) missing.push("RUNPOD_API_KEY");
if (!VOLUME_ID) missing.push("RUNPOD_NETWORK_VOLUME_ID");
if (!CIVITAI_TOKEN) missing.push("CIVITAI_TOKEN or CIVITAI_API_KEY");

if (missing.length > 0) {
  console.error(`\nMissing required environment variables:\n  ${missing.join("\n  ")}\n`);
  process.exit(1);
}

const GQL_URL = `https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}`;

async function gql(query) {
  const res = await fetch(GQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(`RunPod GraphQL error: ${JSON.stringify(json.errors)}`);
  return json.data;
}

const GPU_TYPES = [
  "NVIDIA RTX 5090",
  "NVIDIA GeForce RTX 5090",
  "NVIDIA GeForce RTX 4090",
  "NVIDIA RTX A4500",
  "NVIDIA RTX A4000",
  "NVIDIA RTX 4000 Ada Generation",
  "NVIDIA RTX 2000 Ada Generation",
  "NVIDIA L40",
  "NVIDIA L40S",
  "NVIDIA L4",
  "NVIDIA GeForce RTX 3090",
  "NVIDIA GeForce RTX 3080",
];

async function createPod() {
  for (const gpuType of GPU_TYPES) {
    try {
      console.log(`Trying ${gpuType}...`);
      const data = await gql(`
        mutation {
          podFindAndDeployOnDemand(input: {
            name: "pony-checkpoint-downloader"
            imageName: "runpod/pytorch:2.4.1-py3.11-cuda12.4.1-devel-ubuntu22.04"
            gpuTypeId: "${gpuType}"
            cloudType: SECURE
            volumeKey: "${VOLUME_ID}"
            volumeMountPath: "/workspace"
            startJupyter: false
            startSsh: true
            minMemoryInGb: 8
            minVcpuCount: 2
          }) {
            id
            desiredStatus
          }
        }
      `);
      console.log(`Got ${gpuType}!`);
      return data.podFindAndDeployOnDemand;
    } catch (err) {
      if (err.message.includes("SUPPLY_CONSTRAINT")) continue;
      throw err;
    }
  }
  return null; // No GPU available this round
}

async function createPodWithRetry(maxRetries = 30, intervalMs = 60_000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`\n--- Attempt ${attempt}/${maxRetries} ---`);
    const pod = await createPod();
    if (pod) return pod;
    console.log(`No GPUs available. Retrying in ${intervalMs / 1000}s...`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`No GPU available after ${maxRetries} attempts`);
}

async function getPodStatus(podId) {
  const data = await gql(`
    query { pod(input: { podId: "${podId}" }) { id desiredStatus runtime { uptimeInSeconds gpus { id } } } }
  `);
  return data.pod;
}

async function terminatePod(podId) {
  console.log(`\nTerminating pod ${podId}...`);
  await gql(`mutation { podTerminate(input: { podId: "${podId}" }) }`);
  console.log("Pod terminated.");
}

async function executeCommand(podId, command) {
  const data = await gql(`
    mutation { podExec(input: { podId: "${podId}", command: ${JSON.stringify(command)} }) }
  `);
  return data.podExec;
}

async function waitForPod(podId, timeoutMs = 300_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pod = await getPodStatus(podId);
    if (pod?.runtime?.gpus?.length > 0) {
      console.log("Pod is running.");
      return pod;
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error(`Pod ${podId} did not start within ${timeoutMs / 1000}s`);
}

// CyberRealistic Pony v17 — CivitAI model 443821, version 2727742
const PONY_VERSION_ID = "2727742";
const PONY_FILENAME = "cyberrealisticPony_v17.safetensors";

function buildDownloadScript() {
  return `#!/bin/bash
set -e

DEST="/workspace/models/checkpoints/${PONY_FILENAME}"
mkdir -p /workspace/models/checkpoints

if [ -f "$DEST" ]; then
  SIZE=$(stat -c%s "$DEST" 2>/dev/null || stat -f%z "$DEST" 2>/dev/null || echo 0)
  if [ "$SIZE" -gt 2000000000 ]; then
    echo "${PONY_FILENAME} already exists ($((SIZE / 1024 / 1024))MB) — skipping"
    exit 0
  fi
  echo "Existing file too small ($SIZE bytes) — re-downloading"
  rm -f "$DEST"
fi

echo "Downloading ${PONY_FILENAME} from CivitAI (~6GB)..."
wget --progress=dot:mega \\
  -O "$DEST" \\
  "https://civitai.com/api/download/models/${PONY_VERSION_ID}?token=${CIVITAI_TOKEN}"

SIZE=$(stat -c%s "$DEST" 2>/dev/null || stat -f%z "$DEST" 2>/dev/null || echo 0)
if [ "$SIZE" -lt 2000000000 ]; then
  echo "ERROR: Downloaded file too small ($SIZE bytes) — likely a redirect page"
  rm -f "$DEST"
  exit 1
fi

echo "SUCCESS: ${PONY_FILENAME} downloaded ($((SIZE / 1024 / 1024))MB)"
ls -la /workspace/models/checkpoints/
`;
}

async function main() {
  console.log("=== CyberRealistic Pony v17 Checkpoint Downloader ===\n");
  console.log(`Target: ${PONY_FILENAME}`);
  console.log(`CivitAI version: ${PONY_VERSION_ID}`);
  console.log(`Volume: ${VOLUME_ID}\n`);

  let podId;
  try {
    // Create pod
    const pod = await createPodWithRetry();
    podId = pod.id;
    console.log(`Pod created: ${podId}\n`);

    // Wait for it to start
    console.log("Waiting for pod to start...");
    await waitForPod(podId);

    // Give it a few seconds to fully initialize
    await new Promise((r) => setTimeout(r, 5_000));

    // Run download
    const script = buildDownloadScript();
    console.log("\nRunning download script...");
    const result = await executeCommand(podId, `bash -c '${script.replace(/'/g, "'\\''")}'`);
    console.log("\nExecution result:", result || "(no output captured)");

    // Verify
    console.log("\nVerifying download...");
    await new Promise((r) => setTimeout(r, 3_000));
    const verifyResult = await executeCommand(
      podId,
      `ls -la /workspace/models/checkpoints/${PONY_FILENAME} 2>/dev/null || echo "FILE NOT FOUND"`
    );
    console.log("Verify:", verifyResult || "(checking...)");

    // List all checkpoints
    const listResult = await executeCommand(podId, "ls -lh /workspace/models/checkpoints/");
    console.log("\nAll checkpoints on volume:");
    console.log(listResult || "(no output)");

  } finally {
    if (podId) {
      await terminatePod(podId);
    }
  }

  console.log("\nDone! The Pony checkpoint should now be available on the network volume.");
  console.log("Restart your serverless endpoint workers to pick it up.");
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
