/**
 * No Safe Word — Flux 2 Dev ControlNet + Character Consistency Test
 * ==================================================================
 * Tests Alibaba's FLUX.2-dev-Fun-ControlNet-Union for pose-controlled
 * image generation with Flux 2 Dev on RunPod, using reference images
 * for character consistency.
 *
 * Three phases:
 *   1. Generate reference portraits for Thabo (male) and Naledi (female)
 *   2. Composite references into a single tile image
 *   3. Run explicit couple tests with chained ControlNet:
 *      - Reference composite (tile mode, low strength) → appearance
 *      - Pose skeleton (pose mode, variable strength) → positioning
 *
 * Prerequisites:
 *   - comfyui-flux2fun-controlnet custom node installed on RunPod
 *   - FLUX.2-dev-Fun-Controlnet-Union-2602.safetensors on network volume
 *
 * Usage:
 *   npx tsx scripts/test-flux2-controlnet.ts
 *
 * Output:
 *   ./flux2_controlnet_results/          — generated images + pose PNGs
 *   ./flux2_controlnet_results/report.html  — visual report
 */

import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";
import {
  submitRunPodJob,
  waitForRunPodResult,
  base64ToBuffer,
} from "@no-safe-word/image-gen";
import {
  getPoseById,
  renderPose,
} from "../packages/image-gen/src/controlnet";

// ── Load .env.local ──
const envPath = path.resolve(__dirname, "../.env.local");
const envLines = fs.readFileSync(envPath, "utf8").split("\n");
for (const line of envLines) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────
const OUTPUT_DIR = "./flux2_controlnet_results";
const WIDTH = 832;
const HEIGHT = 1216;
const STEPS = 28;
const CFG = 3.5;
const SAMPLER = "euler";
const REF_STRENGTH = 0.35; // ControlNet strength for reference tile

// Flux 2 Dev model files on RunPod volume
const UNET = "flux2-dev-fp8_scaled.safetensors";
const TEXT_ENCODER = "mistral_3_small_flux2_fp8.safetensors";
const VAE = "flux2-vae.safetensors";
const CONTROLNET_MODEL = "FLUX.2-dev-Fun-Controlnet-Union-2602.safetensors";

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
interface TestCase {
  id: string;
  name: string;
  poseId: string;
  poseStrength: number | null; // null = no pose ControlNet
  useReference: boolean;
  prompt: string;
}

interface TestResult {
  id: string;
  name: string;
  poseId: string;
  poseStrength: number | null;
  useReference: boolean;
  prompt: string;
  success: boolean;
  error: string | null;
  executionTime: number;
  filename: string;
  poseFilename: string | null;
}

// ─────────────────────────────────────────────
// CHARACTER DESCRIPTIONS
// ─────────────────────────────────────────────

const THABO = {
  name: "Thabo",
  physicalShort: "dark-skinned, muscular build, clean-shaven, strong jawline",
  portrait:
    "A handsome Black South African man, age 28. Dark brown skin, clean-shaven, " +
    "strong angular jawline, short-cropped black hair with a subtle fade. " +
    "Muscular build with broad shoulders, thick neck, and powerful arms. " +
    "He wears a fitted charcoal henley shirt, top two buttons undone. " +
    "Warm confident expression, slight knowing smile, looking directly at " +
    "the camera. Standing in front of a mechanic workshop in Middelburg, " +
    "golden hour sunlight catching the contours of his face. " +
    "Three-quarter portrait shot, shallow depth of field. Photorealistic, " +
    "editorial photography.",
};

const NALEDI = {
  name: "Naledi",
  body:
    "extremely voluptuous body with very large heavy breasts, deep cleavage, " +
    "tiny narrow waist, very wide hips, and a large round protruding backside",
  physicalShort:
    "medium-brown skin, long black braids, voluptuous figure",
  portrait:
    "A stunning Black South African woman, age 25. Medium-brown skin, long " +
    "black braids falling past her shoulders, warm brown eyes, full lips. " +
    "Extremely voluptuous body with very large heavy breasts, tiny narrow " +
    "waist, very wide hips. She wears a form-fitting deep burgundy wrap " +
    "dress showing generous cleavage, gold stud earrings. Confident " +
    "seductive expression, looking directly at the camera with a playful " +
    "half-smile. Standing at a township street corner in Middelburg, " +
    "golden hour sunlight warming her skin. Three-quarter portrait shot, " +
    "shallow depth of field. Photorealistic, editorial photography.",
};

