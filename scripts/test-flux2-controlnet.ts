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

interface TestResult extends TestCase {
  success: boolean;
  error: string | null;
  executionTime: number;
  filename: string;
  poseFilename: string | null;
}

// ─────────────────────────────────────────────
// CHARACTER DESCRIPTIONS
// ─────────────────────────────────────────────
const THABO_DESC = "dark brown skin, clean-shaven, strong angular jawline, short-cropped black hair with subtle fade, muscular build with broad shoulders";
const NALEDI_DESC = "medium-brown skin, long black braids, warm brown eyes, full lips";
const NALEDI_BODY = "extremely voluptuous body with very large heavy breasts, deep cleavage, tiny narrow waist, very wide hips, and a large round protruding backside";

const THABO_PORTRAIT =
  `A handsome Black South African man, age 28. ${THABO_DESC}, thick neck and powerful arms. ` +
  "He wears a fitted charcoal henley shirt, top two buttons undone. Warm confident expression, " +
  "slight knowing smile, looking directly at the camera. Standing in front of a mechanic workshop " +
  "in Middelburg, golden hour sunlight. Three-quarter portrait, shallow DOF. Photorealistic.";

const NALEDI_PORTRAIT =
  `A stunning Black South African woman, age 25. ${NALEDI_DESC}. ${NALEDI_BODY}. ` +
  "She wears a form-fitting deep burgundy wrap dress showing generous cleavage, gold stud earrings. " +
  "Confident seductive expression, playful half-smile, looking directly at the camera. Standing at " +
  "a township street corner in Middelburg, golden hour sunlight. Three-quarter portrait, shallow DOF. Photorealistic.";

// ─────────────────────────────────────────────
// PROMPTS
// ─────────────────────────────────────────────
const PROMPTS: Record<string, string> = {
  missionary:
    `A Black South African couple having sex in a dimly lit bedroom. She is Naledi, 25, ${NALEDI_DESC}, ${NALEDI_BODY}, ` +
    `lying on her back on deep red sheets with legs spread and wrapped around him. He is Thabo, 28, ${THABO_DESC}, ` +
    "positioned between her thighs on top, penetrating her. Both completely naked. Her large breasts pressed against " +
    "his chest, her face showing ecstasy, his expression intense. Warm amber candlelight. Medium shot, shallow DOF. " +
    "Explicit erotic photography, photorealistic.",
  cowgirl:
    `A Black South African couple having sex in a dimly lit bedroom. She is Naledi, 25, ${NALEDI_DESC}, ${NALEDI_BODY}, ` +
    `sitting upright straddling his hips in cowgirl position. He is Thabo, 28, ${THABO_DESC}, lying on his back on ` +
    "deep red sheets, hands on her wide hips. Both completely naked. Her very large bare breasts visible, bouncing. " +
    "Warm amber candlelight. Medium shot, shallow DOF. Explicit erotic photography, photorealistic.",
  "from-behind":
    `A Black South African couple having sex in a dimly lit bedroom. She is Naledi, 25, ${NALEDI_DESC}, ${NALEDI_BODY}, ` +
    `on all fours on deep red sheets, her large round backside raised. He is Thabo, 28, ${THABO_DESC}, kneeling ` +
    "behind her, hands gripping her wide hips, penetrating from behind. Both completely naked. She looks back over " +
    "her shoulder. Warm amber candlelight. Medium shot, shallow DOF. Explicit erotic photography, photorealistic.",
  "standing-lift":
    `A Black South African couple having sex standing in a dimly lit bedroom. She is Naledi, 25, ${NALEDI_DESC}, ` +
    `${NALEDI_BODY}. He is Thabo, 28, ${THABO_DESC}, standing and holding her up. Her legs wrapped around his ` +
    "waist, arms around his neck, face to face. Both completely naked. Her large breasts pressed against his chest. " +
    "Warm amber candlelight. Full body shot, shallow DOF. Explicit erotic photography, photorealistic.",
};

