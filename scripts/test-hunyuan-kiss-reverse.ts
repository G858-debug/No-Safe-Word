/**
 * No Safe Word — Hunyuan Kiss + Reverse POV Test
 * ================================================
 * Part A: Deep kissing scene × 3 seeds — tests character consistency
 *         when both faces are visible simultaneously.
 * Part B: Reverse POV × 3 seeds — man (Sibusiso) foregrounded and visible,
 *         Black woman anonymous (back to camera, face hidden).
 *
 * Usage:
 *   npx tsx scripts/test-hunyuan-kiss-reverse.ts
 *
 * Output:
 *   ./hunyuan3_results/kiss-reverse/   — images + report.html
 */

import * as fs from "fs";
import * as path from "path";
import Replicate from "replicate";

// ── Load .env.local ──
const envPath = path.resolve(__dirname, "../.env.local");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

const client = new Replicate();

const OUTPUT_DIR = "./hunyuan3_results/kiss-reverse";
const MODEL = "tencent/hunyuan-image-3" as `${string}/${string}`;
const SEEDS_PER_SCENE = 3;

// ─────────────────────────────────────────────
// CHARACTER DESCRIPTIONS
// ─────────────────────────────────────────────

// Lindiwe — physical description stripped of portrait framing
const LINDIWE =
  "A Black South African woman, age 24, medium-brown skin, dark brown eyes, " +
  "oval face with high cheekbones, full lips, broad nose, expressive eyes with " +
  "long lashes, flawless skin. Extremely voluptuous body — very large heavy " +
  "breasts, deep cleavage, tiny narrow waist, very wide hips, large round " +
  "protruding backside. Long black braids loose over her shoulders.";

// Sibusiso — physical description
const SIBUSISO =
  "A dark-skinned Black South African man, age 28, very dark skin, strong broad jaw, " +
  "deep-set dark eyes, muscular build with broad chest and powerful shoulders, " +
  "large strong hands with working calluses.";

// ─────────────────────────────────────────────
// SCENES
// ─────────────────────────────────────────────

interface Scene {
  id: string;
  name: string;
  description: string; // for the report
  prompt: string;
}

