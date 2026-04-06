/**
 * Download Juggernaut Ragnarok models to RunPod network volume via the serverless endpoint.
 *
 * Uses the character_lora_downloads mechanism with relative paths to place files
 * in the correct directories on the network volume.
 *
 * Models:
 * 1. Juggernaut-Ragnarok.safetensors (inference checkpoint)
 * 2. sd_xl_base_1.0.safetensors (training base)
 * 3. 4xNMKD-Siax_200k.pth (upscaler)
 *
 * Required env vars in .env.local:
 *   RUNPOD_API_KEY     — RunPod API key
 *   RUNPOD_ENDPOINT_ID — Serverless endpoint ID
 *
 * Usage:
 *   node scripts/download-models-to-runpod.mjs
 *   node scripts/download-models-to-runpod.mjs --skip-ragnarok  (skip the 6.5GB inference checkpoint)
 *   node scripts/download-models-to-runpod.mjs --only-upscaler  (only download the 67MB upscaler)
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

if (!API_KEY || !ENDPOINT_ID) {
  console.error("Missing RUNPOD_API_KEY or RUNPOD_ENDPOINT_ID in .env.local");
  process.exit(1);
}

const BASE = `https://api.runpod.ai/v2/${ENDPOINT_ID}`;
const SKIP_RAGNAROK = process.argv.includes("--skip-ragnarok");
const ONLY_UPSCALER = process.argv.includes("--only-upscaler");

// Models to download — filename is relative to ComfyUI loras/ dir
const MODELS = [];

if (!ONLY_UPSCALER) {
  if (!SKIP_RAGNAROK) {
    MODELS.push({
      name: "Juggernaut XL Ragnarok (inference)",
      filename: "../checkpoints/Juggernaut-Ragnarok.safetensors",
      url: "https://huggingface.co/RunDiffusion/Juggernaut-XL-v9/resolve/main/Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors",
      sizeApprox: "6.5GB",
    });
  }

  MODELS.push({
    name: "SDXL 1.0 Base (training)",
    filename: "../checkpoints/sd_xl_base_1.0.safetensors",
    url: "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors",
    sizeApprox: "6.9GB",
  });
}

MODELS.push({
  name: "4x NMKD Siax Upscaler",
  filename: "../upscale_models/4x_NMKD-Siax_200k.pth",
  url: "https://huggingface.co/gemasai/4x_NMKD-Siax_200k/resolve/main/4x_NMKD-Siax_200k.pth",
  sizeApprox: "67MB",
});

// Body shape slider LoRAs — female portraits + dataset generation
const CIVITAI_TOKEN = process.env.CIVITAI_TOKEN || process.env.CIVITAI_API_KEY || "";

MODELS.push({
  name: "Body Weight Slider ILXL",
  filename: "Body_weight_slider_ILXL.safetensors",
  url: `https://civitai.com/api/download/models/1523317${CIVITAI_TOKEN ? `?token=${CIVITAI_TOKEN}` : ""}`,
  sizeApprox: "8MB",
});

MODELS.push({
  name: "Bubble Butt Slider",
  filename: "Bubble Butt_alpha1.0_rank4_noxattn_last.safetensors",
  url: `https://civitai.com/api/download/models/533085${CIVITAI_TOKEN ? `?token=${CIVITAI_TOKEN}` : ""}`,
  sizeApprox: "8MB",
});

MODELS.push({
  name: "Breast Size Slider SDXL",
  filename: "Breast Slider - SDXL_alpha1.0_rank4_noxattn_last.safetensors",
  url: `https://civitai.com/api/download/models/535064${CIVITAI_TOKEN ? `?token=${CIVITAI_TOKEN}` : ""}`,
  sizeApprox: "8MB",
});

// Minimal workflow that uses the checkpoint — even if it fails, the download happens first
function buildMinimalWorkflow(checkpointName) {
  return {
    "100": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: checkpointName },
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
        seed: 1, steps: 1, cfg: 1,
        sampler_name: "euler", scheduler: "normal", denoise: 1.0,
      },
    },
    "105": {
      class_type: "VAEDecode",
      inputs: { samples: ["104", 0], vae: ["100", 2] },
    },
    "106": {
      class_type: "SaveImage",
      inputs: { filename_prefix: "dl_test", images: ["105", 0] },
    },
  };
}

async function submitDownload(model) {
  console.log(`\nSubmitting download: ${model.name} (${model.sizeApprox})`);
  console.log(`  URL: ${model.url.substring(0, 80)}...`);
  console.log(`  Dest: ${model.filename}`);

  const res = await fetch(`${BASE}/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      input: {
        workflow: buildMinimalWorkflow("Juggernaut-Ragnarok.safetensors"),
        character_lora_downloads: [
          { filename: model.filename, url: model.url },
        ],
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Submit failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  console.log(`  Job: ${data.id}`);
  return data.id;
}

async function pollJob(jobId, timeoutMs = 15 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${BASE}/status/${jobId}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    const data = await res.json();
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    process.stdout.write(`\r  [${elapsed}s] ${data.status}   `);

    if (data.status === "COMPLETED") {
      console.log(" -- done");
      return true;
    }
    if (data.status === "FAILED") {
      console.log("");
      // Download happens before workflow — a workflow failure is OK
      if (data.error?.includes("not in list") || data.error?.includes("Workflow")) {
        console.log("  Workflow failed (expected on first download) — file was still downloaded.");
        return true;
      }
      console.log(`  FAILED: ${data.error}`);
      return false;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log("\n  Timed out.");
  return false;
}

async function main() {
  console.log("=== Download Models to RunPod Network Volume ===");
  console.log(`Endpoint: ${ENDPOINT_ID}`);
  console.log(`Models to download: ${MODELS.length}\n`);

  for (const model of MODELS) {
    const jobId = await submitDownload(model);
    const ok = await pollJob(jobId);
    if (!ok) {
      console.error(`\nFailed to download ${model.name}. Continuing with next...`);
    }
  }

  console.log("\n=== All downloads submitted ===");
  console.log("If this is the first time downloading, restart the serverless workers");
  console.log("so ComfyUI discovers the new checkpoints.");
}

main().catch((err) => {
  console.error("\nFatal:", err.message);
  process.exit(1);
});
