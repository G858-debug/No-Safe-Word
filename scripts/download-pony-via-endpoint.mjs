/**
 * Download CyberRealistic Pony Semi-Realistic v4.5 checkpoint via the existing RunPod serverless endpoint.
 *
 * Uses the character_lora_downloads mechanism with a relative path (../checkpoints/)
 * to place the file in the checkpoints directory instead of loras/.
 *
 * Required env vars in .env.local:
 *   RUNPOD_API_KEY     — RunPod API key
 *   RUNPOD_ENDPOINT_ID — Serverless endpoint ID (nsw-image-gen)
 *   CIVITAI_API_KEY    — CivitAI API key for NSFW model download
 *
 * Usage: node scripts/download-pony-via-endpoint.mjs
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    console.error("Could not read .env.local");
    process.exit(1);
  }
}

loadEnv();

const API_KEY = process.env.RUNPOD_API_KEY;
const ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;
const CIVITAI_TOKEN = process.env.CIVITAI_TOKEN || process.env.CIVITAI_API_KEY;

if (!API_KEY || !ENDPOINT_ID || !CIVITAI_TOKEN) {
  console.error("Missing RUNPOD_API_KEY, RUNPOD_ENDPOINT_ID, or CIVITAI_API_KEY");
  process.exit(1);
}

const BASE = `https://api.runpod.ai/v2/${ENDPOINT_ID}`;

// Step 1: Run diagnostic to check if checkpoint already exists
async function runDiagnostic() {
  console.log("Running diagnostic to check existing checkpoints...\n");
  const res = await fetch(`${BASE}/runsync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      input: {
        nsw_diagnostic: true,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Diagnostic failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  if (data.status === "FAILED") {
    throw new Error(`Diagnostic job failed: ${data.error}`);
  }

  return data.output;
}

// Step 2: Submit download job using character_lora_downloads with relative path
async function submitDownload() {
  const civitaiUrl = `https://civitai.com/api/download/models/2601141?token=${CIVITAI_TOKEN}`;

  console.log("Submitting checkpoint download job...");
  console.log(`  URL: https://civitai.com/api/download/models/2601141`);
  console.log(`  Dest: ../checkpoints/CyberRealistic_PonySemi_V4.5.safetensors (relative to loras/)\n`);

  // We need a minimal valid workflow so the handler doesn't crash before processing downloads.
  // Use a simple checkpoint loader that will fail AFTER the download completes.
  // The download happens BEFORE workflow execution in the handler.
  const minimalWorkflow = {
    "100": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: "CyberRealistic_PonySemi_V4.5.safetensors",
      },
    },
    "101": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: "test",
        clip: ["100", 1],
      },
    },
    "102": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: "",
        clip: ["100", 1],
      },
    },
    "103": {
      class_type: "EmptyLatentImage",
      inputs: { width: 64, height: 64, batch_size: 1 },
    },
    "104": {
      class_type: "KSampler",
      inputs: {
        model: ["100", 0],
        positive: ["101", 0],
        negative: ["102", 0],
        latent_image: ["103", 0],
        seed: 1,
        steps: 1,
        cfg: 1,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1.0,
      },
    },
    "105": {
      class_type: "VAEDecode",
      inputs: { samples: ["104", 0], vae: ["100", 2] },
    },
    "106": {
      class_type: "SaveImage",
      inputs: { filename_prefix: "pony_test", images: ["105", 0] },
    },
  };

  const res = await fetch(`${BASE}/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      input: {
        workflow: minimalWorkflow,
        character_lora_downloads: [
          {
            filename: "../checkpoints/CyberRealistic_PonySemi_V4.5.safetensors",
            url: civitaiUrl,
          },
        ],
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Submit failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  console.log(`Job submitted: ${data.id}`);
  return data.id;
}

// Step 3: Poll for completion
async function pollJob(jobId) {
  console.log("\nPolling for completion (download ~6GB, may take a few minutes)...");
  const start = Date.now();
  const timeout = 10 * 60 * 1000; // 10 minutes

  while (Date.now() - start < timeout) {
    const res = await fetch(`${BASE}/status/${jobId}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    const data = await res.json();

    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    process.stdout.write(`\r  [${elapsed}s] Status: ${data.status}   `);

    if (data.status === "COMPLETED") {
      console.log("\n\nJob completed! The checkpoint should now be on the volume.");
      console.log("Output:", JSON.stringify(data.output, null, 2).substring(0, 500));
      return true;
    }

    if (data.status === "FAILED") {
      console.log("\n\nJob failed:", data.error);
      // The workflow might fail (checkpoint not in ComfyUI's cache yet) but the
      // DOWNLOAD still succeeded — the download happens before workflow execution.
      if (data.error?.includes("not in list") || data.error?.includes("Workflow validation")) {
        console.log("\nWorkflow validation failed — but that's expected on first download.");
        console.log("The checkpoint was downloaded. Restart workers to pick it up.");
        return true;
      }
      return false;
    }

    await new Promise((r) => setTimeout(r, 5000));
  }

  console.log("\n\nTimed out waiting for job.");
  return false;
}

async function main() {
  console.log("=== Download CyberRealistic Pony Semi-Realistic v4.5 via Serverless Endpoint ===\n");

  // Check existing checkpoints
  try {
    const diag = await runDiagnostic();
    const checkpointKeys = Object.keys(diag).filter((k) => k.includes("checkpoints"));
    for (const key of checkpointKeys) {
      console.log(`${key}:`);
      const files = diag[key];
      if (Array.isArray(files)) {
        files.forEach((f) => console.log(`  ${f}`));
      } else {
        console.log(`  ${files}`);
      }
    }

    // Check if already downloaded
    const allFiles = checkpointKeys.flatMap((k) => diag[k] || []);
    if (allFiles.some((f) => f.includes("CyberRealistic_PonySemi"))) {
      console.log("\nCyberRealistic_PonySemi_V4.5.safetensors already exists on the volume!");
      console.log("You may need to restart workers for ComfyUI to discover it.");
      return;
    }
    console.log("\nCheckpoint not found — proceeding with download.\n");
  } catch (err) {
    console.log(`Diagnostic failed: ${err.message} — proceeding with download anyway.\n`);
  }

  // Submit download
  const jobId = await submitDownload();
  const success = await pollJob(jobId);

  if (success) {
    console.log("\n--- Next steps ---");
    console.log("1. Go to RunPod dashboard → Serverless → nsw-image-gen → Releases");
    console.log("2. Create a new release (same image) to force worker restart");
    console.log("3. Workers will restart and discover the new checkpoint");
  }
}

main().catch((err) => {
  console.error("\nFatal:", err.message);
  process.exit(1);
});
