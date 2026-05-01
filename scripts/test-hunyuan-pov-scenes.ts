/**
 * No Safe Word — HunyuanImage 3.0 POV-Style Sex Scene Test
 * =========================================================
 * Tests whether Hunyuan can render the "woman foregrounded, man anonymous"
 * visual style (woman fully visible, man represented only by hands + cock).
 * Reference: doggy/reverse-cowgirl/standing positions from Lobola List scenes.
 *
 * 5 scenes × 3 seeds = 15 generations.
 *
 * Usage:
 *   npx tsx scripts/test-hunyuan-pov-scenes.ts
 *
 * Output:
 *   ./hunyuan3_results/pov-test/   — generated images + report.html
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

const OUTPUT_DIR = "./hunyuan3_results/pov-test";
const MODEL = "tencent/hunyuan-image-3" as `${string}/${string}`;
const SEEDS_PER_SCENE = 3;

// ── Lindiwe's physical description (stripped of portrait framing) ──
const LINDIWE =
  "A Black South African woman, age 24, medium-brown skin, dark brown eyes, " +
  "oval face with high cheekbones, full lips, broad nose, expressive eyes " +
  "with long lashes, flawless skin. Extremely voluptuous body — very large " +
  "heavy breasts, deep cleavage, tiny narrow waist, very wide hips, large " +
  "round protruding backside. Long black braids loose over her shoulders.";

// ── Anonymous male descriptor ──
const MALE_HANDS = "Dark-skinned male hands grip her wide hips firmly from behind, fingertips pressing into her skin.";
const MALE_COCK = "A dark thick erect penis penetrates her from behind — only his dark forearms and cock are visible in frame, the rest of his body hidden behind her and cropped out of frame.";

// ─────────────────────────────────────────────
// SCENES — 5 settings from the Lobola List NSFW scenes
// ─────────────────────────────────────────────
interface Scene {
  id: string;
  name: string;
  source: string; // which Lobola List scene it's adapted from
  prompt: string;
}

const SCENES: Scene[] = [
  {
    id: "scene_01_workshop",
    name: "Scene 1: Workshop — Doggy at Workbench",
    source: "THE SYSTEM ep5 — Sibusiso's Middelburg workshop, after closing",
    prompt:
      `${LINDIWE} ` +
      "She leans forward over a grease-stained workshop workbench, both arms braced " +
      "straight with palms flat on the bench surface, back deeply arched, her large " +
      "round backside pushed up and back toward the camera. She turns her face over " +
      "her left shoulder to look directly at the camera, lips parted, expression open " +
      "and overwhelmed. Her voluptuous nude body faces away from camera, the side " +
      "curve of her heavy breasts just visible. " +
      `${MALE_HANDS} ${MALE_COCK} ` +
      "Middelburg mechanic workshop interior, after closing, bay door rolled down in " +
      "the background. Single fluorescent strip light overhead throws harsh clean " +
      "white-blue light across the bench and her skin, hard shadows pooling along " +
      "her spine. Tools hanging on the wall behind her. Oil-stained concrete floor. " +
      "Shot from behind and slightly low, medium framing from her mid-thigh upward, " +
      "her body filling the frame, shallow depth of field blurring the workshop " +
      "behind her. Photorealistic, cinematic, 8k editorial photography.",
  },
  {
    id: "scene_02_mirror",
    name: "Scene 2: Bedroom Mirror — Standing from Behind",
    source: "THE SYSTEM ep2 — Lindiwe's Johannesburg bedroom, Friday night",
    prompt:
      `${LINDIWE} ` +
      "She stands fully nude facing a full-length bedroom mirror, both palms pressed " +
      "flat against the mirror glass, arms straight, leaning slightly forward. Her " +
      "back faces the camera — the full curve of her large round backside and wide " +
      "hips prominent, her thick braids hanging between her shoulder blades, the side " +
      "swell of her heavy breasts visible in profile. In the mirror reflection, her " +
      "face looks back — dark eyes wide, lips parted, an expression of stunned " +
      "pleasure. " +
      `${MALE_HANDS} ${MALE_COCK} ` +
      "Johannesburg bedroom, late Friday night. Single amber bedside lamp to the " +
      "right throws warm golden light across her back, catching the line of her " +
      "spine, glowing on the mirror's edge and softly illuminating her reflection. " +
      "City quiet outside the window. Shot from directly behind, framing her body " +
      "from the thighs upward with her mirror reflection in the upper portion of " +
      "frame, shallow depth of field. Photorealistic, cinematic, 8k editorial photography.",
  },
  {
    id: "scene_03_apartment_window",
    name: "Scene 3: High-Rise Window — Standing Against Glass",
    source: "THE FRONTRUNNER ep1 — Langa's Johannesburg apartment, floor-to-ceiling glass",
    prompt:
      `${LINDIWE} ` +
      "She stands fully nude facing floor-to-ceiling glass windows high above " +
      "Johannesburg at night, both palms pressed against the cool glass pane, " +
      "leaning slightly forward. Her back faces the camera — very wide hips and " +
      "large round backside prominent, the lit city skyline glowing orange and blue " +
      "far below through the glass. Her face turns sideways, cheek nearly against " +
      "the glass, eyes half-closed, lips parted. The side curve of her large breasts " +
      "just visible against the glass pane. " +
      `${MALE_HANDS} ${MALE_COCK} ` +
      "High-floor Johannesburg apartment, late night. Pale blue-grey city light " +
      "floods in from outside through the glass, washing cool tones across her " +
      "medium-brown skin. Warm amber glow from a single table lamp in the room " +
      "behind softly illuminates the back of her shoulders and braids, creating " +
      "contrast with the cool window light. City lights spread across the full " +
      "background through the glass. Shot from behind and slightly to the side, " +
      "medium framing from her thighs upward, shallow depth of field. " +
      "Photorealistic, cinematic, 8k editorial photography.",
  },
  {
    id: "scene_04_bedroom_cowgirl",
    name: "Scene 4: Sibusiso's Bedroom — Reverse Cowgirl",
    source: "THE FRONTRUNNER ep6 — Sibusiso's Middelburg flat, bedside lamp",
    prompt:
      `${LINDIWE} ` +
      "She sits upright astride a man on a bed, her back fully facing the camera, " +
      "knees bent and spread either side of his thighs. Her spine is arched, head " +
      "tilted back, braids cascading down between her shoulder blades. Both hands " +
      "rest lightly on the bed surface beside his thighs for balance. Her voluptuous " +
      "nude body fills the frame — very wide hips, the swell of her heavy breasts " +
      "visible at the sides. The dark-skinned man below her is almost entirely " +
      "off-frame — only his dark thighs visible at the very lower edge, his dark " +
      "hands grip her waist firmly. Her hips are positioned above him, his dark " +
      "erect penis visible penetrating upward into her. " +
      "Middelburg flat bedroom, night. Single bedside lamp on the left throws warm " +
      "amber light from the side, catching the curve of her spine and the swell of " +
      "her backside, the rest of the room in deep shadow. African print headboard " +
      "visible in the dark background. Close medium shot from behind and slightly to " +
      "the side, framing her from the thighs upward, shallow depth of field blurring " +
      "the dark bedroom. Photorealistic, cinematic, 8k editorial photography.",
  },
  {
    id: "scene_05_bedroom_knees",
    name: "Scene 5: Lindiwe's Bedroom — Doggy on Bed",
    source: "THE FRONTRUNNER ep9 — Lindiwe's bedroom, phone-screen blue light",
    prompt:
      `${LINDIWE} ` +
      "She is on her hands and knees on a bed, fully nude, back arched deeply, her " +
      "large round backside pushed up and back toward the camera. She looks back " +
      "over her right shoulder directly at the camera, lips parted, dark eyes " +
      "heavy-lidded, braids falling around her face. The heavy side curve of her " +
      "large breasts hangs visible below her chest as she arches. " +
      `${MALE_HANDS} ${MALE_COCK} ` +
      "Johannesburg bedroom, very late at night. A phone lying face-down on the " +
      "pillow beside her casts a faint cool blue-white glow across the sheets and " +
      "the near side of her body. The rest of the bedroom is dark, deep warm " +
      "shadows. The blue phone-light catches the curve of her spine and the angle " +
      "of her face looking back. Rumpled sheets. Shot from behind and slightly low, " +
      "tight medium framing from her knees forward, her body filling the frame, " +
      "shallow depth of field. Photorealistic, cinematic, 8k editorial photography.",
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

// ─────────────────────────────────────────────
// RESULT TYPE
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// HTML REPORT
// ─────────────────────────────────────────────

function generateReport(results: Result[]): string {
  const passed = results.filter((r) => r.success).length;
  const filtered = results.filter((r) => r.filtered).length;
  const total = results.length;
  const dateStr = new Date().toLocaleString("en-GB");

  // Group by scene
  const byScene = new Map<string, Result[]>();
  for (const r of results) {
    if (!byScene.has(r.sceneId)) byScene.set(r.sceneId, []);
    byScene.get(r.sceneId)!.push(r);
  }

  let sceneHtml = "";
  for (const [sceneId, sceneResults] of byScene) {
    const scene = SCENES.find((s) => s.id === sceneId)!;
    const seedCols = sceneResults
      .map((r) => {
        if (r.success) {
          return `<div class="img-col">
            <div class="seed-label">Seed ${r.seed}</div>
            <div class="img-wrapper">
              <img src="${r.filename}" loading="lazy" onclick="openModal(this.src,'${scene.name} — seed ${r.seed}')" />
            </div>
            <span class="badge pass">✓ ${(r.executionTime / 1000).toFixed(1)}s</span>
          </div>`;
        } else if (r.filtered) {
          return `<div class="img-col">
            <div class="seed-label">Seed ${r.seed}</div>
            <div class="img-wrapper"><div class="filtered">⚠ FILTERED</div></div>
            <span class="badge filtered-badge">Filtered</span>
          </div>`;
        } else {
          return `<div class="img-col">
            <div class="seed-label">Seed ${r.seed}</div>
            <div class="img-wrapper"><div class="filtered error">✗ FAILED<br><span>${r.error || ""}</span></div></div>
            <span class="badge fail">Failed</span>
          </div>`;
        }
      })
      .join("\n");

    sceneHtml += `
      <div class="scene-block">
        <div class="scene-header">
          <h3>${scene.name}</h3>
          <p class="source">Source: ${scene.source}</p>
          <p class="prompt-preview">${scene.prompt.slice(0, 300)}...</p>
        </div>
        <div class="seed-grid">${seedCols}</div>
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hunyuan POV Style Test — The Lobola List</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root { --bg:#0a0607;--surface:#1a1012;--crimson:#8b1a2b;--crimson-light:#c4384f;--amber:#d4920a;--amber-light:#f5c542;--text:#e8ddd0;--text-muted:#8a7d72;--radius:8px; }
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;line-height:1.6}
  .header{text-align:center;padding:60px 20px 40px;background:linear-gradient(180deg,#1a0a0e 0%,var(--bg) 100%);border-bottom:1px solid rgba(139,26,43,0.3)}
  .header h1{font-family:'Playfair Display',serif;font-size:2.2rem;font-weight:700;background:linear-gradient(135deg,var(--amber-light),var(--crimson-light));-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px}
  .header .subtitle{color:var(--text-muted);font-size:.95rem;margin-bottom:24px}
  .stats{display:flex;justify-content:center;gap:40px;margin-top:20px}
  .stat .number{font-family:'Playfair Display',serif;font-size:2rem;color:var(--amber-light)}
  .stat .label{font-size:.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px}
  .section{max-width:1400px;margin:0 auto;padding:40px 20px}
  .scene-block{background:var(--surface);border:1px solid rgba(139,26,43,0.15);border-radius:var(--radius);margin-bottom:32px;overflow:hidden}
  .scene-header{padding:20px 24px 12px}
  .scene-header h3{font-family:'Playfair Display',serif;font-size:1.2rem;color:var(--amber-light);margin-bottom:4px}
  .source{font-size:.75rem;color:var(--crimson-light);margin-bottom:6px}
  .prompt-preview{font-size:.78rem;color:var(--text-muted);line-height:1.5}
  .seed-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:12px 24px 20px}
  .img-col{text-align:center}
  .seed-label{font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:6px}
  .img-wrapper{aspect-ratio:2/3;overflow:hidden;background:#110a0c;border-radius:var(--radius);display:flex;align-items:center;justify-content:center}
  .img-wrapper img{width:100%;height:100%;object-fit:cover;cursor:pointer;transition:transform .3s}
  .img-wrapper img:hover{transform:scale(1.03)}
  .filtered{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:repeating-linear-gradient(-45deg,transparent,transparent 10px,rgba(139,26,43,.08) 10px,rgba(139,26,43,.08) 20px);color:var(--crimson-light);font-weight:600;font-size:1.1rem;padding:20px;text-align:center}
  .filtered span{font-size:.72rem;color:var(--text-muted);font-weight:400;margin-top:8px}
  .filtered.error{color:#e05c5c}
  .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.72rem;font-weight:600;margin-top:6px}
  .badge.pass{background:rgba(45,106,79,.2);color:#6fcf97;border:1px solid rgba(45,106,79,.4)}
  .badge.fail{background:rgba(139,26,43,.2);color:var(--crimson-light);border:1px solid rgba(139,26,43,.4)}
  .badge.filtered-badge{background:rgba(212,146,10,.2);color:var(--amber-light);border:1px solid rgba(212,146,10,.4)}
  .modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:1000;align-items:center;justify-content:center;padding:20px;cursor:pointer}
  .modal-overlay.active{display:flex}
  .modal-content{max-width:90vw;max-height:90vh;display:flex;gap:24px;align-items:flex-start;cursor:default}
  .modal-content img{max-height:88vh;max-width:65vw;object-fit:contain;border-radius:var(--radius)}
  .modal-details{max-width:360px}
  .modal-details h3{font-family:'Playfair Display',serif;font-size:1.1rem;margin-bottom:8px;color:var(--amber-light)}
  @media(max-width:800px){.seed-grid{grid-template-columns:1fr}.modal-content{flex-direction:column}.modal-content img{max-width:90vw}}
</style>
</head>
<body>
<div class="header">
  <h1>Hunyuan POV Style Test</h1>
  <p class="subtitle">Woman foregrounded · Man anonymous (hands + cock only) · The Lobola List scenes · ${dateStr}</p>
  <div class="stats">
    <div class="stat"><div class="number">${passed}</div><div class="label">Generated</div></div>
    <div class="stat"><div class="number">${filtered}</div><div class="label">Filtered</div></div>
    <div class="stat"><div class="number">${total}</div><div class="label">Total</div></div>
  </div>
  <p style="color:var(--text-muted);margin-top:14px;font-size:.82rem">
    HunyuanImage 3.0 · Replicate · safety_checker: disabled · 2:3 · ${SEEDS_PER_SCENE} seeds/scene
  </p>
</div>
<div class="section">
  ${sceneHtml}
</div>
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

  const totalGenerations = SCENES.length * SEEDS_PER_SCENE;
  console.log("=".repeat(60));
  console.log("  Hunyuan POV Style Test — The Lobola List");
  console.log("=".repeat(60));
  console.log(`  Scenes:       ${SCENES.length}`);
  console.log(`  Seeds/scene:  ${SEEDS_PER_SCENE}`);
  console.log(`  Total:        ${totalGenerations} generations`);
  console.log(`  Model:        tencent/hunyuan-image-3`);
  console.log(`  Safety:       DISABLED`);
  console.log("=".repeat(60));

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const results: Result[] = [];
  const baseSeed = Math.floor(Math.random() * 1_000_000);
  let genIndex = 0;

  for (const scene of SCENES) {
    console.log(`\n━━━ ${scene.name} ━━━`);
    console.log(`  Source: ${scene.source}`);

    for (let s = 0; s < SEEDS_PER_SCENE; s++) {
      const seed = baseSeed + genIndex;
      genIndex++;

      console.log(`\n  [${genIndex}/${totalGenerations}] Seed ${seed}...`);

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

      if (genIndex < totalGenerations) await new Promise((r) => setTimeout(r, 1500));
    }
  }

  // ── Report ──
  console.log("\n\n━━━ WRITING REPORT ━━━");
  const html = generateReport(results);
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
  for (const scene of SCENES) {
    const sceneResults = results.filter((r) => r.sceneId === scene.id);
    const ok = sceneResults.filter((r) => r.success).length;
    console.log(`  ${scene.name}: ${ok}/${SEEDS_PER_SCENE} generated`);
  }
  console.log(`\n  Total: ${passed}/${totalGenerations} generated, ${filtered} filtered`);
  console.log(`\n  open ${path.resolve(reportPath)}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
