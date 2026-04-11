/**
 * ControlNet OpenPose integration test.
 *
 * Submits two identical two-character jobs to RunPod:
 *   1. WITH ControlNet pose conditioning (kissing-standing skeleton)
 *   2. WITHOUT ControlNet (baseline comparison)
 *
 * Saves both output images locally for side-by-side comparison.
 *
 * Usage: npx tsx --env-file=apps/web/.env.local scripts/test-controlnet.ts
 */

import { buildWorkflow } from "@no-safe-word/image-gen";
import {
  submitRunPodJob,
  getRunPodJobStatus,
  base64ToBuffer,
} from "@no-safe-word/image-gen";
import { getPoseById, renderPose } from "../packages/image-gen/src/controlnet";
import * as fs from "fs";
import * as path from "path";

const OUTPUT_DIR = "/tmp/controlnet-test";

// ── Character LoRAs (same registry as iterate-image.ts) ──

const CHARACTER_LORAS: Record<
  string,
  { filename: string; url: string; triggerWord: string }
> = {
  thabo: {
    filename: "characters/lora_thabo_nkosi_nsw.safetensors",
    url: "https://mqemiteirxwscxtamdtj.supabase.co/storage/v1/object/public/lora-training-datasets/trained/characters/lora_thabo_nkosi_nsw_1775678623117.safetensors",
    triggerWord: "thabo_nkosi_nsw",
  },
  naledi: {
    filename: "characters/lora_naledi_dlamini_nsw.safetensors",
    url: "https://mqemiteirxwscxtamdtj.supabase.co/storage/v1/object/public/lora-training-datasets/trained/characters/lora_naledi_dlamini_nsw_1775697205367.safetensors",
    triggerWord: "naledi_dlamini_nsw",
  },
};

// ── Test prompt (same for both jobs) ──

const PROMPT =
  "photograph, high resolution, cinematic, skin textures, detailed, " +
  "thabo_nkosi_nsw, naledi_dlamini_nsw, 1boy 1girl, " +
  "passionate kiss outside shebeen at night, couple pressed together, " +
  "his hand cupping her face, her hands gripping his shirt, " +
  "single amber streetlight overhead, Middelburg township, " +
  "medium shot, warm amber light";

const NEGATIVE =
  "bad anatomy, bad hands, extra limbs, extra fingers, mutated hands, " +
  "watermark, blurry, text, cartoon, illustration, painting, " +
  "low quality, worst quality, deformed";

const WIDTH = 1216;
const HEIGHT = 832;
const CFG = 4.5;
const STEPS = 35;

// ── Helpers ──

function buildLoraStack(characters: string[]) {
  return characters.map((key) => ({
    filename: CHARACTER_LORAS[key].filename,
    strengthModel: 0.6,
    strengthClip: 0.35,
  }));
}

function buildLoraDownloads(characters: string[]) {
  return characters.map((key) => ({
    filename: CHARACTER_LORAS[key].filename,
    url: CHARACTER_LORAS[key].url,
  }));
}

async function submitAndPoll(
  label: string,
  workflow: Record<string, any>,
  images?: Array<{ name: string; image: string }>,
): Promise<string | null> {
  const loraDownloads = buildLoraDownloads(["thabo", "naledi"]);

  console.log(`\n── ${label} ──`);
  const { jobId } = await submitRunPodJob(
    workflow,
    images && images.length > 0 ? images : undefined,
    loraDownloads,
  );
  console.log(`   Submitted: ${jobId}`);
  if (images && images.length > 0) {
    for (const img of images) {
      console.log(
        `   Image payload: "${img.name}" (${(img.image.length / 1024).toFixed(0)} KB base64)`,
      );
    }
  }

  // Poll for result (max 5 minutes)
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const status = await getRunPodJobStatus(jobId);

    if (status.status === "COMPLETED" && status.output?.images?.[0]) {
      const imageData = status.output.images[0].data;
      const base64Data = imageData.includes(",")
        ? imageData.split(",")[1]
        : imageData;
      const buffer = base64ToBuffer(base64Data);

      const filename = `${label.replace(/[^a-zA-Z0-9]/g, "_")}.png`;
      const filepath = path.join(OUTPUT_DIR, filename);
      fs.writeFileSync(filepath, buffer);
      console.log(`   ✓ Saved: ${filepath} (${(buffer.length / 1024).toFixed(0)} KB)`);
      return filepath;
    }

    if (status.status === "FAILED") {
      console.error(`   ✗ FAILED: ${status.error}`);
      return null;
    }

    if ((i + 1) % 6 === 0) {
      console.log(`   ... polling (${(i + 1) * 5}s, status=${status.status})`);
    }
  }

  console.error(`   ✗ Timed out after 5 minutes`);
  return null;
}

// ── Main ──

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const seed = Math.floor(Math.random() * 2_147_483_647) + 1;
  console.log(`=== ControlNet OpenPose Integration Test ===`);
  console.log(`Seed: ${seed}`);
  console.log(`Output: ${OUTPUT_DIR}/\n`);

  const loras = buildLoraStack(["thabo", "naledi"]);

  // ── Job 1: WITH ControlNet ──

  const pose = getPoseById("kissing-standing")!;
  const { buffer: posePng } = await renderPose(pose, WIDTH, HEIGHT);
  const poseImageName = "pose_kissing-standing.png";

  const workflowWithCN = buildWorkflow({
    positivePrompt: PROMPT,
    negativePrompt: NEGATIVE,
    width: WIDTH,
    height: HEIGHT,
    seed,
    cfg: CFG,
    steps: STEPS,
    filenamePrefix: "cn_test_with",
    loras,
    controlNet: { poseImageName, strength: 0.5 },
  });

  const poseImages = [
    { name: poseImageName, image: posePng.toString("base64") },
  ];

  const withCN = await submitAndPoll(
    "WITH_ControlNet",
    workflowWithCN,
    poseImages,
  );

  // ── Job 2: WITHOUT ControlNet (same seed, same prompt) ──

  const workflowNoCN = buildWorkflow({
    positivePrompt: PROMPT,
    negativePrompt: NEGATIVE,
    width: WIDTH,
    height: HEIGHT,
    seed,
    cfg: CFG,
    steps: STEPS,
    filenamePrefix: "cn_test_without",
    loras,
  });

  const noCN = await submitAndPoll("WITHOUT_ControlNet", workflowNoCN);

  // ── Summary ──
  console.log(`\n=== Results ===`);
  console.log(`WITH ControlNet:    ${withCN ?? "FAILED"}`);
  console.log(`WITHOUT ControlNet: ${noCN ?? "FAILED"}`);

  if (withCN && noCN) {
    console.log(`\nCompare side-by-side: open ${OUTPUT_DIR}/`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