// ─────────────────────────────────────────────
// POSE-SPECIFIC PROMPTS (using consistent character descriptions)
// ─────────────────────────────────────────────
const PROMPTS: Record<string, string> = {
  missionary:
    "A Black South African couple having sex in a dimly lit bedroom. " +
    `She is Naledi, 25, ${NALEDI.physicalShort}, ${NALEDI.body}, ` +
    "lying on her back on deep red sheets with her legs spread apart and " +
    `wrapped around him. He is Thabo, 28, ${THABO.physicalShort}, ` +
    "positioned between her thighs on top of her, his penis penetrating " +
    "her vagina. Both completely naked, bodies intertwined. Her very large " +
    "breasts pressed against his chest, her face showing ecstasy, his " +
    "expression intense. Warm amber candlelight. Medium shot, shallow " +
    "depth of field. Explicit erotic photography, photorealistic.",

  cowgirl:
    "A Black South African couple having sex in a dimly lit bedroom. " +
    `She is Naledi, 25, ${NALEDI.physicalShort}, ${NALEDI.body}, ` +
    "sitting upright on top of him straddling his hips, riding him in " +
    `cowgirl position. He is Thabo, 28, ${THABO.physicalShort}, lying ` +
    "on his back on deep red sheets, hands on her wide hips. Both " +
    "completely naked. Her very large bare breasts visible, bouncing, her " +
    "face showing pleasure, his expression intense looking up at her. " +
    "Warm amber candlelight. Medium shot, shallow depth of field. " +
    "Explicit erotic photography, photorealistic.",

  "from-behind":
    "A Black South African couple having sex in a dimly lit bedroom. " +
    `She is Naledi, 25, ${NALEDI.physicalShort}, ${NALEDI.body}, ` +
    "on all fours on deep red sheets, her large round backside raised. " +
    `He is Thabo, 28, ${THABO.physicalShort}, kneeling upright behind ` +
    "her, hands gripping her wide hips, penetrating her from behind in " +
    "doggy position. Both completely naked. She looks back over her " +
    "shoulder with pleasure. Warm amber candlelight. Medium shot, " +
    "shallow depth of field. Explicit erotic photography, photorealistic.",

  "standing-lift":
    "A Black South African couple having sex standing up in a dimly lit " +
    `bedroom. She is Naledi, 25, ${NALEDI.physicalShort}, ${NALEDI.body}. ` +
    `He is Thabo, 28, ${THABO.physicalShort}, standing and holding her ` +
    "up. She has her legs wrapped around his waist, arms around his neck, " +
    "face to face. Both completely naked, his penis inside her. Her very " +
    "large breasts pressed against his chest, both faces showing intense " +
    "pleasure. Warm amber candlelight. Full body shot, shallow depth of " +
    "field. Explicit erotic photography, photorealistic.",
};

// ─────────────────────────────────────────────
// TEST MATRIX
// ─────────────────────────────────────────────
const TESTS: TestCase[] = [
  // Baseline — no ControlNet, no reference
  {
    id: "01_baseline",
    name: "Baseline (no ControlNet, no ref)",
    poseId: "missionary",
    poseStrength: null,
    useReference: false,
    prompt: PROMPTS.missionary,
  },
  // Reference only — no pose (tile reference but no skeleton)
  {
    id: "02_ref_only",
    name: "Reference only (no pose CN)",
    poseId: "missionary",
    poseStrength: null,
    useReference: true,
    prompt: PROMPTS.missionary,
  },
  // Strength sweep: pose + reference
  {
    id: "03_missionary_s040",
    name: "Missionary — pose 0.40 + ref",
    poseId: "missionary",
    poseStrength: 0.4,
    useReference: true,
    prompt: PROMPTS.missionary,
  },
  {
    id: "04_missionary_s060",
    name: "Missionary — pose 0.60 + ref",
    poseId: "missionary",
    poseStrength: 0.6,
    useReference: true,
    prompt: PROMPTS.missionary,
  },
  {
    id: "05_missionary_s070",
    name: "Missionary — pose 0.70 + ref",
    poseId: "missionary",
    poseStrength: 0.7,
    useReference: true,
    prompt: PROMPTS.missionary,
  },
  {
    id: "06_missionary_s080",
    name: "Missionary — pose 0.80 + ref",
    poseId: "missionary",
    poseStrength: 0.8,
    useReference: true,
    prompt: PROMPTS.missionary,
  },
  // Pose variety at 0.70 + reference
  {
    id: "07_cowgirl_s070",
    name: "Cowgirl — pose 0.70 + ref",
    poseId: "cowgirl",
    poseStrength: 0.7,
    useReference: true,
    prompt: PROMPTS.cowgirl,
  },
  {
    id: "08_from_behind_s070",
    name: "From Behind — pose 0.70 + ref",
    poseId: "from-behind",
    poseStrength: 0.7,
    useReference: true,
    prompt: PROMPTS["from-behind"],
  },
  {
    id: "09_standing_lift_s070",
    name: "Standing Lift — pose 0.70 + ref",
    poseId: "standing-lift",
    poseStrength: 0.7,
    useReference: true,
    prompt: PROMPTS["standing-lift"],
  },
  // Pose only (no reference) for comparison
  {
    id: "10_missionary_s070_noref",
    name: "Missionary — pose 0.70 NO ref",
    poseId: "missionary",
    poseStrength: 0.7,
    useReference: false,
    prompt: PROMPTS.missionary,
  },
];

// ─────────────────────────────────────────────
// WORKFLOW BUILDERS
// ─────────────────────────────────────────────

/**
 * Baseline — NO ControlNet at all.
 * CLIPTextEncode → FluxGuidance → BasicGuider
 */
