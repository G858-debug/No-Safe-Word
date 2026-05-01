/**
 * No Safe Word — Hunyuan BJ Couch POV Test
 * ==========================================
 * POV blowjob, couch setting. He's seated watching TV, she kneels in front.
 * Camera is from his perspective looking DOWN at her upturned face.
 *
 * Variation 1: no hands (confirmed working from prior test)
 * Variation 2: one arm guiding her head — arm explicitly descends from
 *              ABOVE, from the same direction as the camera, not from sides.
 *
 * 2 seeds per variation = 4 total.
 *
 * Usage:
 *   npx tsx scripts/test-hunyuan-bj-couch.ts
 *
 * Output:
 *   ./hunyuan3_results/bj-couch/
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

const OUTPUT_DIR = "./hunyuan3_results/bj-couch";
const MODEL = "tencent/hunyuan-image-3" as `${string}/${string}`;

// ── Lindiwe — physical description stripped of portrait framing ──
const LINDIWE =
  "A Black South African woman, age 24, medium-brown skin, dark brown eyes, " +
  "oval face with high cheekbones, full lips, broad nose, expressive eyes with " +
  "long lashes, flawless skin. Extremely voluptuous body — very large heavy " +
  "breasts, deep cleavage, tiny narrow waist, very wide hips, large round " +
  "protruding backside. Long black braids loose over her shoulders.";

// ── Setting shared across both variations ──
const SETTING =
  "South African living room, late evening. A large couch in the background. " +
  "A television is on — its cool blue-white light flickers across the room, " +
  "providing the main illumination. The TV light washes up from behind and " +
  "catches the top of her upturned head, her braids, and the shaft. " +
  "The rest of the room is dim with warm ambient light from a side lamp. " +
  "Everyday domestic interior — carpet floor, couch cushions at the top of frame.";

interface Scene {
  id: string;
  name: string;
  description: string;
  prompt: string;
}

const SCENES: Scene[] = [
  {
    id: "bj_couch_bare",
    name: "Couch BJ — No Hands",
    description:
      "POV from above (his seated perspective). Her face fully upturned, eyes looking " +
      "up at camera, lips around his cock. No hands. TV light from behind. 2 seeds.",
    prompt:
      `${LINDIWE} ` +
      "She kneels on the carpet floor between a man's legs in front of a couch, " +
      "fully nude. Shot from directly above — the camera at his eye-level looking " +
      "straight down at her, his POV. Her face is tilted completely upward, chin " +
      "raised high, throat fully exposed, looking directly up into the camera with " +
      "dark heavy-lidded eyes. Her lips are parted and wrapped around a dark thick " +
      "erect penis that descends from the very top of frame downward into her mouth — " +
      "the shaft vertical in frame, her lips sealed around it, cheeks slightly " +
      "hollowed. Her gaze holds direct eye contact with the camera even as she " +
      "takes the cock. Her long black braids fall loose behind her and down her " +
      "bare back. Her voluptuous nude body kneels below — very large heavy breasts " +
      "hanging, hands resting on her thick thighs. " +
      "No hands are visible. The anonymous man above frame is entirely absent " +
      "except for his dark cock descending from the top of frame. Only the shaft " +
      "and the base where it meets her lips are visible. " +
      `${SETTING} ` +
      "Shot from directly above, tight crop on her upturned face, throat, and the " +
      "cock in her mouth. POV perspective looking straight down. The couch cushions " +
      "and TV glow visible at the very top edge of frame. Shallow depth of field. " +
      "Photorealistic, cinematic, 8k editorial photography.",
  },
  {
    id: "bj_couch_arm",
    name: "Couch BJ — One Arm Guiding From Above",
    description:
      "Same scene. One dark arm descends from directly above — same direction and " +
      "angle as the camera — gripping her braids from the top of her skull. " +
      "NOT from the side. The arm comes from behind the camera toward her. 2 seeds.",
    prompt:
      `${LINDIWE} ` +
      "She kneels on the carpet floor between a man's legs in front of a couch, " +
      "fully nude. Shot from directly above — the camera at his eye-level looking " +
      "straight down at her, his POV. Her face is tilted completely upward, chin " +
      "raised, throat exposed, looking directly up at the camera with dark " +
      "heavy-lidded eyes. Her lips are parted and wrapped around a dark thick " +
      "erect penis that descends from the top of frame straight down into her " +
      "open mouth. Her lips sealed around the shaft, cheeks slightly hollowed. " +
      "Her long black braids fall loose behind her. Her voluptuous nude body " +
      "kneels below, large heavy breasts hanging, hands on her thighs. " +
      "One large very dark hand descends from directly above — from the same " +
      "direction and angle as the camera itself, as if the hand belongs to the " +
      "viewer — fingers wound firmly into her black braids at the crown of her " +
      "head, palm pressing downward. The arm comes from straight above the " +
      "camera's viewpoint, not from the side, not from the left or right — " +
      "directly overhead, the same axis as the shot. The hand grips and gently " +
      "pushes her head down onto the cock. Her expression remains looking up " +
      "past the gripping hand directly at the camera. " +
      "The anonymous man is otherwise entirely off-frame — only his dark cock " +
      "and this one dark arm + hand from directly above are present in the image. " +
      `${SETTING} ` +
      "Shot from directly above, tight crop on her upturned face, the cock, and " +
      "the gripping hand descending from directly overhead into the top-centre of " +
      "frame. POV perspective straight down. Couch cushions at the very top edge " +
      "of frame. Shallow depth of field. Photorealistic, cinematic, 8k editorial " +
      "photography.",
  },
];

const SEEDS_PER_SCENE = 2;

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
  seed: number;
  filename: string;
  success: boolean;
  filtered: boolean;
  error: string | null;
  executionTime: number;
}

function generateReport(results: Result[]): string {
  const passed = results.filter((r) => r.success).length;
  const filtered = results.filter((r) => r.filtered).length;
  const dateStr = new Date().toLocaleString("en-GB");

  const byScene = new Map<string, Result[]>();
  for (const r of results) {
    if (!byScene.has(r.sceneId)) byScene.set(r.sceneId, []);
    byScene.get(r.sceneId)!.push(r);
  }

  let sceneHtml = "";
  for (const scene of SCENES) {
    const sceneResults = byScene.get(scene.id) || [];
    const cols = sceneResults.map((r) => {
      const img = r.success
        ? `<img src="${r.filename}" loading="lazy" onclick="openModal(this.src,'${scene.name} — seed ${r.seed}')" />`
        : `<div class="filtered">${r.filtered ? "⚠ FILTERED" : "✗ FAILED"}<br><span>${r.error || ""}</span></div>`;
      const badge = r.success
        ? `<span class="badge pass">✓ ${(r.executionTime / 1000).toFixed(1)}s</span>`
        : `<span class="badge fail">${r.filtered ? "Filtered" : "Failed"}</span>`;
      return `<div class="img-col">
        <div class="seed-label">Seed ${r.seed}</div>
        <div class="img-wrapper">${img}</div>${badge}
      </div>`;
    }).join("\n");

    sceneHtml += `
      <div class="scene-block">
        <div class="scene-header">
          <h3>${scene.name}</h3>
          <p class="desc">${scene.description}</p>
        </div>
        <div class="seed-grid" style="grid-template-columns:repeat(${Math.min(sceneResults.length, 3)},1fr)">${cols}</div>
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hunyuan BJ Couch POV</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{--bg:#0a0607;--surface:#1a1012;--crimson-light:#c4384f;--amber-light:#f5c542;--text:#e8ddd0;--text-muted:#8a7d72;--radius:8px}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif}
  .header{text-align:center;padding:60px 20px 40px;background:linear-gradient(180deg,#1a0a0e,var(--bg));border-bottom:1px solid rgba(139,26,43,.3)}
  .header h1{font-family:'Playfair Display',serif;font-size:2rem;background:linear-gradient(135deg,var(--amber-light),var(--crimson-light));-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px}
  .header .subtitle{color:var(--text-muted);font-size:.88rem}
  .stats{display:flex;justify-content:center;gap:40px;margin-top:20px}
  .stat .number{font-family:'Playfair Display',serif;font-size:2rem;color:var(--amber-light)}
  .stat .label{font-size:.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px}
  .section{max-width:1000px;margin:0 auto;padding:40px 20px}
  .scene-block{background:var(--surface);border:1px solid rgba(139,26,43,.15);border-radius:var(--radius);margin-bottom:28px;overflow:hidden}
  .scene-header{padding:16px 24px 10px}
  .scene-header h3{font-family:'Playfair Display',serif;font-size:1.1rem;color:var(--amber-light);margin-bottom:4px}
  .desc{font-size:.78rem;color:var(--text-muted);line-height:1.5}
  .seed-grid{display:grid;gap:16px;padding:12px 24px 20px}
  .img-col{text-align:center}
  .seed-label{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:6px}
  .img-wrapper{aspect-ratio:2/3;overflow:hidden;background:#110a0c;border-radius:var(--radius);display:flex;align-items:center;justify-content:center}
  .img-wrapper img{width:100%;height:100%;object-fit:cover;cursor:pointer;transition:transform .3s}
  .img-wrapper img:hover{transform:scale(1.03)}
  .filtered{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:repeating-linear-gradient(-45deg,transparent,transparent 10px,rgba(139,26,43,.08) 10px,rgba(139,26,43,.08) 20px);color:var(--crimson-light);font-weight:600;font-size:1rem;padding:20px;text-align:center}
  .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.7rem;font-weight:600;margin-top:6px}
  .badge.pass{background:rgba(45,106,79,.2);color:#6fcf97;border:1px solid rgba(45,106,79,.4)}
  .badge.fail{background:rgba(139,26,43,.2);color:var(--crimson-light);border:1px solid rgba(139,26,43,.4)}
  .modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:1000;align-items:center;justify-content:center;padding:20px;cursor:pointer}
  .modal-overlay.active{display:flex}
  .modal-content{max-width:90vw;max-height:90vh;display:flex;gap:24px;align-items:flex-start;cursor:default}
  .modal-content img{max-height:88vh;max-width:60vw;object-fit:contain;border-radius:var(--radius)}
  .modal-details h3{font-family:'Playfair Display',serif;font-size:1rem;color:var(--amber-light);max-width:320px}
</style>
</head>
<body>
<div class="header">
  <h1>BJ Couch POV Test</h1>
  <p class="subtitle">Couch setting · TV light · no hands vs. arm from camera direction · ${dateStr}</p>
  <div class="stats">
    <div class="stat"><div class="number">${passed}</div><div class="label">Generated</div></div>
    <div class="stat"><div class="number">${filtered}</div><div class="label">Filtered</div></div>
    <div class="stat"><div class="number">${results.length}</div><div class="label">Total</div></div>
  </div>
</div>
<div class="section">${sceneHtml}</div>
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

async function main() {
  if (!process.env.REPLICATE_API_TOKEN) {
    console.error("ERROR: REPLICATE_API_TOKEN not found in .env.local");
    process.exit(1);
  }

  const total = SCENES.length * SEEDS_PER_SCENE;
  console.log("=".repeat(60));
  console.log("  Hunyuan BJ Couch POV Test");
  console.log("=".repeat(60));
  console.log(`  Variation 1: no hands (2 seeds)`);
  console.log(`  Variation 2: one arm from directly above (2 seeds)`);
  console.log(`  Total: ${total} generations`);
  console.log("=".repeat(60));

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const results: Result[] = [];
  const baseSeed = Math.floor(Math.random() * 1_000_000);
  let genIndex = 0;

  for (const scene of SCENES) {
    console.log(`\n━━━ ${scene.name} ━━━`);
    for (let s = 0; s < SEEDS_PER_SCENE; s++) {
      const seed = baseSeed + genIndex;
      genIndex++;
      console.log(`\n  [${genIndex}/${total}] Seed ${seed}...`);

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
          results.push({ sceneId: scene.id, sceneName: scene.name, seed, filename, success: true, filtered: false, error: null, executionTime: elapsed });
        } else {
          results.push({ sceneId: scene.id, sceneName: scene.name, seed, filename, success: false, filtered: false, error: "Download failed", executionTime: elapsed });
        }
      } else {
        const filtered = !error;
        console.log(`  ${filtered ? "⚠ Filtered" : "✗ Failed"} (${(elapsed / 1000).toFixed(1)}s)`);
        results.push({ sceneId: scene.id, sceneName: scene.name, seed, filename, success: false, filtered, error: error || "No image returned", executionTime: elapsed });
      }

      if (genIndex < total) await new Promise((r) => setTimeout(r, 1500));
    }
  }

  console.log("\n\n━━━ WRITING REPORT ━━━");
  const html = generateReport(results);
  const reportPath = path.join(OUTPUT_DIR, "report.html");
  fs.writeFileSync(reportPath, html);
  fs.writeFileSync(path.join(OUTPUT_DIR, "results.json"), JSON.stringify(results, null, 2));
  console.log(`✓ Report: ${reportPath}`);

  const passed = results.filter((r) => r.success).length;
  const filtered = results.filter((r) => r.filtered).length;
  console.log("\n" + "=".repeat(60));
  for (const r of results) {
    const icon = r.success ? "✓" : r.filtered ? "⚠" : "✗";
    console.log(`  ${icon} [seed ${r.seed}] ${r.sceneName} [${r.success ? `${(r.executionTime / 1000).toFixed(1)}s` : r.filtered ? "FILTERED" : "FAILED"}]`);
  }
  console.log(`\n  Total: ${passed}/${total} generated, ${filtered} filtered`);
  console.log(`\n  open ${path.resolve(reportPath)}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
