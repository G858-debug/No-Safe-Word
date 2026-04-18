/**
 * No Safe Word — Flux 2 Dev ControlNet + PuLID Character Consistency Test
 * ========================================================================
 * Tests pose-controlled image generation (ControlNet) with face identity
 * injection (PuLID) on Flux 2 Dev via RunPod.
 *
 * Architecture:
 *   - PuLID modifies the MODEL (face identity embeddings)
 *   - ControlNet modifies CONDITIONING (pose skeleton)
 *   - They're independent and coexist in the same workflow
 *
 * Three phases:
 *   1. Generate reference portraits for Thabo (male) and Naledi (female)
 *   2. Run scene tests with combinations of PuLID + ControlNet
 *   3. Generate HTML report comparing results
 *
 * Prerequisites:
 *   - comfyui-flux2fun-controlnet custom node on RunPod
 *   - ComfyUI_PuLID_Flux_ll custom node on RunPod
 *   - FLUX.2-dev-Fun-Controlnet-Union-2602.safetensors on volume
 *   - pulid_flux_v0.9.1.safetensors on volume
 *   - EVA02_CLIP_L_336_psz14_s6B.pt on volume
 *   - InsightFace buffalo_l (pre-baked in Docker image)
 *
 * Usage:
 *   npx tsx scripts/test-flux2-controlnet.ts
 */

import * as fs from "fs";
import * as path from "path";
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
const PULID_WEIGHT = 0.7;

// Model files on RunPod volume
const UNET = "flux2-dev-fp8_scaled.safetensors";
const TEXT_ENCODER = "mistral_3_small_flux2_fp8.safetensors";
const VAE = "flux2-vae.safetensors";
const CONTROLNET_MODEL = "FLUX.2-dev-Fun-Controlnet-Union-2602.safetensors";
const PULID_MODEL = "pulid_flux_v0.9.1.safetensors";

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
interface TestCase {
  id: string;
  name: string;
  poseId: string;
  poseStrength: number | null;
  usePulid: boolean;
  prompt: string;
}

interface TestResult {
  id: string;
  name: string;
  poseId: string;
  poseStrength: number | null;
  usePulid: boolean;
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
  physicalShort: "medium-brown skin, long black braids, voluptuous figure",
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
// POSE-SPECIFIC PROMPTS
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
  {
    id: "01_baseline",
    name: "Baseline (no PuLID, no pose)",
    poseId: "missionary",
    poseStrength: null,
    usePulid: false,
    prompt: PROMPTS.missionary,
  },
  {
    id: "02_pulid_only",
    name: "PuLID only (face identity, no pose)",
    poseId: "missionary",
    poseStrength: null,
    usePulid: true,
    prompt: PROMPTS.missionary,
  },
  {
    id: "03_pulid_pose_040",
    name: "PuLID + Missionary pose 0.40",
    poseId: "missionary",
    poseStrength: 0.4,
    usePulid: true,
    prompt: PROMPTS.missionary,
  },
  {
    id: "04_pulid_pose_060",
    name: "PuLID + Missionary pose 0.60",
    poseId: "missionary",
    poseStrength: 0.6,
    usePulid: true,
    prompt: PROMPTS.missionary,
  },
  {
    id: "05_pulid_pose_070",
    name: "PuLID + Missionary pose 0.70",
    poseId: "missionary",
    poseStrength: 0.7,
    usePulid: true,
    prompt: PROMPTS.missionary,
  },
  {
    id: "06_pulid_pose_080",
    name: "PuLID + Missionary pose 0.80",
    poseId: "missionary",
    poseStrength: 0.8,
    usePulid: true,
    prompt: PROMPTS.missionary,
  },
  {
    id: "07_pulid_cowgirl",
    name: "PuLID + Cowgirl pose 0.70",
    poseId: "cowgirl",
    poseStrength: 0.7,
    usePulid: true,
    prompt: PROMPTS.cowgirl,
  },
  {
    id: "08_pulid_from_behind",
    name: "PuLID + From Behind pose 0.70",
    poseId: "from-behind",
    poseStrength: 0.7,
    usePulid: true,
    prompt: PROMPTS["from-behind"],
  },
  {
    id: "09_pulid_standing_lift",
    name: "PuLID + Standing Lift pose 0.70",
    poseId: "standing-lift",
    poseStrength: 0.7,
    usePulid: true,
    prompt: PROMPTS["standing-lift"],
  },
  {
    id: "10_pose_only",
    name: "Pose only 0.70 (no PuLID)",
    poseId: "missionary",
    poseStrength: 0.7,
    usePulid: false,
    prompt: PROMPTS.missionary,
  },
];

