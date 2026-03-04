/**
 * Download Flux Kontext model files to the RunPod network volume.
 *
 * Creates a short-lived GPU pod with the network volume attached,
 * downloads required model files, verifies them, then terminates the pod.
 *
 * Required env vars in .env.local:
 *   RUNPOD_API_KEY          — RunPod API key
 *   RUNPOD_NETWORK_VOLUME_ID — Network volume ID from RunPod dashboard
 *   HF_TOKEN or HUGGINGFACE_TOKEN — HuggingFace token (accept license first)
 *   CIVITAI_TOKEN           — Civitai API key (optional, for NSFW model)
 *   CIVITAI_NSFW_MODEL_URL  — Full Civitai download URL (optional)
 *
 * Usage: node scripts/download-kontext-models.mjs
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Load .env.local
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Validate required env vars
// ---------------------------------------------------------------------------
const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
const VOLUME_ID = process.env.RUNPOD_NETWORK_VOLUME_ID;
const HF_TOKEN = process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN;
const CIVITAI_TOKEN = process.env.CIVITAI_TOKEN;
const CIVITAI_NSFW_URL = process.env.CIVITAI_NSFW_MODEL_URL;

const missing = [];
if (!RUNPOD_API_KEY) missing.push("RUNPOD_API_KEY");
if (!VOLUME_ID) missing.push("RUNPOD_NETWORK_VOLUME_ID");
if (!HF_TOKEN) missing.push("HF_TOKEN or HUGGINGFACE_TOKEN");

if (missing.length > 0) {
  console.error(`\nMissing required environment variables:\n  ${missing.join("\n  ")}\n`);
  console.error("Add them to .env.local and try again.");
  process.exit(1);
}

if (!CIVITAI_TOKEN || !CIVITAI_NSFW_URL) {
  console.warn("\nNote: CIVITAI_TOKEN or CIVITAI_NSFW_MODEL_URL not set — NSFW model download will be skipped.\n");
}

const GQL_URL = `https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}`;

// ---------------------------------------------------------------------------
// GraphQL helpers
// ---------------------------------------------------------------------------
async function gql(query, variables = {}) {
  const res = await fetch(GQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(`RunPod GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

// ---------------------------------------------------------------------------
// Pod lifecycle
// ---------------------------------------------------------------------------
const GPU_TYPES = [
  "NVIDIA GeForce RTX 4090",
  "NVIDIA GeForce RTX 3090",
  "NVIDIA RTX A6000",
  "NVIDIA RTX A5000",
  "NVIDIA RTX A4500",
  "NVIDIA RTX A4000",
  "NVIDIA RTX 4000 Ada Generation",
  "NVIDIA L40",
  "NVIDIA L40S",
  "NVIDIA GeForce RTX 4080",
  "NVIDIA GeForce RTX 3080 Ti",
  "NVIDIA GeForce RTX 3080",
  "NVIDIA A40",
  "NVIDIA L4",
];

async function createPod() {
  for (const gpuType of GPU_TYPES) {
    try {
      console.log(`Trying ${gpuType}...`);
      const data = await gql(`
        mutation {
          podFindAndDeployOnDemand(input: {
            name: "kontext-downloader"
            imageName: "runpod/pytorch:2.4.1-py3.11-cuda12.4.1-devel-ubuntu22.04"
            gpuTypeId: "${gpuType}"
            cloudType: ALL
            volumeKey: "${VOLUME_ID}"
            volumeMountPath: "/workspace"
            startJupyter: false
            startSsh: true
            minMemoryInGb: 8
            minVcpuCount: 2
          }) {
            id
            desiredStatus
            imageName
            runtime {
              ports {
                ip
                privatePort
                publicPort
                type
              }
            }
          }
        }
      `);
      console.log(`Got ${gpuType}!`);
      return data.podFindAndDeployOnDemand;
    } catch (err) {
      if (err.message.includes("SUPPLY_CONSTRAINT")) {
        continue; // Try next GPU type
      }
      throw err; // Re-throw non-supply errors
    }
  }
  throw new Error("No GPU available in any type — EU-RO-1 fully out of stock");
}

async function getPodStatus(podId) {
  const data = await gql(`
    query {
      pod(input: { podId: "${podId}" }) {
        id
        desiredStatus
        runtime {
          uptimeInSeconds
          ports {
            ip
            privatePort
            publicPort
            type
          }
          gpus {
            id
          }
        }
      }
    }
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
    mutation {
      podExec(input: {
        podId: "${podId}",
        command: ${JSON.stringify(command)}
      })
    }
  `);
  return data.podExec;
}

// ---------------------------------------------------------------------------
// Wait for pod to be running
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Build download script
// ---------------------------------------------------------------------------
function buildDownloadScript() {
  const nsfwBlock = CIVITAI_TOKEN && CIVITAI_NSFW_URL
    ? `
NSFW_FILENAME=$(basename "${CIVITAI_NSFW_URL}" | cut -d'?' -f1)
if [ ! -f "/workspace/models/diffusion_models/\${NSFW_FILENAME}" ]; then
  echo "Downloading NSFW Kontext model..."
  wget --header="Authorization: Bearer ${CIVITAI_TOKEN}" \\
    --content-disposition \\
    -P /workspace/models/diffusion_models/ \\
    "${CIVITAI_NSFW_URL}?token=${CIVITAI_TOKEN}" || echo "NSFW download failed (non-fatal)"
else
  echo "NSFW model already exists, skipping."
fi
`
    : 'echo "Skipping NSFW model (CIVITAI_TOKEN or CIVITAI_NSFW_MODEL_URL not set)"';

  return `#!/bin/bash
set -e

mkdir -p /workspace/models/diffusion_models
mkdir -p /workspace/models/clip
mkdir -p /workspace/models/vae

echo "=== Starting Flux Kontext model downloads ==="

# SFW model (Comfy-Org fp8 quantized — no auth needed)
if [ ! -f "/workspace/models/diffusion_models/flux1-dev-kontext_fp8_scaled.safetensors" ]; then
  echo "Downloading SFW Kontext model (~12GB)..."
  wget -O /workspace/models/diffusion_models/flux1-dev-kontext_fp8_scaled.safetensors \\
    "https://huggingface.co/Comfy-Org/flux1-kontext-dev_ComfyUI/resolve/main/split_files/diffusion_models/flux1-dev-kontext_fp8_scaled.safetensors"
else
  echo "SFW model already exists, skipping."
fi

# NSFW model
${nsfwBlock}

# T5 text encoder (if not present)
if [ ! -f "/workspace/models/clip/t5xxl_fp8_e4m3fn_scaled.safetensors" ]; then
  echo "Downloading T5 encoder..."
  wget --header="Authorization: Bearer ${HF_TOKEN}" \\
    -O /workspace/models/clip/t5xxl_fp8_e4m3fn_scaled.safetensors \\
    "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp8_e4m3fn_scaled.safetensors"
else
  echo "T5 encoder already exists, skipping."
fi

# CLIP L (if not present)
if [ ! -f "/workspace/models/clip/clip_l.safetensors" ]; then
  echo "Downloading CLIP L..."
  wget --header="Authorization: Bearer ${HF_TOKEN}" \\
    -O /workspace/models/clip/clip_l.safetensors \\
    "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors"
else
  echo "CLIP L already exists, skipping."
fi

# VAE (if not present)
if [ ! -f "/workspace/models/vae/ae.safetensors" ]; then
  echo "Downloading VAE..."
  wget --header="Authorization: Bearer ${HF_TOKEN}" \\
    -O /workspace/models/vae/ae.safetensors \\
    "https://huggingface.co/black-forest-labs/FLUX.1-dev/resolve/main/ae.safetensors"
else
  echo "VAE already exists, skipping."
fi

echo ""
echo "=== ALL DOWNLOADS COMPLETE ==="
echo ""
echo "--- diffusion_models ---"
ls -lh /workspace/models/diffusion_models/ 2>/dev/null || echo "(empty)"
echo ""
echo "--- clip ---"
ls -lh /workspace/models/clip/ 2>/dev/null || echo "(empty)"
echo ""
echo "--- vae ---"
ls -lh /workspace/models/vae/ 2>/dev/null || echo "(empty)"
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  let podId = null;

  try {
    // Create pod
    const pod = await createPod();
    podId = pod.id;
    console.log(`Pod created: ${podId}`);

    // Wait for pod to be running
    console.log("Waiting for pod to start...");
    await waitForPod(podId);

    // Give the pod a moment to fully initialize SSH
    console.log("Waiting for SSH initialization...");
    await new Promise((r) => setTimeout(r, 15_000));

    // Execute download script via podExec
    const downloadScript = buildDownloadScript();
    console.log("\n--- Executing download script on pod ---\n");

    // RunPod podExec may not be available on all pod types.
    // Try podExec first; if it fails, print SSH instructions.
    try {
      const result = await executeCommand(podId, `bash -c '${downloadScript.replace(/'/g, "'\\''")}'`);
      console.log(result || "(no output)");
    } catch (execErr) {
      console.warn(`\npodExec not available: ${execErr.message}`);
      console.log("\n--- Manual SSH required ---");

      // Get pod SSH info
      const podInfo = await getPodStatus(podId);
      const sshPort = podInfo?.runtime?.ports?.find((p) => p.privatePort === 22);

      if (sshPort) {
        console.log(`\nSSH into the pod and run the download commands:`);
        console.log(`  ssh root@${sshPort.ip} -p ${sshPort.publicPort}`);
      } else {
        console.log(`\nSSH info not available. Check RunPod dashboard for pod ${podId}.`);
      }

      console.log(`\nThen run these commands:\n`);
      console.log(downloadScript);
      console.log(`\nAfter downloads complete, terminate the pod from RunPod dashboard.`);
      console.log(`Pod ID: ${podId}`);
      return; // Don't terminate — user needs SSH access
    }

    // Verify key files exist
    console.log("\n--- Verifying downloads ---\n");
    try {
      const verifyResult = await executeCommand(podId,
        `bash -c 'ls -lh /workspace/models/diffusion_models/*.safetensors /workspace/models/clip/*.safetensors /workspace/models/vae/*.safetensors 2>/dev/null'`
      );
      console.log(verifyResult || "(no files found)");
    } catch {
      console.warn("Could not verify files via podExec.");
    }

    // Terminate pod
    await terminatePod(podId);
    podId = null; // Don't terminate again in catch

    // Print summary
    console.log(`
===================================
  Download Summary
===================================
  SFW: flux1-dev-kontext_fp8_scaled.safetensors
  NSFW: ${CIVITAI_NSFW_URL ? "(downloaded from Civitai)" : "(skipped — set CIVITAI_NSFW_MODEL_URL)"}
  T5: t5xxl_fp8_e4m3fn_scaled.safetensors
  CLIP: clip_l.safetensors
  VAE: ae.safetensors

  Pod terminated. Network volume ready.

  Next: Set KONTEXT_NSFW_MODEL=<nsfw-filename> in .env.local
===================================
`);
  } catch (err) {
    console.error("\nDownload failed:", err.message || err);
    if (podId) {
      console.error(`\nPod ${podId} is still running! Either:`);
      console.error(`  1. SSH in to complete downloads manually`);
      console.error(`  2. Terminate via: runpodctl remove pod ${podId}`);
      console.error(`  3. Terminate from RunPod dashboard`);
    }
    process.exit(1);
  }
}

main();