// ─────────────────────────────────────────────
// TEST MATRIX
// ─────────────────────────────────────────────
const TESTS: TestCase[] = [
  { id: "01_baseline", name: "Baseline (no PuLID, no pose)", poseId: "missionary", poseStrength: null, usePulid: false, prompt: PROMPTS.missionary },
  { id: "02_pulid_only", name: "PuLID only (face identity)", poseId: "missionary", poseStrength: null, usePulid: true, prompt: PROMPTS.missionary },
  { id: "03_pulid_pose_040", name: "PuLID + Missionary 0.40", poseId: "missionary", poseStrength: 0.4, usePulid: true, prompt: PROMPTS.missionary },
  { id: "04_pulid_pose_060", name: "PuLID + Missionary 0.60", poseId: "missionary", poseStrength: 0.6, usePulid: true, prompt: PROMPTS.missionary },
  { id: "05_pulid_pose_070", name: "PuLID + Missionary 0.70", poseId: "missionary", poseStrength: 0.7, usePulid: true, prompt: PROMPTS.missionary },
  { id: "06_pulid_cowgirl", name: "PuLID + Cowgirl 0.70", poseId: "cowgirl", poseStrength: 0.7, usePulid: true, prompt: PROMPTS.cowgirl },
  { id: "07_pulid_from_behind", name: "PuLID + From Behind 0.70", poseId: "from-behind", poseStrength: 0.7, usePulid: true, prompt: PROMPTS["from-behind"] },
  { id: "08_pulid_standing", name: "PuLID + Standing Lift 0.70", poseId: "standing-lift", poseStrength: 0.7, usePulid: true, prompt: PROMPTS["standing-lift"] },
  { id: "09_pose_only", name: "Pose only 0.70 (no PuLID)", poseId: "missionary", poseStrength: 0.7, usePulid: false, prompt: PROMPTS.missionary },
  { id: "10_pulid_pose_080", name: "PuLID + Missionary 0.80", poseId: "missionary", poseStrength: 0.8, usePulid: true, prompt: PROMPTS.missionary },
];

// ─────────────────────────────────────────────
// WORKFLOW BUILDERS
// ─────────────────────────────────────────────

function buildBaselineWorkflow(prompt: string, seed: number): Record<string, any> {
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: UNET, weight_dtype: "fp8_e4m3fn" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: TEXT_ENCODER, type: "flux2" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: VAE } },
    "4": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["2", 0] } },
    "5": { class_type: "FluxGuidance", inputs: { conditioning: ["4", 0], guidance: CFG } },
    "6": { class_type: "EmptyFlux2LatentImage", inputs: { width: WIDTH, height: HEIGHT, batch_size: 1 } },
    "7": { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: SAMPLER } },
    "9": { class_type: "BetaSamplingScheduler", inputs: { model: ["1", 0], steps: STEPS, alpha: 0.6, beta: 0.95 } },
    "10": { class_type: "BasicGuider", inputs: { model: ["1", 0], conditioning: ["5", 0] } },
    "11": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["7", 0], guider: ["10", 0], sampler: ["8", 0], sigmas: ["9", 0], latent_image: ["6", 0] } },
    "12": { class_type: "VAEDecode", inputs: { samples: ["11", 0], vae: ["3", 0] } },
    "13": { class_type: "SaveImage", inputs: { images: ["12", 0], filename_prefix: "flux2" } },
  };
}