// ─────────────────────────────────────────────
// SHARED NODE BUILDERS
// ─────────────────────────────────────────────

/** Base model loading nodes (1-3), shared by all workflows */
function baseModelNodes(): Record<string, any> {
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
  };
}

/** PuLID model loading + face application nodes (40-46) */
function pulidNodes(
  thaboImageName: string,
  nalediImageName: string,
): Record<string, any> {
  return {
    // Load PuLID model
    "40": {
      class_type: "PulidFluxModelLoader",
      inputs: { pulid_file: PULID_MODEL },
    },
    // Load EVA-CLIP vision encoder
    "41": {
      class_type: "PulidFluxEvaClipLoader",
      inputs: {},
    },
    // Load InsightFace analyzer
    "42": {
      class_type: "PulidFluxInsightFaceLoader",
      inputs: { provider: "CUDA" },
    },
    // Thabo face reference
    "43": {
      class_type: "LoadImage",
      inputs: { image: thaboImageName },
    },
    // Apply Thabo identity to model
    "44": {
      class_type: "ApplyPulidFlux",
      inputs: {
        model: ["1", 0],
        pulid_flux: ["40", 0],
        eva_clip: ["41", 0],
        face_analysis: ["42", 0],
        image: ["43", 0],
        weight: PULID_WEIGHT,
        start_at: 0.0,
        end_at: 1.0,
      },
    },
    // Naledi face reference
    "45": {
      class_type: "LoadImage",
      inputs: { image: nalediImageName },
    },
    // Apply Naledi identity to model (chained on top of Thabo)
    "46": {
      class_type: "ApplyPulidFlux",
      inputs: {
        model: ["44", 0],
        pulid_flux: ["40", 0],
        eva_clip: ["41", 0],
        face_analysis: ["42", 0],
        image: ["45", 0],
        weight: PULID_WEIGHT,
        start_at: 0.0,
        end_at: 1.0,
      },
    },
  };
}

/** ControlNet pose nodes (20-21) + apply (5) */
function controlNetNodes(
  poseImageName: string,
  poseStrength: number,
  conditioningRef: [string, number],
): Record<string, any> {
  return {
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
        conditioning: conditioningRef,
        controlnet: ["20", 0],
        vae: ["3", 0],
        strength: poseStrength,
        control_image: ["21", 0],
      },
    },
  };
}

/**
 * Sampling nodes — common tail of every workflow.
 * modelRef: which node provides the model (["1",0] for base, ["46",0] for PuLID-modified)
 * condRef: which node provides the guided conditioning
 */
function samplingNodes(
  seed: number,
  modelRef: [string, number],
  condRef: [string, number],
): Record<string, any> {
  return {
    "6": {
      class_type: "FluxGuidance",
      inputs: { conditioning: condRef, guidance: CFG },
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
      inputs: { model: modelRef, steps: STEPS, alpha: 0.6, beta: 0.95 },
    },
    "11": {
      class_type: "BasicGuider",
      inputs: { model: modelRef, conditioning: ["6", 0] },
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
      inputs: { images: ["13", 0], filename_prefix: "flux2test" },
    },
  };
}

