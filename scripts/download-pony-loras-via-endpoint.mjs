/**
 * Download all 6 Pony LoRAs to the RunPod network volume via the serverless endpoint.
 *
 * Uses the character_lora_downloads mechanism with a relative path traversal
 * to write directly to /runpod-volume/models/loras/ (persistent storage).
 *
 * Required env vars in .env.local:
 *   RUNPOD_API_KEY     — RunPod API key
 *   RUNPOD_ENDPOINT_ID — Serverless endpoint ID
 *   CIVITAI_API_KEY    — CivitAI API key
 *
 * Usage: node scripts/download-pony-loras-via-endpoint.mjs
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

// Path traversal: /comfyui/models/loras/../../../ = /
// So ../../../runpod-volume/models/loras/X.safetensors = /runpod-volume/models/loras/X.safetensors
const VOLUME_PREFIX = "../../../runpod-volume/models/loras/";

const PONY_LORAS = [
  { versionId: "595483", filename: "pony-ebony-skin.safetensors", name: "Ebony Pony" },
  { versionId: "1106176", filename: "pony-skin-tone-slider.safetensors", name: "Skin Tone Slider" },
  { versionId: "928762", filename: "pony-hourglass-body.safetensors", name: "Hourglass Body" },
  { versionId: "1987668", filename: "perfect-breasts-v2.safetensors", name: "Perfect Breasts v2" },
  { versionId: "2074888", filename: "pony-realism-stable-yogi.safetensors", name: "Realism Stable Yogi" },
  { versionId: "712947", filename: "pony-detail-slider.safetensors", name: "Detail Slider" },
];

// Minimal valid ComfyUI workflow (tiny 64x64 image, 1 step) so the handler doesn't crash
const MINIMAL_WORKFLOW = {
  "100": {
    class_type: "CheckpointLoaderSimple",
    inputs: { ckpt_name: "CyberRealistic_PonySemi_V4.5.safetensors" },
  },
  "101": {
    class_type: "CLIPTextEncode",
    inputs: { text: "test", clip: ["100", 1] },
  },
  "102": {
    class_type: "CLIPTextEncode",
    inputs: { text: "", clip: ["100", 1] },
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
    inputs: { filename_prefix: "pony_lora_test", images: ["105", 0] },
  },
};

async function submitDownloadJob() {
  const downloads = PONY_LORAS.map((lora) => ({
    filename: `${VOLUME_PREFIX}${lora.filename}`,
    url: `https://civitai.com/api/download/models/${lora.versionId}?token=${CIVITAI_TOKEN}`,
  }));

  console.log("Submitting download job for 6 Pony LoRAs...");
  PONY_LORAS.forEach((l) => console.log(`  - ${l.name} → ${l.filename}`));
  console.log();

  const res = await fetch(`${BASE}/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      input: {
        workflow: MINIMAL_WORKFLOW,
        character_lora_downloads: downloads,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Submit failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  console.log(`Job submitted: ${data.id}\n`);
  return data.id;
}

async function pollJob(jobId) {
  console.log("Polling for completion (6 downloads, may take a few minutes)...");
  const start = Date.now();
  const timeout = 15 * 60 * 1000; // 15 minutes

  while (Date.now() - start < timeout) {
    const res = await fetch(`${BASE}/status/${jobId}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    const data = await res.json();

    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    process.stdout.write(`\r  [${elapsed}s] Status: ${data.status}   `);

    if (data.status === "COMPLETED") {
      console.log("\n\nJob completed!");
      return true;
    }

    if (data.status === "FAILED") {
      console.log(`\n\nJob failed: ${data.error}`);
      // The workflow might fail but downloads happen BEFORE workflow execution
      if (
        data.error?.includes("not in list") ||
        data.error?.includes("Workflow validation") ||
        data.error?.includes("prompt")
      ) {
        console.log("Workflow failed but downloads likely succeeded (they run before workflow).");
        return true;
      }
      return false;
    }

    await new Promise((r) => setTimeout(r, 5000));
  }

  console.log("\n\nTimed out.");
  return false;
}

async function verifyWithDiagnostic() {
  console.log("\nVerifying with diagnostic...");
  const res = await fetch(`${BASE}/runsync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ input: { nsw_diagnostic: true } }),
  });

  if (!res.ok) {
    console.log("Diagnostic request failed — check manually.");
    return;
  }

  const data = await res.json();
  if (data.status === "FAILED") {
    console.log("Diagnostic failed — check manually.");
    return;
  }

  const volumeLoras = data.output?.["/runpod-volume/models/loras"];
  if (!Array.isArray(volumeLoras)) {
    console.log("Could not read volume loras listing.");
    return;
  }

  const fileNames = volumeLoras.map((f) => f.split(" ")[0]);

  console.log("\n=== Pony LoRA Verification ===");
  let allPresent = true;
  for (const lora of PONY_LORAS) {
    const found = fileNames.includes(lora.filename);
    const sizeInfo = volumeLoras.find((f) => f.startsWith(lora.filename));
    console.log(`  ${found ? "OK" : "MISSING"}  ${lora.filename}${found ? ` — ${sizeInfo?.split("(")[1]?.replace(")", "") || ""}` : ""}`);
    if (!found) allPresent = false;
  }

  if (allPresent) {
    console.log("\nAll 6 Pony LoRAs are on the network volume! Workers are ready.");
  } else {
    console.log("\nSome LoRAs are still missing. Check RunPod logs for download errors.");
  }
}

async function main() {
  console.log("=== Download Pony LoRAs via Serverless Endpoint ===\n");

  const jobId = await submitDownloadJob();
  const success = await pollJob(jobId);

  if (success) {
    await verifyWithDiagnostic();
  }
}

main().catch((err) => {
  console.error("\nFatal:", err.message);
  process.exit(1);
});