function buildBaselineWorkflow(
  prompt: string,
  seed: number,
): Record<string, any> {
  return {
    "1": {
      class_type: "UNETLoader",
      inputs: { unet_name: UNET, weight_dtype: "fp8_e4m3fn" },
    },
    "2": {
      class_type: "CLIPLoader",
      inputs: { clip_name: TEXT_ENCODER, type: "flux2" },
    },
    "3": {
      class_type: "VAELoader",
      inputs: { vae_name: VAE },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt, clip: ["2", 0] },
    },
    "5": {
      class_type: "FluxGuidance",
      inputs: { conditioning: ["4", 0], guidance: CFG },
    },
    "6": {
      class_type: "EmptyFlux2LatentImage",
      inputs: { width: WIDTH, height: HEIGHT, batch_size: 1 },
    },
    "7": {
      class_type: "RandomNoise",
      inputs: { noise_seed: seed },
    },
    "8": {
      class_type: "KSamplerSelect",
      inputs: { sampler_name: SAMPLER },
    },
    "9": {
      class_type: "BetaSamplingScheduler",
      inputs: { model: ["1", 0], steps: STEPS, alpha: 0.6, beta: 0.95 },
    },
    "10": {
      class_type: "BasicGuider",
      inputs: { model: ["1", 0], conditioning: ["5", 0] },
    },
    "11": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["7", 0],
        guider: ["10", 0],
        sampler: ["8", 0],
        sigmas: ["9", 0],
        latent_image: ["6", 0],
      },
    },
    "12": {
      class_type: "VAEDecode",
      inputs: { samples: ["11", 0], vae: ["3", 0] },
    },
    "13": {
      class_type: "SaveImage",
      inputs: { images: ["12", 0], filename_prefix: "flux2base" },
    },
  };
}

/**
 * Reference ONLY — one ControlNet apply with reference composite (tile mode).
 * CLIPTextEncode → CN(ref) → FluxGuidance → BasicGuider
 */
function buildRefOnlyWorkflow(
  prompt: string,
  seed: number,
  refImageName: string,
): Record<string, any> {
  return {
    "1": {
      class_type: "UNETLoader",
      inputs: { unet_name: UNET, weight_dtype: "fp8_e4m3fn" },
    },
    "2": {
      class_type: "CLIPLoader",
      inputs: { clip_name: TEXT_ENCODER, type: "flux2" },
    },
    "3": {
      class_type: "VAELoader",
      inputs: { vae_name: VAE },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt, clip: ["2", 0] },
    },
    // ControlNet model
    "20": {
      class_type: "Flux2FunControlNetLoader",
      inputs: { controlnet_name: CONTROLNET_MODEL },
    },
    // Reference composite image
    "30": {
      class_type: "LoadImage",
      inputs: { image: refImageName },
    },
    // Apply ControlNet with reference (tile mode — auto-detected from photo)
    "5": {
      class_type: "Flux2FunControlNetApply",
      inputs: {
        conditioning: ["4", 0],
        controlnet: ["20", 0],
        vae: ["3", 0],
        strength: REF_STRENGTH,
        control_image: ["30", 0],
      },
    },
    "6": {
      class_type: "FluxGuidance",
      inputs: { conditioning: ["5", 0], guidance: CFG },
    },
    "7": {
      class_type: "EmptyFlux2LatentImage",
      inputs: { width: WIDTH, height: HEIGHT, batch_size: 1 },
    },
    "8": {
      class_type: "RandomNoise",
      inputs: { noise_seed: seed },
    },
    "9": {
      class_type: "KSamplerSelect",
      inputs: { sampler_name: SAMPLER },
    },
    "10": {
      class_type: "BetaSamplingScheduler",
      inputs: { model: ["1", 0], steps: STEPS, alpha: 0.6, beta: 0.95 },
    },
    "11": {
      class_type: "BasicGuider",
      inputs: { model: ["1", 0], conditioning: ["6", 0] },
    },
    "12": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["8", 0],
        guider: ["11", 0],
        sampler: ["9", 0],
        sigmas: ["10", 0],
        latent_image: ["7", 0],
      },
    },
    "13": {
      class_type: "VAEDecode",
      inputs: { samples: ["12", 0], vae: ["3", 0] },
    },
    "14": {
      class_type: "SaveImage",
      inputs: { images: ["13", 0], filename_prefix: "flux2ref" },
    },
  };
}

/**
 * Pose ONLY — one ControlNet apply with skeleton (no reference).
 * CLIPTextEncode → CN(pose) → FluxGuidance → BasicGuider
 */
function buildPoseOnlyWorkflow(
  prompt: string,
  seed: number,
  poseImageName: string,
  poseStrength: number,
): Record<string, any> {
  return {
    "1": {
      class_type: "UNETLoader",
      inputs: { unet_name: UNET, weight_dtype: "fp8_e4m3fn" },
    },
    "2": {
      class_type: "CLIPLoader",
      inputs: { clip_name: TEXT_ENCODER, type: "flux2" },
    },
    "3": {
      class_type: "VAELoader",
      inputs: { vae_name: VAE },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt, clip: ["2", 0] },
    },
    "20": {
      class_type: "Flux2FunControlNetLoader",
      inputs: { controlnet_name: CONTROLNET_MODEL },
    },
    "21": {
      class_type: "LoadImage",
      inputs: { image: poseImageName },
    },
    "5": {
      class_type: "Flux2FunControlNetApply",
      inputs: {
        conditioning: ["4", 0],
        controlnet: ["20", 0],
        vae: ["3", 0],
        strength: poseStrength,
        control_image: ["21", 0],
      },
    },
    "6": {
      class_type: "FluxGuidance",
      inputs: { conditioning: ["5", 0], guidance: CFG },
    },
    "7": {
      class_type: "EmptyFlux2LatentImage",
      inputs: { width: WIDTH, height: HEIGHT, batch_size: 1 },
    },
    "8": {
      class_type: "RandomNoise",
      inputs: { noise_seed: seed },
    },
    "9": {
      class_type: "KSamplerSelect",
      inputs: { sampler_name: SAMPLER },
    },
    "10": {
      class_type: "BetaSamplingScheduler",
      inputs: { model: ["1", 0], steps: STEPS, alpha: 0.6, beta: 0.95 },
    },
    "11": {
      class_type: "BasicGuider",
      inputs: { model: ["1", 0], conditioning: ["6", 0] },
    },
    "12": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["8", 0],
        guider: ["11", 0],
        sampler: ["9", 0],
        sigmas: ["10", 0],
        latent_image: ["7", 0],
      },
    },
    "13": {
      class_type: "VAEDecode",
      inputs: { samples: ["12", 0], vae: ["3", 0] },
    },
    "14": {
      class_type: "SaveImage",
      inputs: { images: ["13", 0], filename_prefix: "flux2pose" },
    },
  };
}