// ─────────────────────────────────────────────
// WORKFLOW BUILDERS (composing shared nodes)
// ─────────────────────────────────────────────

function buildBaselineWorkflow(prompt: string, seed: number): Record<string, any> {
  return {
    ...baseModelNodes(),
    "4": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["2", 0] } },
    ...samplingNodes(seed, ["1", 0], ["4", 0]),
  };
}

function buildPulidOnlyWorkflow(
  prompt: string, seed: number,
  thaboImg: string, nalediImg: string,
): Record<string, any> {
  return {
    ...baseModelNodes(),
    "4": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["2", 0] } },
    ...pulidNodes(thaboImg, nalediImg),
    ...samplingNodes(seed, ["46", 0], ["4", 0]),
  };
}

function buildPoseOnlyWorkflow(
  prompt: string, seed: number,
  poseImg: string, poseStrength: number,
): Record<string, any> {
  return {
    ...baseModelNodes(),
    "4": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["2", 0] } },
    ...controlNetNodes(poseImg, poseStrength, ["4", 0]),
    ...samplingNodes(seed, ["1", 0], ["5", 0]),
  };
}

function buildPulidPoseWorkflow(
  prompt: string, seed: number,
  thaboImg: string, nalediImg: string,
  poseImg: string, poseStrength: number,
): Record<string, any> {
  return {
    ...baseModelNodes(),
    "4": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["2", 0] } },
    ...pulidNodes(thaboImg, nalediImg),
    ...controlNetNodes(poseImg, poseStrength, ["4", 0]),
    // PuLID → model, ControlNet → conditioning, both fed to sampling
    ...samplingNodes(seed, ["46", 0], ["5", 0]),
  };
}

// ─────────────────────────────────────────────
// PORTRAIT GENERATION
// ─────────────────────────────────────────────

async function generatePortrait(
  name: string, prompt: string, seed: number,
): Promise<Buffer> {
  console.log(`\n── Generating ${name} portrait (seed ${seed}) ──`);
  const workflow = buildBaselineWorkflow(prompt, seed);
  const { jobId } = await submitRunPodJob(workflow);
  console.log(`   Job: ${jobId}`);
  const { imageBase64, executionTime } = await waitForRunPodResult(jobId, 600_000, 5_000);
  const buffer = base64ToBuffer(imageBase64);
  console.log(`   \u2713 ${name} portrait (${(executionTime / 1000).toFixed(1)}s)`);
  return buffer;
}

// ─────────────────────────────────────────────
// POSE RENDERING
// ─────────────────────────────────────────────

const poseCache = new Map<string, { buffer: Buffer; filename: string }>();