const SCENES: Scene[] = [
  // ── PART A: KISSING ──
  {
    id: "kiss_workshop",
    name: "Kiss A: Workshop — Deep Kiss at Workbench",
    description:
      "Character consistency test: both faces visible in a deep kiss. " +
      "Setting: Sibusiso's Middelburg workshop after closing (THE SYSTEM ep5).",
    prompt:
      `${LINDIWE} ${SIBUSISO} ` +
      "The couple kiss deeply inside the mechanic workshop after closing. " +
      "She leans back against the workbench, both hands gripping the front of his " +
      "vest, pulling him in. Her head is tilted back and to the right, lips parted " +
      "wide and pressed into his mouth in a slow, consuming open-mouthed kiss — " +
      "both mouths visibly open, deep and unhurried. His left hand cups the back of " +
      "her jaw, thumb along her cheekbone, angling her face into the kiss. His right " +
      "hand presses flat on the workbench beside her hip. His overalls are unzipped " +
      "to the waist over a white vest damp at the collar. Her fitted top has slipped " +
      "off one shoulder, collarbone bare. Both eyes are closed. Their faces fill the " +
      "frame — her medium-brown face tilted right, his very dark face tilted left, " +
      "mouths locked at the centre. " +
      "Middelburg mechanic workshop interior, after closing. Single fluorescent strip " +
      "light overhead, clean white-blue light across both faces, hard shadows under " +
      "their chins and along his jaw. Bay door rolled down behind them. Tools on the " +
      "wall out of focus. " +
      "Tight two-shot, close crop on both faces and upper shoulders from slightly to " +
      "the side, her face more toward camera, his jaw and lips in profile-near. " +
      "Shallow depth of field blurring everything behind. Photorealistic, cinematic, " +
      "8k editorial photography.",
  },

  // ── PART B: REVERSE POV — MAN VISIBLE, WOMAN ANONYMOUS ──
  {
    id: "reverse_bedroom_cowgirl",
    name: "Reverse B: Bedroom — Cowgirl Facing Him",
    description:
      "Man (Sibusiso) foregrounded and fully visible, dark-skinned Black woman " +
      "anonymous — back to camera, face hidden. Cowgirl position. " +
      "Setting: Sibusiso's Middelburg bedroom (THE FRONTRUNNER ep6).",
    prompt:
      `${SIBUSISO} ` +
      "He sits upright on the edge of a bed, leaning back slightly, both arms braced " +
      "behind him on the mattress. He looks directly at the camera with a heavy-lidded, " +
      "overwhelmed expression — lips slightly parted, jaw slack, eyes dark and intense. " +
      "His very dark muscular chest is bare, broad shoulders catching the warm amber " +
      "sidelight. A dark-skinned Black woman straddles him in a cowgirl position, " +
      "facing him — her back and large round backside face the camera completely. " +
      "Her face is hidden behind him, turned away or buried in his neck. Only her " +
      "very wide hips, large round dark-skinned backside, thick thighs, and her " +
      "dark hands pressing into his chest on either side are visible. His dark " +
      "thick erect penis is visible at the base where it disappears up into her, " +
      "entering from below. Her body is fully seated on him, hips pressed down. " +
      "Middelburg flat bedroom, night. Single bedside lamp on the left throws warm " +
      "amber light across his face and bare chest, catching the line of his jaw and " +
      "the deep shadows between his pectoral muscles. The rest of the room falls into " +
      "dark shadow. African print headboard visible behind him. " +
      "Close medium shot from the front, framing his face and the couple from mid-thigh " +
      "upward. His face is the focal point. Shallow depth of field. Photorealistic, " +
      "cinematic, 8k editorial photography.",
  },
  {
    id: "reverse_window_standing",
    name: "Reverse C: Apartment Window — Standing, She Faces Wall",
    description:
      "Man (Sibusiso) visible facing camera, dark-skinned Black woman pressed " +
      "against him facing away — only her back, ass, hands visible. " +
      "Setting: high-rise apartment, city lights through glass.",
    prompt:
      `${SIBUSISO} ` +
      "He stands facing the camera inside a high-floor Johannesburg apartment, " +
      "positioned against the floor-to-ceiling glass window with the city skyline " +
      "glowing behind him far below. His expression is intense — jaw set, dark eyes " +
      "fixed on the camera, lips parted with effort and pleasure. His bare muscular " +
      "chest and broad shoulders are the focal point of the upper frame. His very " +
      "dark muscular arms reach forward, large hands gripping wide dark-skinned hips. " +
      "A dark-skinned Black woman is pressed face-first against the cool glass in " +
      "front of him, her back to the camera — only her very wide hips, large round " +
      "dark backside, and both palms flat against the glass on either side of her " +
      "head are visible. Her face is turned into the glass, completely hidden. " +
      "His dark thick erect penis penetrates her from behind — visible at the base " +
      "where his body meets hers, entering her from the same direction as the camera. " +
      "Pale blue-grey city light floods in from outside the glass, washing cool tones " +
      "across his very dark skin and the woman's back. Warm amber from a single room " +
      "lamp behind him illuminates his shoulders from behind, creating a rim-light " +
      "contrast. Johannesburg skyline glowing orange and blue through the glass in " +
      "the background. " +
      "Medium shot from the front, his face and the couple's bodies from mid-thigh " +
      "upward, his face dominant in the upper frame, shallow depth of field blurring " +
      "the city lights behind the glass. Photorealistic, cinematic, 8k editorial " +
      "photography.",
  },
  {
    id: "reverse_workshop_standing",
    name: "Reverse D: Workshop — Standing, She Bends Over Workbench",
    description:
      "Man (Sibusiso) visible facing camera, dark-skinned Black woman bent over " +
      "the workbench away from camera — face hidden. " +
      "Setting: Middelburg workshop, fluorescent light.",
    prompt:
      `${SIBUSISO} ` +
      "He stands in the mechanic workshop facing the camera, positioned directly " +
      "behind a woman bent forward over the workbench. His expression is focused " +
      "and overwhelmed — dark eyes looking just above the camera with lips parted, " +
      "jaw tense, chest heaving slightly. His very dark muscular bare torso fills " +
      "the upper frame, powerful arms reaching forward. His large dark hands grip " +
      "very wide dark-skinned hips firmly on both sides, thumbs pressing into skin. " +
      "A dark-skinned Black woman leans forward across the workbench in front of " +
      "him — only her very wide hips and large round dark backside, her braids " +
      "hanging forward over the bench surface, and her forearms braced on the bench " +
      "are visible. Her face is completely hidden, turned down toward the bench. " +
      "His dark thick erect penis penetrates her from behind — the base visible " +
      "where his hips press into her, the shaft entering from the camera's direction. " +
      "Middelburg mechanic workshop interior, after closing. Single fluorescent strip " +
      "light overhead throws harsh clean white-blue light directly down onto both of " +
      "them, catching the musculature of his chest and arms, his jaw, the curve of " +
      "her backside. Oil-stained concrete floor. Tools on the wall behind him. Bay " +
      "door rolled down in the background. " +
      "Medium shot from the front, his face and the couple from mid-thigh upward, " +
      "his face and chest dominant, shallow depth of field blurring the workshop " +
      "behind him. Photorealistic, cinematic, 8k editorial photography.",
  },
];

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function extractUrl(output: unknown): string | null {
  if (!output) return null;
  if (typeof output === "string") return output;
  if (typeof output === "object" && "url" in (output as object)) {
    const url = (output as { url: () => string }).url();
    return typeof url === "string" ? url : String(url);
  }
  if (Array.isArray(output) && output.length > 0) return extractUrl(output[0]);
  return String(output);
}