function pulidNodes(thaboImg: string, nalediImg: string): Record<string, any> {
  return {
    "40": { class_type: "PulidFluxModelLoader", inputs: { pulid_file: PULID_MODEL } },
    "41": { class_type: "PulidFluxEvaClipLoader", inputs: {} },
    "42": { class_type: "PulidFluxInsightFaceLoader", inputs: { provider: "CUDA" } },
    "43": { class_type: "LoadImage", inputs: { image: thaboImg } },
    "44": { class_type: "ApplyPulidFlux", inputs: { model: ["1", 0], pulid_flux: ["40", 0], eva_clip: ["41", 0], face_analysis: ["42", 0], image: ["43", 0], weight: PULID_WEIGHT, start_at: 0.0, end_at: 1.0 } },
    "45": { class_type: "LoadImage", inputs: { image: nalediImg } },
    "46": { class_type: "ApplyPulidFlux", inputs: { model: ["44", 0], pulid_flux: ["40", 0], eva_clip: ["41", 0], face_analysis: ["42", 0], image: ["45", 0], weight: PULID_WEIGHT, start_at: 0.0, end_at: 1.0 } },
  };
}

function buildPulidOnlyWorkflow(prompt: string, seed: number, thaboImg: string, nalediImg: string): Record<string, any> {
  return {
    ...buildBaselineWorkflow(prompt, seed),
    ...pulidNodes(thaboImg, nalediImg),
    // Override sampling to use PuLID-modified model
    "9": { class_type: "BetaSamplingScheduler", inputs: { model: ["46", 0], steps: STEPS, alpha: 0.6, beta: 0.95 } },
    "10": { class_type: "BasicGuider", inputs: { model: ["46", 0], conditioning: ["5", 0] } },
  };
}

function buildPoseOnlyWorkflow(prompt: string, seed: number, poseImg: string, strength: number): Record<string, any> {
  return {
    ...buildBaselineWorkflow(prompt, seed),
    "20": { class_type: "Flux2FunControlNetLoader", inputs: { controlnet_name: CONTROLNET_MODEL } },
    "21": { class_type: "LoadImage", inputs: { image: poseImg } },
    "5": { class_type: "Flux2FunControlNetApply", inputs: { conditioning: ["4", 0], controlnet: ["20", 0], vae: ["3", 0], strength, control_image: ["21", 0] } },
    "6": { class_type: "FluxGuidance", inputs: { conditioning: ["5", 0], guidance: CFG } },
    "10": { class_type: "BasicGuider", inputs: { model: ["1", 0], conditioning: ["6", 0] } },
    // Re-wire sampler to use FluxGuidance output via updated BasicGuider
    "11": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["7", 0], guider: ["10", 0], sampler: ["8", 0], sigmas: ["9", 0], latent_image: ["7b", 0] } },
  };
}

function buildPulidPoseWorkflow(prompt: string, seed: number, thaboImg: string, nalediImg: string, poseImg: string, strength: number): Record<string, any> {
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: UNET, weight_dtype: "fp8_e4m3fn" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: TEXT_ENCODER, type: "flux2" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: VAE } },
    "4": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["2", 0] } },
    // PuLID: face identity → modified model
    ...pulidNodes(thaboImg, nalediImg),
    // ControlNet: pose → modified conditioning
    "20": { class_type: "Flux2FunControlNetLoader", inputs: { controlnet_name: CONTROLNET_MODEL } },
    "21": { class_type: "LoadImage", inputs: { image: poseImg } },
    "5": { class_type: "Flux2FunControlNetApply", inputs: { conditioning: ["4", 0], controlnet: ["20", 0], vae: ["3", 0], strength, control_image: ["21", 0] } },
    // Sampling: PuLID model + ControlNet conditioning
    "6": { class_type: "FluxGuidance", inputs: { conditioning: ["5", 0], guidance: CFG } },
    "7": { class_type: "EmptyFlux2LatentImage", inputs: { width: WIDTH, height: HEIGHT, batch_size: 1 } },
    "8": { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    "9": { class_type: "KSamplerSelect", inputs: { sampler_name: SAMPLER } },
    "10": { class_type: "BetaSamplingScheduler", inputs: { model: ["46", 0], steps: STEPS, alpha: 0.6, beta: 0.95 } },
    "11": { class_type: "BasicGuider", inputs: { model: ["46", 0], conditioning: ["6", 0] } },
    "12": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["8", 0], guider: ["11", 0], sampler: ["9", 0], sigmas: ["10", 0], latent_image: ["7", 0] } },
    "13": { class_type: "VAEDecode", inputs: { samples: ["12", 0], vae: ["3", 0] } },
    "14": { class_type: "SaveImage", inputs: { images: ["13", 0], filename_prefix: "flux2" } },
  };
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