/**
 * COMBINED — pose skeleton via control_image + reference via inpaint_image.
 * Single Flux2FunControlNetApply with both inputs:
 *   - control_image: pose skeleton (guides body positioning)
 *   - inpaint_image: reference composite (provides character appearance context)
 *
 * The ControlNet's internal architecture uses 260 channels:
 *   128 (control signal from control_image) + 4 (mask) + 128 (inpaint context)
 * This lets us pass both pose AND reference in a single apply, avoiding the
 * HooksContainer clone error that occurs when chaining two applies.
 */
function buildCombinedWorkflow(
  prompt: string,
  seed: number,
  refImageName: string,
  poseImageName: string,
  poseStrength: number,
): Record<string, any> {
  return {
    "1": {
      class_type: "UNETLoader",
      inputs: { unet_name: UNET, weight_dtype: "fp8_e4m3fn" },
    },
    "2": {
      class_type: "CLIPLoader",
      inputs: { clip_name: TEXT_ENCODER, type: "flux2" },
    },
    "3": {
      class_type: "VAELoader",
      inputs: { vae_name: VAE },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt, clip: ["2", 0] },
    },
    "20": {
      class_type: "Flux2FunControlNetLoader",
      inputs: { controlnet_name: CONTROLNET_MODEL },
    },
    // Pose skeleton image
    "21": {
      class_type: "LoadImage",
      inputs: { image: poseImageName },
    },
    // Reference composite image
    "30": {
      class_type: "LoadImage",
      inputs: { image: refImageName },
    },
    // Single apply: pose via control_image, reference via inpaint_image
    "5": {
      class_type: "Flux2FunControlNetApply",
      inputs: {
        conditioning: ["4", 0],
        controlnet: ["20", 0],
        vae: ["3", 0],
        strength: poseStrength,
        control_image: ["21", 0],      // pose skeleton
        inpaint_image: ["30", 0],      // reference composite (appearance context)
      },
    },
    "6": {
      class_type: "FluxGuidance",
      inputs: { conditioning: ["5", 0], guidance: CFG },
    },
    "7": {
      class_type: "EmptyFlux2LatentImage",
      inputs: { width: WIDTH, height: HEIGHT, batch_size: 1 },
    },
    "8": {
      class_type: "RandomNoise",
      inputs: { noise_seed: seed },
    },
    "9": {
      class_type: "KSamplerSelect",
      inputs: { sampler_name: SAMPLER },
    },
    "10": {
      class_type: "BetaSamplingScheduler",
      inputs: { model: ["1", 0], steps: STEPS, alpha: 0.6, beta: 0.95 },
    },
    "11": {
      class_type: "BasicGuider",
      inputs: { model: ["1", 0], conditioning: ["6", 0] },
    },
    "12": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["8", 0],
        guider: ["11", 0],
        sampler: ["9", 0],
        sigmas: ["10", 0],
        latent_image: ["7", 0],
      },
    },
    "13": {
      class_type: "VAEDecode",
      inputs: { samples: ["12", 0], vae: ["3", 0] },
    },
    "14": {
      class_type: "SaveImage",
      inputs: { images: ["13", 0], filename_prefix: "flux2chain" },
    },
  };
}

// ─────────────────────────────────────────────
// REFERENCE IMAGE HELPERS
// ─────────────────────────────────────────────

/**
 * Generate a portrait via Flux 2 Dev baseline workflow.
 * Returns the image as a Buffer.
 */
async function generatePortrait(
  name: string,
  prompt: string,
  seed: number,
): Promise<Buffer> {
  console.log(`\n── Generating ${name} portrait (seed ${seed}) ──`);
  const workflow = buildBaselineWorkflow(prompt, seed);
  const { jobId } = await submitRunPodJob(workflow);
  console.log(`   Job: ${jobId}`);
  const { imageBase64, executionTime } = await waitForRunPodResult(
    jobId,
    600_000,
    5_000,
  );
  const buffer = base64ToBuffer(imageBase64);
  console.log(
    `   \u2713 ${name} portrait generated (${(executionTime / 1000).toFixed(1)}s)`,
  );
  return buffer;
}

/**
 * Create a side-by-side composite of two portrait images.
 * Each portrait is resized to half-width and placed left/right.
 */
