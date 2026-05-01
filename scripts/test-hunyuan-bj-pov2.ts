/**
 * No Safe Word — Hunyuan BJ True POV (v2)
 * =========================================
 * Correct POV angle: camera IS the man's eyes, seated on the couch,
 * looking STEEPLY DOWNWARD at the woman kneeling between his legs.
 *
 * Previous attempt produced a low-angle upward shot. Fix: explicitly
 * describe the steep downward angle and the man's seated position
 * so the model understands the camera is HIGH, looking DOWN.
 *
 * 4 variations × 1 seed each.
 *
 * Usage:
 *   npx tsx scripts/test-hunyuan-bj-pov2.ts
 *
 * Output:
 *   ./hunyuan3_results/bj-pov2/
 */

import * as fs from "fs";
import * as path from "path";
import Replicate from "replicate";

const envPath = path.resolve(__dirname, "../.env.local");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

const client = new Replicate();

const OUTPUT_DIR = "./hunyuan3_results/bj-pov2";
const MODEL = "tencent/hunyuan-image-3" as `${string}/${string}`;

const LINDIWE =
  "A Black South African woman, age 24, medium-brown skin, dark brown eyes, " +
  "oval face with high cheekbones, full lips, broad nose, expressive eyes with " +
  "long lashes, flawless skin. Extremely voluptuous body — very large heavy " +
  "breasts, deep cleavage, tiny narrow waist, very wide hips. " +
  "Long black braids loose over her shoulders.";

// The angle description is the critical fix — reused in every prompt
const ANGLE =
  "CAMERA ANGLE: the camera represents the seated man's own eyes and face, " +
  "looking steeply downward between his own thighs at the woman kneeling " +
  "on the floor below him. The shot is a steep downward-looking angle — " +
  "almost straight down. The woman's face is tilted nearly perpendicular " +
  "to the floor, chin raised straight up, looking almost directly upward " +
  "into the lens. We are looking DOWN at her from high above, not up at her. " +
  "Her shoulders and breasts are visible in the lower half of the frame " +
  "as seen from above. The floor or carpet is the furthest background element, " +
  "with the couch, sofa cushions, and TV visible further in the background " +
  "behind and below her from this top-down perspective.";

const SETTING =
  "South African living room, late evening. He is seated on a couch. " +
  "TV screen glow — cool blue-grey ambient television light — visible " +
  "in the background, providing the main light source from the far side " +
  "of the room. A warm side lamp in the background. Domestic interior.";

interface Scene {
  id: string;
  name: string;
  description: string;
  prompt: string;
}