async function downloadImage(url: string, savePath: string): Promise<boolean> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(90_000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    fs.writeFileSync(savePath, Buffer.from(await resp.arrayBuffer()));
    return true;
  } catch (err) {
    console.error(`  Download failed: ${err}`);
    return false;
  }
}

interface Result {
  sceneId: string;
  sceneName: string;
  part: "kiss" | "reverse";
  seed: number;
  filename: string;
  success: boolean;
  filtered: boolean;
  error: string | null;
  executionTime: number;
}

// ─────────────────────────────────────────────
// HTML REPORT
// ─────────────────────────────────────────────

function generateReport(results: Result[], scenes: Scene[]): string {
  const passed = results.filter((r) => r.success).length;
  const filtered = results.filter((r) => r.filtered).length;
  const dateStr = new Date().toLocaleString("en-GB");

  const byScene = new Map<string, Result[]>();
  for (const r of results) {
    if (!byScene.has(r.sceneId)) byScene.set(r.sceneId, []);
    byScene.get(r.sceneId)!.push(r);
  }

  let html = "";
  let currentPart = "";

  for (const scene of scenes) {
    const part = scene.id.startsWith("kiss") ? "A" : "B";
    const partLabel = part === "A" ? "Part A — Kissing (Character Consistency Test)" : "Part B — Reverse POV (Man Visible, Woman Anonymous)";

    if (part !== currentPart) {
      html += `<div class="part-header"><h2>${partLabel}</h2></div>`;
      currentPart = part;
    }

    const sceneResults = byScene.get(scene.id) || [];
    const seedCols = sceneResults
      .map((r) => {
        const imgHtml = r.success
          ? `<img src="${r.filename}" loading="lazy" onclick="openModal(this.src,'${scene.name} — seed ${r.seed}')" />`
          : `<div class="filtered">${r.filtered ? "⚠ FILTERED" : "✗ FAILED"}<br><span>${r.error || ""}</span></div>`;
        const badge = r.success
          ? `<span class="badge pass">✓ ${(r.executionTime / 1000).toFixed(1)}s</span>`
          : r.filtered
            ? `<span class="badge filtered-badge">Filtered</span>`
            : `<span class="badge fail">Failed</span>`;
        return `<div class="img-col">
          <div class="seed-label">Seed ${r.seed}</div>
          <div class="img-wrapper">${imgHtml}</div>
          ${badge}
        </div>`;
      })
      .join("\n");

    html += `
      <div class="scene-block">
        <div class="scene-header">
          <h3>${scene.name}</h3>
          <p class="desc">${scene.description}</p>
        </div>
        <div class="seed-grid" style="grid-template-columns:repeat(${Math.min(sceneResults.length, 3)},1fr)">${seedCols}</div>
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hunyuan Kiss + Reverse POV — The Lobola List</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{--bg:#0a0607;--surface:#1a1012;--crimson:#8b1a2b;--crimson-light:#c4384f;--amber:#d4920a;--amber-light:#f5c542;--text:#e8ddd0;--text-muted:#8a7d72;--radius:8px}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;line-height:1.6}
  .header{text-align:center;padding:60px 20px 40px;background:linear-gradient(180deg,#1a0a0e 0%,var(--bg) 100%);border-bottom:1px solid rgba(139,26,43,0.3)}
  .header h1{font-family:'Playfair Display',serif;font-size:2.2rem;font-weight:700;background:linear-gradient(135deg,var(--amber-light),var(--crimson-light));-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px}
  .header .subtitle{color:var(--text-muted);font-size:.95rem}
  .stats{display:flex;justify-content:center;gap:40px;margin-top:20px}
  .stat .number{font-family:'Playfair Display',serif;font-size:2rem;color:var(--amber-light)}
  .stat .label{font-size:.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px}
  .section{max-width:1400px;margin:0 auto;padding:40px 20px}
  .part-header{margin:40px 0 16px}
  .part-header h2{font-family:'Playfair Display',serif;font-size:1.5rem;color:var(--crimson-light);border-bottom:1px solid rgba(139,26,43,0.3);padding-bottom:10px}
  .scene-block{background:var(--surface);border:1px solid rgba(139,26,43,0.15);border-radius:var(--radius);margin-bottom:28px;overflow:hidden}
  .scene-header{padding:18px 24px 10px}
  .scene-header h3{font-family:'Playfair Display',serif;font-size:1.15rem;color:var(--amber-light);margin-bottom:4px}
  .desc{font-size:.78rem;color:var(--text-muted);line-height:1.5}
  .seed-grid{display:grid;gap:16px;padding:12px 24px 20px}
  .img-col{text-align:center}
  .seed-label{font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:6px}
  .img-wrapper{aspect-ratio:2/3;overflow:hidden;background:#110a0c;border-radius:var(--radius);display:flex;align-items:center;justify-content:center}
  .img-wrapper img{width:100%;height:100%;object-fit:cover;cursor:pointer;transition:transform .3s}
  .img-wrapper img:hover{transform:scale(1.03)}
  .filtered{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:repeating-linear-gradient(-45deg,transparent,transparent 10px,rgba(139,26,43,.08) 10px,rgba(139,26,43,.08) 20px);color:var(--crimson-light);font-weight:600;font-size:1rem;padding:20px;text-align:center}
  .filtered span{font-size:.72rem;color:var(--text-muted);font-weight:400;margin-top:8px}
  .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.72rem;font-weight:600;margin-top:6px}
  .badge.pass{background:rgba(45,106,79,.2);color:#6fcf97;border:1px solid rgba(45,106,79,.4)}
  .badge.fail,.badge.filtered-badge{background:rgba(139,26,43,.2);color:var(--crimson-light);border:1px solid rgba(139,26,43,.4)}
  .modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:1000;align-items:center;justify-content:center;padding:20px;cursor:pointer}
  .modal-overlay.active{display:flex}
  .modal-content{max-width:90vw;max-height:90vh;display:flex;gap:24px;align-items:flex-start;cursor:default}
  .modal-content img{max-height:88vh;max-width:65vw;object-fit:contain;border-radius:var(--radius)}
  .modal-details{max-width:360px}
  .modal-details h3{font-family:'Playfair Display',serif;font-size:1.1rem;color:var(--amber-light)}
  @media(max-width:800px){.seed-grid{grid-template-columns:1fr!important}.modal-content{flex-direction:column}.modal-content img{max-width:90vw}}
</style>
</head>
<body>
<div class="header">
  <h1>Hunyuan Kiss + Reverse POV Test</h1>
  <p class="subtitle">Part A: character consistency in kissing · Part B: man visible, woman anonymous · ${dateStr}</p>
  <div class="stats">
    <div class="stat"><div class="number">${passed}</div><div class="label">Generated</div></div>
    <div class="stat"><div class="number">${filtered}</div><div class="label">Filtered</div></div>
    <div class="stat"><div class="number">${results.length}</div><div class="label">Total</div></div>
  </div>
</div>
<div class="section">${html}</div>
<div class="modal-overlay" id="modal" onclick="closeModal(event)">
  <div class="modal-content" onclick="event.stopPropagation()">
    <img id="modal-img" src="" />
    <div class="modal-details"><h3 id="modal-title"></h3></div>
  </div>
</div>
<script>
  function openModal(src,title){document.getElementById('modal').classList.add('active');document.getElementById('modal-img').src=src;document.getElementById('modal-title').textContent=title}
  function closeModal(e){if(e.target===document.getElementById('modal'))document.getElementById('modal').classList.remove('active')}
  document.addEventListener('keydown',(e)=>{if(e.key==='Escape')document.getElementById('modal').classList.remove('active')})
</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

async function main() {
  if (!process.env.REPLICATE_API_TOKEN) {
    console.error("ERROR: REPLICATE_API_TOKEN not found in .env.local");
    process.exit(1);
  }

  // Kiss scene gets 3 seeds; reverse scenes each get 1 seed (3 scenes = 3 images)
  const kissScene = SCENES.find((s) => s.id === "kiss_workshop")!;
  const reverseScenes = SCENES.filter((s) => s.id !== "kiss_workshop");

  const totalGenerations = SEEDS_PER_SCENE + reverseScenes.length;

  console.log("=".repeat(60));
  console.log("  Hunyuan Kiss + Reverse POV Test");
  console.log("=".repeat(60));
  console.log(`  Part A: 1 kissing scene × ${SEEDS_PER_SCENE} seeds`);
  console.log(`  Part B: ${reverseScenes.length} reverse POV scenes × 1 seed each`);
  console.log(`  Total:  ${totalGenerations} generations`);
  console.log("=".repeat(60));

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const results: Result[] = [];
  const baseSeed = Math.floor(Math.random() * 1_000_000);
  let genIndex = 0;

  // ── Part A: kissing × 3 seeds ──
  console.log(`\n━━━ PART A: KISSING ━━━`);
  console.log(`  ${kissScene.name}`);

  for (let s = 0; s < SEEDS_PER_SCENE; s++) {
    const seed = baseSeed + genIndex;
    genIndex++;
    console.log(`\n  [${genIndex}/${totalGenerations}] Seed ${seed}...`);

    const filename = `${kissScene.id}_seed${seed}.png`;
    const savePath = path.join(OUTPUT_DIR, filename);
    const start = Date.now();
    let url: string | null = null;
    let error: string | null = null;

    try {
      const output = await client.run(MODEL, {
        input: {
          prompt: kissScene.prompt,
          seed,
          go_fast: true,
          aspect_ratio: "2:3",
          output_format: "png",
          output_quality: 95,
          disable_safety_checker: true,
        },
      });
      url = extractUrl(output);
    } catch (err) {
      error = String(err);
      console.error(`  ERROR: ${error}`);
    }

    const elapsed = Date.now() - start;
    if (url) {
      const ok = await downloadImage(url, savePath);
      if (ok) {
        console.log(`  ✓ Saved: ${filename} (${(elapsed / 1000).toFixed(1)}s)`);
        results.push({ sceneId: kissScene.id, sceneName: kissScene.name, part: "kiss", seed, filename, success: true, filtered: false, error: null, executionTime: elapsed });
      } else {
        results.push({ sceneId: kissScene.id, sceneName: kissScene.name, part: "kiss", seed, filename, success: false, filtered: false, error: "Download failed", executionTime: elapsed });
      }
    } else {
      const filtered = !error;
      console.log(`  ${filtered ? "⚠ Filtered" : "✗ Failed"} (${(elapsed / 1000).toFixed(1)}s)`);
      results.push({ sceneId: kissScene.id, sceneName: kissScene.name, part: "kiss", seed, filename, success: false, filtered, error: error || "No image returned", executionTime: elapsed });
    }

    if (genIndex < totalGenerations) await new Promise((r) => setTimeout(r, 1500));
  }

  // ── Part B: reverse POV × 1 seed each ──
  console.log(`\n━━━ PART B: REVERSE POV ━━━`);

  for (const scene of reverseScenes) {
    const seed = baseSeed + genIndex;
    genIndex++;
    console.log(`\n  [${genIndex}/${totalGenerations}] ${scene.name} — Seed ${seed}...`);

    const filename = `${scene.id}_seed${seed}.png`;
    const savePath = path.join(OUTPUT_DIR, filename);
    const start = Date.now();
    let url: string | null = null;
    let error: string | null = null;

    try {
      const output = await client.run(MODEL, {
        input: {
          prompt: scene.prompt,
          seed,
          go_fast: true,
          aspect_ratio: "2:3",
          output_format: "png",
          output_quality: 95,
          disable_safety_checker: true,
        },
      });
      url = extractUrl(output);
    } catch (err) {
      error = String(err);
      console.error(`  ERROR: ${error}`);
    }

    const elapsed = Date.now() - start;
    if (url) {
      const ok = await downloadImage(url, savePath);
      if (ok) {
        console.log(`  ✓ Saved: ${filename} (${(elapsed / 1000).toFixed(1)}s)`);
        results.push({ sceneId: scene.id, sceneName: scene.name, part: "reverse", seed, filename, success: true, filtered: false, error: null, executionTime: elapsed });
      } else {
        results.push({ sceneId: scene.id, sceneName: scene.name, part: "reverse", seed, filename, success: false, filtered: false, error: "Download failed", executionTime: elapsed });
      }
    } else {
      const filtered = !error;
      console.log(`  ${filtered ? "⚠ Filtered" : "✗ Failed"} (${(elapsed / 1000).toFixed(1)}s)`);
      results.push({ sceneId: scene.id, sceneName: scene.name, part: "reverse", seed, filename, success: false, filtered, error: error || "No image returned", executionTime: elapsed });
    }

    if (genIndex < totalGenerations) await new Promise((r) => setTimeout(r, 1500));
  }

  // ── Report ──
  console.log("\n\n━━━ WRITING REPORT ━━━");
  const html = generateReport(results, SCENES);
  const reportPath = path.join(OUTPUT_DIR, "report.html");
  fs.writeFileSync(reportPath, html);
  console.log(`✓ Report: ${reportPath}`);
  fs.writeFileSync(path.join(OUTPUT_DIR, "results.json"), JSON.stringify(results, null, 2));

  // ── Summary ──
  const passed = results.filter((r) => r.success).length;
  const filtered = results.filter((r) => r.filtered).length;
  console.log("\n" + "=".repeat(60));
  console.log("  RESULTS");
  console.log("=".repeat(60));
  for (const r of results) {
    const icon = r.success ? "✓" : r.filtered ? "⚠" : "✗";
    const label = r.success ? `${(r.executionTime / 1000).toFixed(1)}s` : r.filtered ? "FILTERED" : "FAILED";
    console.log(`  ${icon} [seed ${r.seed}] ${r.sceneName.split(":")[0]} [${label}]`);
  }
  console.log(`\n  Total: ${passed}/${totalGenerations} generated, ${filtered} filtered`);
  console.log(`\n  open ${path.resolve(reportPath)}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