const poseCache = new Map<string, { buffer: Buffer; filename: string }>();
async function getOrRenderPose(poseId: string) {
  if (poseCache.has(poseId)) return poseCache.get(poseId)!;
  const pose = getPoseById(poseId);
  if (!pose) throw new Error(`Pose not found: ${poseId}`);
  const { buffer } = await renderPose(pose, WIDTH, HEIGHT);
  const filename = `pose_${poseId}.png`;
  fs.writeFileSync(path.join(OUTPUT_DIR, filename), buffer);
  poseCache.set(poseId, { buffer, filename });
  return { buffer, filename };
}

async function generatePortrait(name: string, prompt: string, seed: number): Promise<Buffer> {
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
// HTML REPORT
// ─────────────────────────────────────────────

function generateReport(results: TestResult[], thaboFile: string, nalediFile: string): string {
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" }) + ", " + now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  function makeCard(r: TestResult): string {
    const esc = (s: string) => s.replace(/"/g, "&quot;").replace(/`/g, "");
    const imgTag = r.success
      ? `<img src="${r.filename}" loading="lazy" onclick="openModal(this.src, \`${esc(r.name)}\`, \`${esc(r.prompt)}\`)" />`
      : `<div class="filtered">FAILED<br><span>${r.error || "Unknown"}</span></div>`;
    const parts: string[] = [];
    if (r.usePulid) parts.push(`PuLID ${PULID_WEIGHT}`);
    if (r.poseStrength !== null) parts.push(`Pose ${r.poseStrength.toFixed(2)}`);
    const label = parts.length > 0 ? parts.join(" + ") : "No CN/PuLID";
    const badge = r.success ? `\u2713 ${(r.executionTime / 1000).toFixed(1)}s` : "\u2717 FAILED";
    const pulidBadge = r.usePulid ? `<span class="pulid-badge">PuLID</span>` : "";
    const poseThumb = r.poseFilename
      ? `<div class="pose-thumb"><img src="${r.poseFilename}" /><span>${r.poseId}</span></div>`
      : `<div class="pose-thumb"><span class="no-pose">No pose</span></div>`;
    return `<div class="card"><div class="card-images"><div class="card-img">${imgTag}</div>${poseThumb}</div>
      <div class="card-info"><div class="badges">${pulidBadge}<span class="str-badge">${label}</span>
      <span class="badge ${r.success ? "pass" : "fail"}">${badge}</span></div>
      <h3>${r.name}</h3><p class="prompt">${r.prompt.slice(0, 120)}...</p></div></div>`;
  }

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Flux 2 Dev \u2014 PuLID + ControlNet</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>:root{--bg:#0a0607;--surface:#1a1012;--crimson-light:#c4384f;--amber-light:#f5c542;--text:#e8ddd0;--text-muted:#8a7d72;--radius:8px;--purple-light:#b47eff}*{margin:0;padding:0;box-sizing:border-box}body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;line-height:1.6}.header{text-align:center;padding:60px 20px 40px;background:linear-gradient(180deg,#1a0a0e,var(--bg));border-bottom:1px solid rgba(139,26,43,.3)}.header h1{font-family:'Playfair Display',serif;font-size:2.4rem;background:linear-gradient(135deg,var(--amber-light),var(--crimson-light));-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px}.header .sub{color:var(--text-muted);margin-bottom:24px}.stats{display:flex;justify-content:center;gap:40px;margin-top:20px}.stat{text-align:center}.stat .n{font-family:'Playfair Display',serif;font-size:2rem;font-weight:700;color:var(--amber-light)}.stat .l{font-size:.8rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px}.section{max-width:1400px;margin:0 auto;padding:40px 20px}.section h2{font-family:'Playfair Display',serif;font-size:1.8rem;margin-bottom:8px;color:var(--amber-light)}.section .desc{color:var(--text-muted);margin-bottom:24px}.ref-row{display:flex;gap:20px;justify-content:center;flex-wrap:wrap;margin-bottom:32px}.ref-card{background:var(--surface);border-radius:var(--radius);overflow:hidden;border:1px solid rgba(123,77,170,.3);width:220px}.ref-card img{width:100%;aspect-ratio:832/1216;object-fit:cover}.ref-card .lab{padding:10px;text-align:center;font-family:'Playfair Display',serif;color:var(--purple-light)}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:20px}.card{background:var(--surface);border-radius:var(--radius);overflow:hidden;border:1px solid rgba(139,26,43,.15);transition:border-color .2s,transform .2s}.card:hover{border-color:rgba(139,26,43,.4);transform:translateY(-2px)}.card-images{display:flex}.card-img{flex:1;aspect-ratio:832/1216;overflow:hidden;background:#110a0c;display:flex;align-items:center;justify-content:center}.card-img img{width:100%;height:100%;object-fit:cover;cursor:pointer;transition:transform .3s}.card-img img:hover{transform:scale(1.03)}.pose-thumb{width:120px;background:#0d0809;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px;border-left:1px solid rgba(139,26,43,.1)}.pose-thumb img{width:100%;border-radius:4px;opacity:.85}.pose-thumb span{font-size:.65rem;color:var(--text-muted);margin-top:4px}.pose-thumb .no-pose{font-size:.7rem;color:var(--text-muted)}.card-info{padding:16px}.card-info h3{font-family:'Playfair Display',serif;font-size:1rem;margin-bottom:8px}.prompt{font-size:.8rem;color:var(--text-muted);margin-bottom:12px;line-height:1.5}.badges{display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap}.badge{padding:4px 12px;border-radius:20px;font-size:.75rem;font-weight:600}.badge.pass{background:rgba(45,106,79,.2);color:#6fcf97;border:1px solid rgba(45,106,79,.4)}.badge.fail{background:rgba(139,26,43,.2);color:var(--crimson-light);border:1px solid rgba(139,26,43,.4)}.str-badge{padding:4px 12px;border-radius:20px;font-size:.75rem;font-weight:600;background:rgba(212,146,10,.15);color:var(--amber-light);border:1px solid rgba(212,146,10,.3)}.pulid-badge{padding:4px 12px;border-radius:20px;font-size:.75rem;font-weight:600;background:rgba(123,77,170,.15);color:var(--purple-light);border:1px solid rgba(123,77,170,.3)}.filtered{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--crimson-light);font-weight:600;padding:20px;text-align:center}.filtered span{font-size:.75rem;color:var(--text-muted);margin-top:8px}.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:1000;align-items:center;justify-content:center;padding:20px;cursor:pointer}.modal-overlay.active{display:flex}.modal-content{max-width:90vw;max-height:90vh;display:flex;gap:30px;align-items:flex-start;cursor:default}.modal-content img{max-height:85vh;max-width:55vw;object-fit:contain;border-radius:var(--radius)}.modal-details{max-width:400px}.modal-details h3{font-family:'Playfair Display',serif;font-size:1.3rem;margin-bottom:12px;color:var(--amber-light)}.modal-details .full-prompt{font-size:.85rem;color:var(--text-muted);line-height:1.7;white-space:pre-wrap}@media(max-width:768px){.header h1{font-size:1.8rem}.grid{grid-template-columns:1fr}.modal-content{flex-direction:column}.modal-content img{max-width:90vw}.pose-thumb{width:80px}}</style></head><body>
<div class="header"><h1>Flux 2 Dev \u2014 PuLID + ControlNet</h1>
<p class="sub">Face identity (PuLID) + pose control (ControlNet) on RunPod \u2014 ${dateStr}</p>
<div class="stats"><div class="stat"><div class="n">${passed}</div><div class="l">Generated</div></div>
<div class="stat"><div class="n">${failed}</div><div class="l">Failed</div></div>
<div class="stat"><div class="n">${results.length}</div><div class="l">Total</div></div></div></div>
<div class="section"><h2>Character References (PuLID Face Sources)</h2>
<p class="desc">Portraits generated with Flux 2 Dev, then passed to PuLID as face identity references at weight ${PULID_WEIGHT}.</p>
<div class="ref-row">
<div class="ref-card"><img src="${thaboFile}" /><div class="lab">Thabo (male)</div></div>
<div class="ref-card"><img src="${nalediFile}" /><div class="lab">Naledi (female)</div></div></div></div>
<div class="section"><h2>All Tests</h2>
<p class="desc">Baseline, PuLID-only, strength sweep (PuLID+pose 0.40\u20130.80), pose variety, and pose-only comparison.</p>
<div class="grid">${results.map(makeCard).join("\n")}</div></div>
<div class="modal-overlay" id="modal" onclick="closeModal(event)">
<div class="modal-content" onclick="event.stopPropagation()">
<img id="modal-img" /><div class="modal-details"><h3 id="modal-title"></h3><div class="full-prompt" id="modal-prompt"></div></div></div></div>
<script>function openModal(s,t,p){document.getElementById('modal').classList.add('active');document.getElementById('modal-img').src=s;document.getElementById('modal-title').textContent=t;document.getElementById('modal-prompt').textContent=p}function closeModal(e){if(e.target===document.getElementById('modal'))document.getElementById('modal').classList.remove('active')}document.addEventListener('keydown',e=>{if(e.key==='Escape')document.getElementById('modal').classList.remove('active')})</script></body></html>`;
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

async function main() {
  if (!process.env.RUNPOD_ENDPOINT_ID || !process.env.RUNPOD_API_KEY) {
    console.error("ERROR: Missing RUNPOD env vars");
    process.exit(1);
  }

  console.log("=".repeat(60));
  console.log("  Flux 2 Dev \u2014 PuLID + ControlNet Test");
  console.log("=".repeat(60));
  console.log(`  Endpoint:     ${process.env.RUNPOD_ENDPOINT_ID}`);
  console.log(`  UNET:         ${UNET}`);
  console.log(`  ControlNet:   ${CONTROLNET_MODEL}`);
  console.log(`  PuLID:        ${PULID_MODEL} (weight ${PULID_WEIGHT})`);
  console.log(`  Size:         ${WIDTH}x${HEIGHT}, ${STEPS} steps, CFG ${CFG}`);
  console.log(`  Tests:        2 portraits + ${TESTS.length} scene tests`);
  console.log("=".repeat(60));

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const portraitSeed = Math.floor(Math.random() * 1_000_000);

  // ═══ PHASE 1: Portraits ═══
  console.log("\n\u2501\u2501\u2501 PHASE 1: Character Portraits \u2501\u2501\u2501");
  const thaboBuffer = await generatePortrait("Thabo", THABO_PORTRAIT, portraitSeed);
  const thaboFile = "ref_thabo.png";
  fs.writeFileSync(path.join(OUTPUT_DIR, thaboFile), thaboBuffer);

  const nalediBuffer = await generatePortrait("Naledi", NALEDI_PORTRAIT, portraitSeed + 1);
  const nalediFile = "ref_naledi.png";
  fs.writeFileSync(path.join(OUTPUT_DIR, nalediFile), nalediBuffer);

  // ═══ PHASE 2: Scene Tests ═══
  console.log("\n\u2501\u2501\u2501 PHASE 2: Scene Tests \u2501\u2501\u2501");
  const results: TestResult[] = [];
  const baseSeed = Math.floor(Math.random() * 1_000_000);

  for (let i = 0; i < TESTS.length; i++) {
    const test = TESTS[i];
    const seed = i < 6 ? baseSeed : baseSeed + i;
    console.log(`\n\u2501\u2501\u2501 [${i + 1}/${TESTS.length}] ${test.name} \u2501\u2501\u2501`);

    const filename = `${test.id}.png`;
    try {
      let workflow: Record<string, any>;
      let images: Array<{ name: string; image: string }> = [];
      let poseFilename: string | null = null;

      if (!test.usePulid && test.poseStrength === null) {
        workflow = buildBaselineWorkflow(test.prompt, seed);
        console.log("  Mode: baseline");
      } else if (test.usePulid && test.poseStrength === null) {
        workflow = buildPulidOnlyWorkflow(test.prompt, seed, thaboFile, nalediFile);
        images.push({ name: thaboFile, image: thaboBuffer.toString("base64") }, { name: nalediFile, image: nalediBuffer.toString("base64") });
        console.log("  Mode: PuLID only");
      } else if (!test.usePulid) {
        const pd = await getOrRenderPose(test.poseId);
        poseFilename = pd.filename;
        workflow = buildPoseOnlyWorkflow(test.prompt, seed, pd.filename, test.poseStrength!);
        images.push({ name: pd.filename, image: pd.buffer.toString("base64") });
        console.log(`  Mode: pose only (${test.poseId} @ ${test.poseStrength})`);
      } else {
        const pd = await getOrRenderPose(test.poseId);
        poseFilename = pd.filename;
        workflow = buildPulidPoseWorkflow(test.prompt, seed, thaboFile, nalediFile, pd.filename, test.poseStrength!);
        images.push({ name: thaboFile, image: thaboBuffer.toString("base64") }, { name: nalediFile, image: nalediBuffer.toString("base64") }, { name: pd.filename, image: pd.buffer.toString("base64") });
        console.log(`  Mode: PuLID + pose (${test.poseId} @ ${test.poseStrength})`);
      }

      const { jobId } = await submitRunPodJob(workflow, images.length > 0 ? images : undefined);
      console.log(`  Job: ${jobId}`);
      const { imageBase64, executionTime } = await waitForRunPodResult(jobId, 600_000, 5_000);
      fs.writeFileSync(path.join(OUTPUT_DIR, filename), base64ToBuffer(imageBase64));
      console.log(`  \u2713 Saved (${(executionTime / 1000).toFixed(1)}s)`);
      results.push({ ...test, success: true, error: null, executionTime, filename, poseFilename });
    } catch (err: any) {
      console.log(`  \u2717 Failed: ${err.message}`);
      results.push({ ...test, success: false, error: err.message, executionTime: 0, filename, poseFilename: null });
    }
  }

  // ═══ Report ═══
  console.log("\n\u2501\u2501\u2501 REPORT \u2501\u2501\u2501");
  fs.writeFileSync(path.join(OUTPUT_DIR, "report.html"), generateReport(results, thaboFile, nalediFile));
  fs.writeFileSync(path.join(OUTPUT_DIR, "results.json"), JSON.stringify(results, null, 2));
  console.log("\n" + "=".repeat(60));
  for (const r of results) {
    const icon = r.success ? "\u2713" : "\u2717";
    const time = r.success ? `${(r.executionTime / 1000).toFixed(1)}s` : "FAILED";
    const mode = [r.usePulid ? "pulid" : "", r.poseStrength !== null ? `pose ${r.poseStrength}` : ""].filter(Boolean).join("+") || "baseline";
    console.log(`  ${icon} ${r.id}: [${mode}] [${time}]`);
  }
  console.log(`\n  ${results.filter(r => r.success).length}/${results.length} generated`);
  console.log(`  open ${path.resolve(OUTPUT_DIR, "report.html")}`);
  console.log("=".repeat(60));
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