const SCENES: Scene[] = [
  {
    id: "pov2_01_bare",
    name: "POV v2 — No Hands, Lips Around Cock",
    description:
      "Steep downward angle from the man's eye-level. She kneels below, face tilted " +
      "nearly straight up. His cock comes from just outside the top of frame, her lips " +
      "sealed around it. No hands. Eyes looking up at camera.",
    prompt:
      `${LINDIWE} ` +
      "She kneels on the carpet floor between the man's legs. Her face is tilted " +
      "nearly straight upward — chin raised high, throat extended, face almost " +
      "perpendicular to the ground — looking directly up into the camera with " +
      "dark heavy-lidded eyes. Her lips are sealed around a dark thick erect " +
      "penis. The cock descends from just outside the top edge of frame — " +
      "from the man's groin which is outside the top of the shot — straight " +
      "downward into her open mouth. Her lips close around the shaft, her " +
      "cheeks slightly hollowed, actively taking it. Her long black braids " +
      "fall back behind her head and down. Her very large heavy breasts are " +
      "visible below her face in the lower portion of frame, seen from above. " +
      "No hands are visible — no hands on her head, no hands on the cock. " +
      "Only the shaft descending from outside frame above, and her upturned " +
      "face and upper body filling the frame below. " +
      `${SETTING} ${ANGLE} ` +
      "Photorealistic, cinematic, 8k editorial photography.",
  },
  {
    id: "pov2_02_his_hand_cock",
    name: "POV v2 — His Hand Gripping Cock, Pointing Down",
    description:
      "Same steep downward POV. His dark hand grips the shaft of the cock from " +
      "above, pointing it downward toward her upturned open mouth. One hand only, " +
      "from directly above. Her lips parted below it, looking up.",
    prompt:
      `${LINDIWE} ` +
      "She kneels on the carpet floor, face tilted nearly straight upward — " +
      "chin raised, throat extended, looking directly up into the camera. " +
      "Her lips are parted wide and open below a dark thick erect penis. " +
      "One large very dark hand grips the shaft of the cock firmly from above " +
      "and from the same direction as the camera — the hand and cock descend " +
      "from the top of frame, from the man's own perspective, pointing the " +
      "cock downward toward her open upturned mouth. His grip is around the " +
      "base-to-mid of the shaft. The tip of the cock is aimed at her parted " +
      "lips just below. Her tongue is slightly visible, lips open. Her dark " +
      "brown eyes look upward past the cock directly at the camera. Her long " +
      "black braids fall back. Her very large heavy breasts visible in the " +
      "lower frame from this above angle. " +
      "The hand and cock enter the frame from the very top — from the man's " +
      "lap just outside the top edge of frame. His torso, face, everything " +
      "else is above and outside the shot. " +
      `${SETTING} ${ANGLE} ` +
      "Photorealistic, cinematic, 8k editorial photography.",
  },
  {
    id: "pov2_03_hand_on_head",
    name: "POV v2 — One Hand on Top of Her Head, Pressing Down",
    description:
      "Steep downward POV. His cock in her mouth. One large dark hand presses " +
      "down on the very top of her skull from directly above — same axis as the " +
      "camera. Hand comes from camera direction, not the sides. She looks up past it.",
    prompt:
      `${LINDIWE} ` +
      "She kneels on the carpet floor, face tilted nearly straight upward, " +
      "looking up into the camera with heavy dark eyes. Her lips are sealed " +
      "around a dark thick erect penis that comes from the top of frame. " +
      "She is actively giving oral — lips closed around the shaft. " +
      "One large very dark hand presses firmly on the very top of her skull " +
      "from directly above — the palm flat against the crown of her head, " +
      "fingers spreading across the top of her head, pressing downward. " +
      "The hand descends from directly above, from the same overhead direction " +
      "as the camera — it comes from behind the camera's viewpoint, not from " +
      "the left side or right side but from directly overhead, pressing straight " +
      "down onto the top of her head. Her braids splay out from under the " +
      "gripping hand. Her face tilts upward past the hand and the cock. " +
      "Her dark eyes look up at the camera. Her large heavy breasts visible " +
      "in the lower frame from this steep top-down angle. " +
      `${SETTING} ${ANGLE} ` +
      "Photorealistic, cinematic, 8k editorial photography.",
  },
  {
    id: "pov2_04_jaw_level",
    name: "POV v2 — Jaw-Line Level, Slightly Lower Angle",
    description:
      "Camera at the man's jaw/chin level — slightly less steep than eye-level, " +
      "but still clearly looking DOWN at her. Her face is more visible face-on. " +
      "His cock in her mouth. No hands. Slightly wider view showing more of her body.",
    prompt:
      `${LINDIWE} ` +
      "She kneels on the carpet floor between the man's legs, looking steeply " +
      "upward toward the camera. The camera is positioned at the seated man's " +
      "chin or jaw level — slightly lower than his eye level — still angled " +
      "clearly downward at her kneeling below. Her face is tilted back and " +
      "upward at a steep angle toward the lens, chin raised, her expression " +
      "visible — dark heavy-lidded eyes looking up at the camera with lips " +
      "wrapped around a dark thick erect penis. The cock extends from above " +
      "the frame top downward into her mouth. Her lips seal around it, cheeks " +
      "slightly hollowed. At this slightly lower camera position, her face is " +
      "more front-facing than purely top-down — we see her full face, forehead, " +
      "the top of her braids, her throat, and her large heavy breasts below, " +
      "along with her kneeling torso. Her hands rest on her thighs. " +
      "No other hands visible. The cock enters from just outside the upper " +
      "frame edge. The couch and TV in background are more visible at this " +
      "slightly lower angle. " +
      `${SETTING} ` +
      "Camera at the seated man's chin level angled steeply downward at the " +
      "kneeling woman below — not as extreme as directly overhead but clearly " +
      "from above. We are looking down at her from above, her face tilted back " +
      "up at us. Tight medium shot. Shallow depth of field. " +
      "Photorealistic, cinematic, 8k editorial photography.",
  },
];

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

  const sceneHtml = SCENES.map((scene) => {
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
    return `<div class="scene-block">
      <div class="scene-header"><h3>${scene.name}</h3><p class="desc">${scene.description}</p></div>
      <div class="seed-grid" style="grid-template-columns:1fr">${cols}</div>
    </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hunyuan BJ POV v2 — True Top-Down Angle</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{--bg:#0a0607;--surface:#1a1012;--crimson-light:#c4384f;--amber-light:#f5c542;--text:#e8ddd0;--text-muted:#8a7d72;--radius:8px}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif}
  .header{text-align:center;padding:60px 20px 40px;background:linear-gradient(180deg,#1a0a0e,var(--bg));border-bottom:1px solid rgba(139,26,43,.3)}
  .header h1{font-family:'Playfair Display',serif;font-size:2rem;background:linear-gradient(135deg,var(--amber-light),var(--crimson-light));-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px}
  .subtitle{color:var(--text-muted);font-size:.85rem;margin-bottom:4px}
  .note{color:var(--crimson-light);font-size:.82rem;margin-top:8px}
  .stats{display:flex;justify-content:center;gap:40px;margin-top:20px}
  .stat .number{font-family:'Playfair Display',serif;font-size:2rem;color:var(--amber-light)}
  .stat .label{font-size:.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px}
  .section{max-width:600px;margin:0 auto;padding:40px 20px}
  .scene-block{background:var(--surface);border:1px solid rgba(139,26,43,.15);border-radius:var(--radius);margin-bottom:24px;overflow:hidden}
  .scene-header{padding:16px 24px 10px}
  .scene-header h3{font-family:'Playfair Display',serif;font-size:1.05rem;color:var(--amber-light);margin-bottom:4px}
  .desc{font-size:.76rem;color:var(--text-muted);line-height:1.5}
  .seed-grid{display:grid;gap:16px;padding:12px 24px 20px}
  .img-col{text-align:center}
  .seed-label{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:6px}
  .img-wrapper{aspect-ratio:2/3;overflow:hidden;background:#110a0c;border-radius:var(--radius);display:flex;align-items:center;justify-content:center}
  .img-wrapper img{width:100%;height:100%;object-fit:cover;cursor:pointer;transition:transform .3s}
  .img-wrapper img:hover{transform:scale(1.03)}
  .filtered{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:repeating-linear-gradient(-45deg,transparent,transparent 10px,rgba(139,26,43,.08) 10px,rgba(139,26,43,.08) 20px);color:var(--crimson-light);font-weight:600;padding:20px;text-align:center}
  .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.7rem;font-weight:600;margin-top:6px}
  .badge.pass{background:rgba(45,106,79,.2);color:#6fcf97;border:1px solid rgba(45,106,79,.4)}
  .badge.fail{background:rgba(139,26,43,.2);color:var(--crimson-light);border:1px solid rgba(139,26,43,.4)}
  .modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:1000;align-items:center;justify-content:center;padding:20px;cursor:pointer}
  .modal-overlay.active{display:flex}
  .modal-content{max-width:90vw;max-height:90vh;cursor:default}
  .modal-content img{max-height:90vh;max-width:90vw;object-fit:contain;border-radius:var(--radius)}
</style>
</head>
<body>
<div class="header">
  <h1>BJ POV v2 — True Top-Down Angle</h1>
  <p class="subtitle">Camera = man's eyes looking steeply DOWN at kneeling woman · Couch setting · ${dateStr}</p>
  <p class="note">Fix from v1: explicit steep downward angle, camera at seated man's eye/jaw level, not from below</p>
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
  </div>
</div>
<script>
  function openModal(src,title){document.getElementById('modal').classList.add('active');document.getElementById('modal-img').src=src}
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

  console.log("=".repeat(60));
  console.log("  Hunyuan BJ POV v2 — True Top-Down Angle");
  console.log("=".repeat(60));
  console.log(`  Fix: camera explicitly at man's eye/jaw level looking DOWN`);
  console.log(`  4 variations × 1 seed each`);
  console.log("=".repeat(60));

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const results: Result[] = [];
  const baseSeed = Math.floor(Math.random() * 1_000_000);

  for (let i = 0; i < SCENES.length; i++) {
    const scene = SCENES[i];
    const seed = baseSeed + i;
    console.log(`\n━━━ [${i + 1}/${SCENES.length}] ${scene.name} ━━━`);
    console.log(`  Seed ${seed}...`);

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

    if (i < SCENES.length - 1) await new Promise((r) => setTimeout(r, 1500));
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
  console.log(`\n  Total: ${passed}/${SCENES.length} generated, ${filtered} filtered`);
  console.log(`\n  open ${path.resolve(reportPath)}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