async function createComposite(
  leftBuffer: Buffer,
  rightBuffer: Buffer,
): Promise<Buffer> {
  const halfW = Math.floor(WIDTH / 2); // 416

  const left = await sharp(leftBuffer)
    .resize(halfW, HEIGHT, { fit: "cover" })
    .toBuffer();

  const right = await sharp(rightBuffer)
    .resize(halfW, HEIGHT, { fit: "cover" })
    .toBuffer();

  return sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite([
      { input: left, left: 0, top: 0 },
      { input: right, left: halfW, top: 0 },
    ])
    .png()
    .toBuffer();
}

// ─────────────────────────────────────────────
// POSE RENDERING
// ─────────────────────────────────────────────

const poseCache = new Map<string, { buffer: Buffer; filename: string }>();

async function getOrRenderPose(
  poseId: string,
): Promise<{ buffer: Buffer; filename: string }> {
  if (poseCache.has(poseId)) return poseCache.get(poseId)!;

  const pose = getPoseById(poseId);
  if (!pose) throw new Error(`Pose not found: ${poseId}`);

  const { buffer } = await renderPose(pose, WIDTH, HEIGHT);
  const filename = `pose_${poseId}.png`;

  fs.writeFileSync(path.join(OUTPUT_DIR, filename), buffer);
  poseCache.set(poseId, { buffer, filename });
  return { buffer, filename };
}

// ─────────────────────────────────────────────
// HTML REPORT GENERATOR
// ─────────────────────────────────────────────