async function getOrRenderPose(poseId: string): Promise<{ buffer: Buffer; filename: string }> {
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
// HTML REPORT
// ─────────────────────────────────────────────

function generateReport(
  results: TestResult[],
  thaboFilename: string,
  nalediFilename: string,
): string {
  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const now = new Date();
  const dateStr =
    now.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" }) +
    ", " +
    now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  function makeCard(r: TestResult): string {
    const escapedName = r.name.replace(/"/g, "&quot;");
    const escapedPrompt = r.prompt.replace(/"/g, "&quot;").replace(/`/g, "");
    let imgTag: string;
    if (r.success) {
      imgTag = `<img src="${r.filename}" loading="lazy" onclick="openModal(this.src, \`${escapedName}\`, \`${escapedPrompt}\`)" />`;
    } else {
      imgTag = `<div class="filtered error">FAILED<br><span>${r.error || "Unknown"}</span></div>`;
    }
    const parts: string[] = [];
    if (r.usePulid) parts.push(`PuLID ${PULID_WEIGHT}`);
    if (r.poseStrength !== null) parts.push(`Pose ${r.poseStrength.toFixed(2)}`);
    const strengthLabel = parts.length > 0 ? parts.join(" + ") : "No CN/PuLID";
    const badgeClass = r.success ? "pass" : "fail";
    const badgeText = r.success ? `\u2713 ${(r.executionTime / 1000).toFixed(1)}s` : "\u2717 FAILED";
    const pulidBadge = r.usePulid ? `<span class="pulid-badge">PuLID</span>` : "";
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
                    ${pulidBadge}
                    <span class="strength-badge">${strengthLabel}</span>
                    <span class="badge ${badgeClass}">${badgeText}</span>
                </div>
                <h3>${r.name}</h3>
                <p class="prompt">${r.prompt.slice(0, 120)}...</p>
            </div>
        </div>`;
  }

  const sweep = results.filter((_, i) => i < 6);
  const variety = results.filter((_, i) => i >= 6 && i < 9);
  const comparison = results.filter((_, i) => i >= 9);

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Flux 2 Dev \u2014 PuLID + ControlNet Test</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#0a0607;--surface:#1a1012;--crimson:#8b1a2b;--crimson-light:#c4384f;--amber:#d4920a;--amber-light:#f5c542;--text:#e8ddd0;--text-muted:#8a7d72;--radius:8px;--teal:#2d9e8f;--teal-light:#4fcfb8;--purple:#7b4daa;--purple-light:#b47eff}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;line-height:1.6}
.header{text-align:center;padding:60px 20px 40px;background:linear-gradient(180deg,#1a0a0e 0%,var(--bg) 100%);border-bottom:1px solid rgba(139,26,43,.3)}
.header h1{font-family:'Playfair Display',serif;font-size:2.4rem;font-weight:700;background:linear-gradient(135deg,var(--amber-light),var(--crimson-light));-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px}
.header .subtitle{color:var(--text-muted);font-size:1rem;margin-bottom:24px}
.stats{display:flex;justify-content:center;gap:40px;margin-top:20px}
.stat{text-align:center}.stat .number{font-family:'Playfair Display',serif;font-size:2rem;font-weight:700;color:var(--amber-light)}.stat .label{font-size:.8rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px}
.section{max-width:1400px;margin:0 auto;padding:40px 20px}
.section h2{font-family:'Playfair Display',serif;font-size:1.8rem;margin-bottom:8px;color:var(--amber-light)}
.section .desc{color:var(--text-muted);margin-bottom:24px;font-size:.95rem}
.ref-section{display:flex;gap:20px;justify-content:center;flex-wrap:wrap;margin-bottom:32px}
.ref-card{background:var(--surface);border-radius:var(--radius);overflow:hidden;border:1px solid rgba(123,77,170,.3);width:220px}
.ref-card img{width:100%;aspect-ratio:832/1216;object-fit:cover}
.ref-card .ref-label{padding:10px;text-align:center;font-family:'Playfair Display',serif;font-size:1rem;color:var(--purple-light)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:20px}
.card{background:var(--surface);border-radius:var(--radius);overflow:hidden;border:1px solid rgba(139,26,43,.15);transition:border-color .2s,transform .2s}
.card:hover{border-color:rgba(139,26,43,.4);transform:translateY(-2px)}
.card-images{display:flex;gap:0}
.card-img{flex:1;aspect-ratio:832/1216;overflow:hidden;background:#110a0c;display:flex;align-items:center;justify-content:center}
.card-img img{width:100%;height:100%;object-fit:cover;cursor:pointer;transition:transform .3s}
.card-img img:hover{transform:scale(1.03)}
.pose-thumb{width:120px;background:#0d0809;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px;border-left:1px solid rgba(139,26,43,.1)}
.pose-thumb img{width:100%;height:auto;border-radius:4px;opacity:.85}
.pose-thumb span{font-size:.65rem;color:var(--text-muted);margin-top:4px;text-align:center}
.pose-thumb .no-pose{font-size:.7rem;color:var(--text-muted);text-align:center}
.card-info{padding:16px}
.card-info h3{font-family:'Playfair Display',serif;font-size:1rem;margin-bottom:8px;color:var(--text)}
.prompt{font-size:.8rem;color:var(--text-muted);margin-bottom:12px;line-height:1.5}
.badges{display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.badge{display:inline-block;padding:4px 12px;border-radius:20px;font-size:.75rem;font-weight:600}
.badge.pass{background:rgba(45,106,79,.2);color:#6fcf97;border:1px solid rgba(45,106,79,.4)}
.badge.fail{background:rgba(139,26,43,.2);color:var(--crimson-light);border:1px solid rgba(139,26,43,.4)}
.strength-badge{display:inline-block;padding:4px 12px;border-radius:20px;font-size:.75rem;font-weight:600;background:rgba(212,146,10,.15);color:var(--amber-light);border:1px solid rgba(212,146,10,.3)}
.pulid-badge{display:inline-block;padding:4px 12px;border-radius:20px;font-size:.75rem;font-weight:600;background:rgba(123,77,170,.15);color:var(--purple-light);border:1px solid rgba(123,77,170,.3)}
.filtered{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:repeating-linear-gradient(-45deg,transparent,transparent 10px,rgba(139,26,43,.08) 10px,rgba(139,26,43,.08) 20px);color:var(--crimson-light);font-weight:600;font-size:1.2rem;padding:20px;text-align:center}
.filtered span{font-size:.75rem;color:var(--text-muted);font-weight:400;margin-top:8px;word-break:break-all}
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:1000;align-items:center;justify-content:center;padding:20px;cursor:pointer}
.modal-overlay.active{display:flex}
.modal-content{max-width:90vw;max-height:90vh;display:flex;gap:30px;align-items:flex-start;cursor:default}
.modal-content img{max-height:85vh;max-width:55vw;object-fit:contain;border-radius:var(--radius)}
.modal-details{max-width:400px;color:var(--text)}
.modal-details h3{font-family:'Playfair Display',serif;font-size:1.3rem;margin-bottom:12px;color:var(--amber-light)}
.modal-details .full-prompt{font-size:.85rem;color:var(--text-muted);line-height:1.7;white-space:pre-wrap}
@media(max-width:768px){.header h1{font-size:1.8rem}.grid{grid-template-columns:1fr}.modal-content{flex-direction:column}.modal-content img{max-width:90vw}.pose-thumb{width:80px}.ref-section{flex-direction:column;align-items:center}}
</style></head><body>
<div class="header">
  <h1>Flux 2 Dev \u2014 PuLID + ControlNet</h1>
  <p class="subtitle">Face identity (PuLID) + pose control (ControlNet) on RunPod \u2014 ${dateStr}</p>
  <div class="stats">
    <div class="stat"><div class="number">${passed}</div><div class="label">Generated</div></div>
    <div class="stat"><div class="number">${failed}</div><div class="label">Failed</div></div>
    <div class="stat"><div class="number">${results.length}</div><div class="label">Total</div></div>
  </div>
</div>
<div class="section">
  <h2>Character References (PuLID Face Sources)</h2>
  <p class="desc">Portraits generated with Flux 2 Dev, then passed to PuLID as face identity references. PuLID injects face embeddings into the model at weight ${PULID_WEIGHT}.</p>
  <div class="ref-section">
    <div class="ref-card"><img src="${thaboFilename}" alt="Thabo" /><div class="ref-label">Thabo (male)</div></div>
    <div class="ref-card"><img src="${nalediFilename}" alt="Naledi" /><div class="ref-label">Naledi (female)</div></div>
  </div>
</div>
<div class="section">
  <h2>Baseline + Strength Sweep</h2>
  <p class="desc">Same missionary prompt/seed. Tests: no PuLID/CN, PuLID-only, then PuLID + pose at 0.40\u20130.80.</p>
  <div class="grid">${sweep.map(makeCard).join("\n")}</div>
</div>
<div class="section">
  <h2>Pose Variety (PuLID + pose 0.70)</h2>
  <p class="desc">Different explicit poses with PuLID face identity — cowgirl, from-behind, standing-lift.</p>
  <div class="grid">${variety.map(makeCard).join("\n")}</div>
</div>
<div class="section">
  <h2>Comparison: Pose Without PuLID</h2>
  <p class="desc">Same pose strength but no PuLID — how much does face identity add vs prompt-only?</p>
  <div class="grid">${comparison.map(makeCard).join("\n")}</div>
</div>
<div class="modal-overlay" id="modal" onclick="closeModal(event)">
  <div class="modal-content" onclick="event.stopPropagation()">
    <img id="modal-img" src="" />
    <div class="modal-details"><h3 id="modal-title"></h3><div class="full-prompt" id="modal-prompt"></div></div>
  </div>
</div>
<script>
function openModal(s,t,p){document.getElementById('modal').classList.add('active');document.getElementById('modal-img').src=s;document.getElementById('modal-title').textContent=t;document.getElementById('modal-prompt').textContent=p}
function closeModal(e){if(e.target===document.getElementById('modal'))document.getElementById('modal').classList.remove('active')}
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.getElementById('modal').classList.remove('active')});
</script></body></html>`;
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

async function main() {
  if (!process.env.RUNPOD_ENDPOINT_ID || !process.env.RUNPOD_API_KEY) {
    console.error("ERROR: RUNPOD_ENDPOINT_ID or RUNPOD_API_KEY not in .env.local");
    process.exit(1);
  }

  console.log("=".repeat(60));
  console.log("  Flux 2 Dev \u2014 PuLID + ControlNet Test");
  console.log("=".repeat(60));
  console.log(`  Endpoint:     ${process.env.RUNPOD_ENDPOINT_ID}`);
  console.log(`  Model:        ${UNET}`);
  console.log(`  ControlNet:   ${CONTROLNET_MODEL}`);
  console.log(`  PuLID:        ${PULID_MODEL} (weight ${PULID_WEIGHT})`);
  console.log(`  Size:         ${WIDTH}x${HEIGHT}, ${STEPS} steps, CFG ${CFG}`);
  console.log(`  Tests:        2 portraits + ${TESTS.length} scene tests`);
  console.log("=".repeat(60));

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const portraitSeed = Math.floor(Math.random() * 1_000_000);

  // ═══ PHASE 1: Generate character portraits ═══
  console.log("\n\u2501\u2501\u2501 PHASE 1: Character Portraits \u2501\u2501\u2501");

  const thaboBuffer = await generatePortrait("Thabo", THABO.portrait, portraitSeed);
  const thaboFilename = "ref_thabo.png";
  fs.writeFileSync(path.join(OUTPUT_DIR, thaboFilename), thaboBuffer);

  const nalediBuffer = await generatePortrait("Naledi", NALEDI.portrait, portraitSeed + 1);
  const nalediFilename = "ref_naledi.png";
  fs.writeFileSync(path.join(OUTPUT_DIR, nalediFilename), nalediBuffer);

  // ═══ PHASE 2: Scene Tests ═══
  console.log("\n\u2501\u2501\u2501 PHASE 2: Scene Tests \u2501\u2501\u2501");

  const results: TestResult[] = [];
  const baseSeed = Math.floor(Math.random() * 1_000_000);

  for (let i = 0; i < TESTS.length; i++) {
    const test = TESTS[i];
    const seed = i < 6 ? baseSeed : baseSeed + i;
    console.log(`\n\u2501\u2501\u2501 [${i + 1}/${TESTS.length}] ${test.name} \u2501\u2501\u2501`);

    const filename = `${test.id}.png`;
    const savePath = path.join(OUTPUT_DIR, filename);

    try {
      let workflow: Record<string, any>;
      let images: Array<{ name: string; image: string }> = [];
      let poseFilename: string | null = null;

      if (!test.usePulid && test.poseStrength === null) {
        // Baseline
        workflow = buildBaselineWorkflow(test.prompt, seed);
        console.log("  Mode: baseline");
      } else if (test.usePulid && test.poseStrength === null) {
        // PuLID only
        workflow = buildPulidOnlyWorkflow(test.prompt, seed, thaboFilename, nalediFilename);
        images.push(
          { name: thaboFilename, image: thaboBuffer.toString("base64") },
          { name: nalediFilename, image: nalediBuffer.toString("base64") },
        );
        console.log("  Mode: PuLID only");
      } else if (!test.usePulid && test.poseStrength !== null) {
        // Pose only
        const pd = await getOrRenderPose(test.poseId);
        poseFilename = pd.filename;
        workflow = buildPoseOnlyWorkflow(test.prompt, seed, pd.filename, test.poseStrength);
        images.push({ name: pd.filename, image: pd.buffer.toString("base64") });
        console.log(`  Mode: pose only (${test.poseId} @ ${test.poseStrength})`);
      } else {
        // PuLID + Pose
        const pd = await getOrRenderPose(test.poseId);
        poseFilename = pd.filename;
        workflow = buildPulidPoseWorkflow(
          test.prompt, seed,
          thaboFilename, nalediFilename,
          pd.filename, test.poseStrength!,
        );
        images.push(
          { name: thaboFilename, image: thaboBuffer.toString("base64") },
          { name: nalediFilename, image: nalediBuffer.toString("base64") },
          { name: pd.filename, image: pd.buffer.toString("base64") },
        );
        console.log(`  Mode: PuLID + pose (${test.poseId} @ ${test.poseStrength})`);
      }

      const { jobId } = await submitRunPodJob(workflow, images.length > 0 ? images : undefined);
      console.log(`  Job: ${jobId}`);

      const { imageBase64, executionTime } = await waitForRunPodResult(jobId, 600_000, 5_000);
      const buffer = base64ToBuffer(imageBase64);
      fs.writeFileSync(savePath, buffer);
      console.log(`  \u2713 Saved: ${savePath} (${(executionTime / 1000).toFixed(1)}s)`);

      results.push({
        id: test.id, name: test.name, poseId: test.poseId,
        poseStrength: test.poseStrength, usePulid: test.usePulid,
        prompt: test.prompt, success: true, error: null,
        executionTime, filename, poseFilename,
      });
    } catch (err: any) {
      console.log(`  \u2717 Failed: ${err.message}`);
      results.push({
        id: test.id, name: test.name, poseId: test.poseId,
        poseStrength: test.poseStrength, usePulid: test.usePulid,
        prompt: test.prompt, success: false, error: err.message,
        executionTime: 0, filename, poseFilename: null,
      });
    }
  }

  // ═══ Report ═══
  console.log("\n\n\u2501\u2501\u2501 GENERATING REPORT \u2501\u2501\u2501");
  const html = generateReport(results, thaboFilename, nalediFilename);
  const reportPath = path.join(OUTPUT_DIR, "report.html");
  fs.writeFileSync(reportPath, html);
  console.log(`\u2713 Report: ${reportPath}`);
  fs.writeFileSync(path.join(OUTPUT_DIR, "results.json"), JSON.stringify(results, null, 2));

  console.log("\n" + "=".repeat(60));
  console.log("  RESULTS");
  console.log("=".repeat(60));
  for (const r of results) {
    const icon = r.success ? "\u2713" : "\u2717";
    const time = r.success ? `${(r.executionTime / 1000).toFixed(1)}s` : "FAILED";
    const mode = [r.usePulid ? "pulid" : "", r.poseStrength !== null ? `pose ${r.poseStrength}` : ""].filter(Boolean).join("+") || "baseline";
    console.log(`  ${icon} ${r.id}: [${mode}] [${time}]`);
  }
  const p = results.filter((r) => r.success).length;
  console.log(`\n  ${p}/${results.length} generated`);
  console.log(`  open ${path.resolve(reportPath)}`);
  console.log("=".repeat(60));
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