function generateReport(
  results: TestResult[],
  refCompositeFilename: string,
  thaboFilename: string,
  nalediFilename: string,
): string {
  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  const now = new Date();
  const dateStr =
    now.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }) +
    ", " +
    now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  function makeCard(r: TestResult): string {
    const escapedName = r.name.replace(/"/g, "&quot;");
    const escapedPrompt = r.prompt.replace(/"/g, "&quot;").replace(/`/g, "");

    let imgTag: string;
    if (r.success) {
      imgTag = `<img src="${r.filename}" loading="lazy" onclick="openModal(this.src, \`${escapedName}\`, \`${escapedPrompt}\`)" />`;
    } else {
      imgTag = `<div class="filtered error">FAILED<br><span>${r.error || "Unknown error"}</span></div>`;
    }

    const parts: string[] = [];
    if (r.useReference) parts.push(`Ref ${REF_STRENGTH}`);
    if (r.poseStrength !== null) parts.push(`Pose ${r.poseStrength.toFixed(2)}`);
    const strengthLabel = parts.length > 0 ? parts.join(" + ") : "No CN";

    const badgeClass = r.success ? "pass" : "fail";
    const badgeText = r.success
      ? `\u2713 ${(r.executionTime / 1000).toFixed(1)}s`
      : "\u2717 FAILED";

    const refBadge = r.useReference
      ? `<span class="ref-badge">REF</span>`
      : "";

    const poseThumb = r.poseFilename
      ? `<div class="pose-thumb"><img src="${r.poseFilename}" alt="pose" /><span>${r.poseId}</span></div>`
      : `<div class="pose-thumb"><span class="no-pose">No pose</span></div>`;

    return `
        <div class="card">
            <div class="card-images">
                <div class="card-img">${imgTag}</div>
                ${poseThumb}
            </div>
            <div class="card-info">
                <div class="badges">
                    ${refBadge}
                    <span class="strength-badge">${strengthLabel}</span>
                    <span class="badge ${badgeClass}">${badgeText}</span>
                </div>
                <h3>${r.name}</h3>
                <p class="prompt">${r.prompt.slice(0, 120)}...</p>
            </div>
        </div>`;
  }

  const sweepTests = results.filter((r) => {
    const n = parseInt(r.id);
    return n >= 1 && n <= 6;
  });
  const varietyTests = results.filter((r) => {
    const n = parseInt(r.id);
    return n >= 7 && n <= 9;
  });
  const comparisonTests = results.filter((r) => parseInt(r.id) >= 10);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Flux 2 Dev \u2014 ControlNet + Character Consistency</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0a0607; --surface: #1a1012; --crimson: #8b1a2b;
    --crimson-light: #c4384f; --amber: #d4920a; --amber-light: #f5c542;
    --text: #e8ddd0; --text-muted: #8a7d72; --radius: 8px;
    --teal: #2d9e8f; --teal-light: #4fcfb8;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: var(--bg); color: var(--text); font-family: 'DM Sans', sans-serif; line-height: 1.6; }
  .header {
    text-align: center; padding: 60px 20px 40px;
    background: linear-gradient(180deg, #1a0a0e 0%, var(--bg) 100%);
    border-bottom: 1px solid rgba(139, 26, 43, 0.3);
  }
  .header h1 {
    font-family: 'Playfair Display', serif; font-size: 2.4rem; font-weight: 700;
    background: linear-gradient(135deg, var(--amber-light), var(--crimson-light));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 8px;
  }
  .header .subtitle { color: var(--text-muted); font-size: 1rem; margin-bottom: 24px; }
  .stats { display: flex; justify-content: center; gap: 40px; margin-top: 20px; }
  .stat { text-align: center; }
  .stat .number { font-family: 'Playfair Display', serif; font-size: 2rem; font-weight: 700; color: var(--amber-light); }
  .stat .label { font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; }
  .section { max-width: 1400px; margin: 0 auto; padding: 40px 20px; }
  .section h2 { font-family: 'Playfair Display', serif; font-size: 1.8rem; margin-bottom: 8px; color: var(--amber-light); }
  .section .section-desc { color: var(--text-muted); margin-bottom: 24px; font-size: 0.95rem; }
  .ref-section {
    display: flex; gap: 20px; justify-content: center; align-items: flex-start;
    flex-wrap: wrap; margin-bottom: 32px;
  }
  .ref-card {
    background: var(--surface); border-radius: var(--radius); overflow: hidden;
    border: 1px solid rgba(45, 158, 143, 0.3); width: 220px;
  }
  .ref-card img { width: 100%; aspect-ratio: 832/1216; object-fit: cover; }
  .ref-card .ref-label {
    padding: 10px; text-align: center; font-family: 'Playfair Display', serif;
    font-size: 1rem; color: var(--teal-light);
  }
  .ref-card.composite { width: 340px; }
  .ref-card.composite img { aspect-ratio: 832/1216; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 20px; }
  .card {
    background: var(--surface); border-radius: var(--radius); overflow: hidden;
    border: 1px solid rgba(139, 26, 43, 0.15); transition: border-color 0.2s, transform 0.2s;
  }
  .card:hover { border-color: rgba(139, 26, 43, 0.4); transform: translateY(-2px); }
  .card-images { display: flex; gap: 0; }
  .card-img {
    flex: 1; aspect-ratio: 832/1216; overflow: hidden; background: #110a0c;
    display: flex; align-items: center; justify-content: center;
  }
  .card-img img { width: 100%; height: 100%; object-fit: cover; cursor: pointer; transition: transform 0.3s; }
  .card-img img:hover { transform: scale(1.03); }
  .pose-thumb {
    width: 120px; background: #0d0809; display: flex; flex-direction: column;
    align-items: center; justify-content: center; padding: 8px; border-left: 1px solid rgba(139,26,43,0.1);
  }
  .pose-thumb img { width: 100%; height: auto; border-radius: 4px; opacity: 0.85; }
  .pose-thumb span { font-size: 0.65rem; color: var(--text-muted); margin-top: 4px; text-align: center; }
  .pose-thumb .no-pose { font-size: 0.7rem; color: var(--text-muted); text-align: center; }
  .card-info { padding: 16px; }
  .card-info h3 { font-family: 'Playfair Display', serif; font-size: 1rem; margin-bottom: 8px; color: var(--text); }
  .prompt { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 12px; line-height: 1.5; }
  .badges { display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
  .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 600; }
  .badge.pass { background: rgba(45, 106, 79, 0.2); color: #6fcf97; border: 1px solid rgba(45, 106, 79, 0.4); }
  .badge.fail { background: rgba(139, 26, 43, 0.2); color: var(--crimson-light); border: 1px solid rgba(139, 26, 43, 0.4); }
  .strength-badge {
    display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 0.75rem;
    font-weight: 600; background: rgba(212, 146, 10, 0.15); color: var(--amber-light);
    border: 1px solid rgba(212, 146, 10, 0.3);
  }
  .ref-badge {
    display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 0.75rem;
    font-weight: 600; background: rgba(45, 158, 143, 0.15); color: var(--teal-light);
    border: 1px solid rgba(45, 158, 143, 0.3);
  }
  .filtered {
    width: 100%; height: 100%; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    background: repeating-linear-gradient(-45deg, transparent, transparent 10px, rgba(139,26,43,0.08) 10px, rgba(139,26,43,0.08) 20px);
    color: var(--crimson-light); font-weight: 600; font-size: 1.2rem; padding: 20px; text-align: center;
  }
  .filtered span { font-size: 0.75rem; color: var(--text-muted); font-weight: 400; margin-top: 8px; word-break: break-all; }
  .modal-overlay {
    display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.92);
    z-index: 1000; align-items: center; justify-content: center; padding: 20px; cursor: pointer;
  }
  .modal-overlay.active { display: flex; }
  .modal-content { max-width: 90vw; max-height: 90vh; display: flex; gap: 30px; align-items: flex-start; cursor: default; }
  .modal-content img { max-height: 85vh; max-width: 55vw; object-fit: contain; border-radius: var(--radius); }
  .modal-details { max-width: 400px; color: var(--text); }
  .modal-details h3 { font-family: 'Playfair Display', serif; font-size: 1.3rem; margin-bottom: 12px; color: var(--amber-light); }
  .modal-details .full-prompt { font-size: 0.85rem; color: var(--text-muted); line-height: 1.7; white-space: pre-wrap; }
  @media (max-width: 768px) {
    .header h1 { font-size: 1.8rem; } .grid { grid-template-columns: 1fr; }
    .modal-content { flex-direction: column; } .modal-content img { max-width: 90vw; }
    .pose-thumb { width: 80px; } .ref-section { flex-direction: column; align-items: center; }
  }
</style>
</head>
<body>
<div class="header">
  <h1>Flux 2 Dev \u2014 ControlNet + Character Consistency</h1>
  <p class="subtitle">Pose control + reference image tiling on RunPod \u2014 ${dateStr}</p>
  <div class="stats">
    <div class="stat"><div class="number">${passed}</div><div class="label">Generated</div></div>
    <div class="stat"><div class="number">${failed}</div><div class="label">Failed</div></div>
    <div class="stat"><div class="number">${results.length}</div><div class="label">Total</div></div>
  </div>
</div>

<div class="section">
  <h2>Character References</h2>
  <p class="section-desc">
    Portraits generated with Flux 2 Dev (no ControlNet), then composited side-by-side
    as a tile reference image for character consistency across all test generations.
  </p>
  <div class="ref-section">
    <div class="ref-card">
      <img src="${thaboFilename}" alt="Thabo portrait" />
      <div class="ref-label">Thabo (male)</div>
    </div>
    <div class="ref-card">
      <img src="${nalediFilename}" alt="Naledi portrait" />
      <div class="ref-label">Naledi (female)</div>
    </div>
    <div class="ref-card composite">
      <img src="${refCompositeFilename}" alt="Reference composite" />
      <div class="ref-label">Composite (tile reference)</div>
    </div>
  </div>
</div>

<div class="section">
  <h2>Baseline + Strength Sweep</h2>
  <p class="section-desc">
    Same missionary prompt and seed. Tests: no CN, ref-only, then ref + pose at 0.40\u20130.80.
    All use ref tile at ${REF_STRENGTH} strength. Compare character consistency across strength levels.
  </p>
  <div class="grid">${sweepTests.map(makeCard).join("\n")}</div>
</div>

<div class="section">
  <h2>Pose Variety (ref + pose 0.70)</h2>
  <p class="section-desc">
    Different explicit poses with reference tiling, testing both pose adherence
    and character consistency across cowgirl, from-behind, and standing-lift.
  </p>
  <div class="grid">${varietyTests.map(makeCard).join("\n")}</div>
</div>

<div class="section">
  <h2>Comparison: Pose Without Reference</h2>
  <p class="section-desc">
    Same pose and strength but without the reference tile — isolates how much
    character consistency the reference adds versus prompt-only description.
  </p>
  <div class="grid">${comparisonTests.map(makeCard).join("\n")}</div>
</div>

<div class="modal-overlay" id="modal" onclick="closeModal(event)">
  <div class="modal-content" onclick="event.stopPropagation()">
    <img id="modal-img" src="" />
    <div class="modal-details">
      <h3 id="modal-title"></h3>
      <div class="full-prompt" id="modal-prompt"></div>
    </div>
  </div>
</div>
<script>
  function openModal(src, title, prompt) {
    document.getElementById('modal').classList.add('active');
    document.getElementById('modal-img').src = src;
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-prompt').textContent = prompt;
  }
  function closeModal(e) {
    if (e.target === document.getElementById('modal')) document.getElementById('modal').classList.remove('active');
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.getElementById('modal').classList.remove('active');
  });
</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

async function main() {
  if (!process.env.RUNPOD_ENDPOINT_ID || !process.env.RUNPOD_API_KEY) {
    console.error(
      "ERROR: RUNPOD_ENDPOINT_ID or RUNPOD_API_KEY not found in .env.local",
    );
    process.exit(1);
  }

  console.log("=".repeat(60));
  console.log("  Flux 2 Dev \u2014 ControlNet + Character Consistency");
  console.log("=".repeat(60));
  console.log(`  Endpoint:    ${process.env.RUNPOD_ENDPOINT_ID}`);
  console.log(`  Model:       ${UNET}`);
  console.log(`  ControlNet:  ${CONTROLNET_MODEL}`);
  console.log(`  Size:        ${WIDTH}x${HEIGHT}, ${STEPS} steps, CFG ${CFG}`);
  console.log(`  Ref strength: ${REF_STRENGTH}`);
  console.log(`  Tests:       2 portraits + ${TESTS.length} scene tests`);
  console.log("=".repeat(60));

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const portraitSeed = Math.floor(Math.random() * 1_000_000);

  // ════════════════════════════════════════════
  // PHASE 1: Generate character reference portraits
  // ════════════════════════════════════════════
  console.log("\n\u2501\u2501\u2501 PHASE 1: Character Portraits \u2501\u2501\u2501");

  const thaboBuffer = await generatePortrait(
    "Thabo",
    THABO.portrait,
    portraitSeed,
  );
  const thaboFilename = "ref_thabo.png";
  fs.writeFileSync(path.join(OUTPUT_DIR, thaboFilename), thaboBuffer);

  const nalediBuffer = await generatePortrait(
    "Naledi",
    NALEDI.portrait,
    portraitSeed + 1,
  );
  const nalediFilename = "ref_naledi.png";
  fs.writeFileSync(path.join(OUTPUT_DIR, nalediFilename), nalediBuffer);

  // ════════════════════════════════════════════
  // PHASE 2: Create composite reference image
  // ════════════════════════════════════════════
  console.log("\n\u2501\u2501\u2501 PHASE 2: Composite Reference \u2501\u2501\u2501");

  // Thabo on left, Naledi on right (matches typical male-left framing)
  const compositeBuffer = await createComposite(thaboBuffer, nalediBuffer);
  const refImageName = "ref_composite.png";
  fs.writeFileSync(path.join(OUTPUT_DIR, refImageName), compositeBuffer);
  console.log(
    `  \u2713 Composite saved: ${refImageName} (${(compositeBuffer.length / 1024).toFixed(0)} KB)`,
  );

  // ════════════════════════════════════════════
  // PHASE 3: ControlNet + Reference Scene Tests
  // ════════════════════════════════════════════
  console.log("\n\u2501\u2501\u2501 PHASE 3: Scene Tests \u2501\u2501\u2501");

  const results: TestResult[] = [];
  const baseSeed = Math.floor(Math.random() * 1_000_000);

  for (let i = 0; i < TESTS.length; i++) {
    const test = TESTS[i];
    // Same seed for sweep tests (1-6), unique for pose variety (7+)
    const seed = i < 6 ? baseSeed : baseSeed + i;
    console.log(
      `\n\u2501\u2501\u2501 [${i + 1}/${TESTS.length}] ${test.name} \u2501\u2501\u2501`,
    );

    const filename = `${test.id}.png`;
    const savePath = path.join(OUTPUT_DIR, filename);

    try {
      let workflow: Record<string, any>;
      let images: Array<{ name: string; image: string }> = [];
      let poseFilename: string | null = null;

      if (!test.useReference && test.poseStrength === null) {
        // Pure baseline — no ControlNet at all
        workflow = buildBaselineWorkflow(test.prompt, seed);
        console.log(`  Mode: baseline (no CN)`);
      } else if (test.useReference && test.poseStrength === null) {
        // Reference only — tile ControlNet, no pose
        workflow = buildRefOnlyWorkflow(test.prompt, seed, refImageName);
        images.push({
          name: refImageName,
          image: compositeBuffer.toString("base64"),
        });
        console.log(`  Mode: ref only (tile ${REF_STRENGTH})`);
      } else if (!test.useReference && test.poseStrength !== null) {
        // Pose only — no reference
        const poseData = await getOrRenderPose(test.poseId);
        poseFilename = poseData.filename;
        workflow = buildPoseOnlyWorkflow(
          test.prompt,
          seed,
          poseData.filename,
          test.poseStrength,
        );
        images.push({
          name: poseData.filename,
          image: poseData.buffer.toString("base64"),
        });
        console.log(
          `  Mode: pose only (${test.poseId} @ ${test.poseStrength})`,
        );
      } else {
        // Chained — reference + pose
        const poseData = await getOrRenderPose(test.poseId);
        poseFilename = poseData.filename;
        workflow = buildCombinedWorkflow(
          test.prompt,
          seed,
          refImageName,
          poseData.filename,
          test.poseStrength!,
        );
        images.push(
          {
            name: refImageName,
            image: compositeBuffer.toString("base64"),
          },
          {
            name: poseData.filename,
            image: poseData.buffer.toString("base64"),
          },
        );
        console.log(
          `  Mode: chained (ref ${REF_STRENGTH} + pose ${test.poseId} @ ${test.poseStrength})`,
        );
      }

      const { jobId } = await submitRunPodJob(
        workflow,
        images.length > 0 ? images : undefined,
      );
      console.log(`  Job: ${jobId}`);

      const { imageBase64, executionTime } = await waitForRunPodResult(
        jobId,
        600_000,
        5_000,
      );

      const buffer = base64ToBuffer(imageBase64);
      fs.writeFileSync(savePath, buffer);
      console.log(
        `  \u2713 Saved: ${savePath} (${(executionTime / 1000).toFixed(1)}s)`,
      );

      results.push({
        id: test.id,
        name: test.name,
        poseId: test.poseId,
        poseStrength: test.poseStrength,
        useReference: test.useReference,
        prompt: test.prompt,
        success: true,
        error: null,
        executionTime,
        filename,
        poseFilename,
      });
    } catch (err: any) {
      console.log(`  \u2717 Failed: ${err.message}`);
      results.push({
        id: test.id,
        name: test.name,
        poseId: test.poseId,
        poseStrength: test.poseStrength,
        useReference: test.useReference,
        prompt: test.prompt,
        success: false,
        error: err.message,
        executionTime: 0,
        filename,
        poseFilename: null,
      });
    }
  }

  // ── Generate report ──
  console.log("\n\n\u2501\u2501\u2501 GENERATING REPORT \u2501\u2501\u2501");
  const html = generateReport(
    results,
    refImageName,
    thaboFilename,
    nalediFilename,
  );
  const reportPath = path.join(OUTPUT_DIR, "report.html");
  fs.writeFileSync(reportPath, html);
  console.log(`\u2713 Report saved: ${reportPath}`);

  const metaPath = path.join(OUTPUT_DIR, "results.json");
  fs.writeFileSync(metaPath, JSON.stringify(results, null, 2));

  // ── Summary ──
  console.log("\n" + "=".repeat(60));
  console.log("  RESULTS");
  console.log("=".repeat(60));

  for (const r of results) {
    const icon = r.success ? "\u2713" : "\u2717";
    const time = r.success
      ? `${(r.executionTime / 1000).toFixed(1)}s`
      : "FAILED";
    const ref = r.useReference ? "+ref" : "";
    const pose =
      r.poseStrength !== null
        ? `pose ${r.poseStrength.toFixed(2)}`
        : "no pose";
    console.log(`  ${icon} ${r.id}: ${r.poseId} [${pose}${ref}] [${time}]`);
  }

  const passed = results.filter((r) => r.success).length;
  console.log(`\n  ${passed}/${results.length} generated`);
  console.log(`\n  Open the report:`);
  console.log(`  open ${path.resolve(reportPath)}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});