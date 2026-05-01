/**
 * No Safe Word — Hunyuan Improved Kiss + Blowjob POV Test
 * =========================================================
 * Part A: Kissing × 3 seeds — Sibusiso's actual character description,
 *         lips physically pressed together (not wide open approaching mouths).
 * Part B: Blowjob POV × 3 variations — her face visible, looking up at camera,
 *         anonymous dark male (cock + hands only). Variations: bare, one hand
 *         on head, both hands gripping braids.
 *
 * Usage:
 *   npx tsx scripts/test-hunyuan-kiss-bj.ts
 *
 * Output:
 *   ./hunyuan3_results/kiss-bj/   — images + report.html
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

const OUTPUT_DIR = "./hunyuan3_results/kiss-bj";
const MODEL = "tencent/hunyuan-image-3" as `${string}/${string}`;

// ─────────────────────────────────────────────
// CHARACTER DESCRIPTIONS — stripped of portrait framing
// ─────────────────────────────────────────────

const LINDIWE =
  "A Black South African woman, age 24, medium-brown skin, dark brown eyes, " +
  "oval face with high cheekbones, full lips, broad nose, expressive eyes with " +
  "long lashes, flawless skin. Extremely voluptuous body — very large heavy " +
  "breasts, deep cleavage, tiny narrow waist, very wide hips, large round " +
  "protruding backside. Long black braids loose over her shoulders.";

// Sibusiso — from portrait_prompt_locked, stripped of framing language
const SIBUSISO =
  "A Black South African man, age 26, medium-dark skin, dark brown eyes, easy " +
  "smile that crinkles his eyes, traces of grease on his hands, quiet physical " +
  "confidence, direct unhurried gaze. Broad muscular shoulders, naturally " +
  "muscular from physical work not gym-built, strong hands. Black short natural hair.";

// ─────────────────────────────────────────────
// SCENES
// ─────────────────────────────────────────────

interface Scene {
  id: string;
  name: string;
  seeds: number;
  description: string;
  prompt: string;
}

const SCENES: Scene[] = [
  // ── PART A: KISSING (fixed) ──
  {
    id: "kiss_v2_workshop",
    name: "Kiss (v2): Workshop — Lips Pressed Together",
    seeds: 3,
    description:
      "Sibusiso's actual character description injected. Explicit lip contact — " +
      "mouths pressed together, not approaching open-mouthed. Workshop, fluorescent light.",
    prompt:
      `${LINDIWE} ${SIBUSISO} ` +
      "They kiss inside Sibusiso's mechanic workshop after closing. She leans back " +
      "against the workbench with both hands gripping the front of his overalls, " +
      "pulling him toward her. Their lips are pressed firmly together in contact — " +
      "mouths closed and sealed in a slow deliberate kiss, her lower lip caught " +
      "between his lips, both faces tilted into each other. His left hand cups the " +
      "side of her jaw and cheek, thumb resting near her cheekbone, holding her " +
      "face to his. His right hand presses flat on the workbench beside her hip. " +
      "Her head tilts back and to the right, his tilts left, their mouths meeting " +
      "at the centre of the frame. Her eyes are closed. His eyes are closed. The " +
      "kiss is slow and consuming — lips pressed together in full contact. " +
      "Her fitted top is off one shoulder, collarbone bare. His overalls are " +
      "unzipped to the waist over a white vest. " +
      "Middelburg mechanic workshop interior, after closing. Single overhead " +
      "fluorescent strip light, clean white-blue light across both faces. Hard " +
      "shadows under their chins and along his jaw. Tools on wall behind them " +
      "out of focus. Bay door rolled down. " +
      "Tight two-shot, close crop on both faces from slightly to the side and " +
      "slightly below eye-level. Both faces fill the frame, lips the centrepoint. " +
      "Shallow depth of field. Photorealistic, cinematic, 8k editorial photography.",
  },

  // ── PART B: SIDE PROFILE — man cropped out, 3 settings ──
  {
    id: "side_01_workshop",
    name: "Side Profile 1: Workshop — Leaning Over Workbench",
    seeds: 1,
    description:
      "Side angle (90°). Lindiwe bent forward over the workbench, face visible in profile — " +
      "mouth open, expression of pleasure. Breasts hanging visible from side. " +
      "Man's cock enters from the left edge of frame, his body entirely off-frame. " +
      "Fluorescent workshop light.",
    prompt:
      `${LINDIWE} ` +
      "She bends forward from the waist, leaning over the grease-stained workbench, " +
      "forearms braced flat on the bench surface, back arched. Shot from the side " +
      "at 90 degrees — her full body in left-facing profile. Her face is turned " +
      "slightly toward camera with her mouth wide open, lips parted, expression " +
      "of raw pleasure — a loud unguarded sound escaping. Her very large heavy " +
      "breasts hang forward in full side view, swaying. Her long black braids " +
      "fall forward over the bench. Her very wide hips and large round backside " +
      "face left toward the edge of frame. " +
      "From the left edge of the frame a dark thick erect penis enters her from " +
      "behind — only the shaft and the point of penetration are visible at the " +
      "left frame edge. One large dark hand rests flat on her lower back. The " +
      "man's thighs, torso, and face are entirely cropped out of frame — he " +
      "exists only as cock and one hand at the far left edge. " +
      "Middelburg mechanic workshop interior, after closing. Single fluorescent " +
      "strip light overhead, harsh clean white-blue light from directly above, " +
      "catching the curve of her spine, the hang of her breasts, and her open " +
      "expression. Oil-stained concrete floor. Tools on back wall visible in " +
      "the depth of field. " +
      "Wide side-angle medium shot, her body in profile from her knees to above " +
      "her head, the frame horizontal in feel. Her face on the right side of " +
      "frame, the cock entering from the left. Shallow depth of field. " +
      "Photorealistic, cinematic, 8k editorial photography.",
  },
  {
    id: "side_02_window",
    name: "Side Profile 2: Apartment Window — Gripping the Railing",
    seeds: 1,
    description:
      "Side angle. Lindiwe bent forward gripping a railing/windowsill high above " +
      "Johannesburg. Face in profile, mouth open. Breasts hang visible. " +
      "City lights behind her. Man completely off-frame except his cock from the left.",
    prompt:
      `${LINDIWE} ` +
      "She bends forward from the waist, both hands gripping a low windowsill or " +
      "balcony railing in Langa's high-floor Johannesburg apartment. Her arms " +
      "brace straight, back deeply arched, leaning toward the floor-to-ceiling " +
      "glass with the glowing city spread out below and behind her. Shot from " +
      "the side at 90 degrees — her full body in left-facing profile. Her face " +
      "turns slightly toward camera, mouth open wide, lips parted, an ecstatic " +
      "unguarded expression — eyes half-closed, head dropping slightly forward " +
      "with the force of it. Her very large heavy breasts hang forward in full " +
      "side view. Long black braids fall over her shoulders and down. Her very " +
      "wide hips and large round backside face left toward the frame edge. " +
      "From the left edge of frame a dark thick erect penis enters her from " +
      "behind — only the shaft visible at the frame edge, the penetration clear. " +
      "One large dark hand presses into the small of her back. The man is " +
      "entirely cropped out of the left side of frame — only cock and one hand. " +
      "High-floor Johannesburg apartment, late night. The Johannesburg skyline " +
      "glows orange and blue through the floor-to-ceiling glass behind her — " +
      "city lights scattered across the dark background. Pale blue-grey city " +
      "light washes across her body from the right. Warm amber from a single " +
      "room lamp rim-lights her left side. " +
      "Wide side-angle medium shot, her body in profile filling the frame, city " +
      "skyline in the background through the glass. Her face on the right, cock " +
      "entering from the left. Shallow depth of field blurring the city lights. " +
      "Photorealistic, cinematic, 8k editorial photography.",
  },
  {
    id: "side_03_bedroom",
    name: "Side Profile 3: Bedroom — Bent Over Bed Edge",
    seeds: 1,
    description:
      "Side angle. Lindiwe bent forward over the edge of the bed, forearms on " +
      "the mattress, face in profile visible, mouth open. Amber bedside lamp. " +
      "Man cropped out of frame except cock from the left edge.",
    prompt:
      `${LINDIWE} ` +
      "She bends forward over the edge of the bed in Sibusiso's Middelburg " +
      "bedroom, forearms and palms flat on the mattress surface, back deeply " +
      "arched, knees on the floor. Shot from the side at 90 degrees — her " +
      "full body in profile. Her face turns toward camera, mouth open and lips " +
      "parted in a raw, unguarded expression of pleasure, eyes heavy-lidded and " +
      "almost closed. Her very large heavy breasts hang down in full side view, " +
      "grazing the bed sheets. Her long black braids fall forward over the " +
      "mattress around her arms. Her very wide hips and large round backside " +
      "face left toward the frame edge, pushed back. " +
      "From the left edge of the frame a dark thick erect penis enters her from " +
      "behind — shaft visible at the frame edge, the base where his hips meet " +
      "her barely in frame. One large dark hand grips the wide curve of her hip. " +
      "The man's body is entirely off-frame to the left — cropped out completely " +
      "except for cock and gripping hand. " +
      "Middelburg flat bedroom, late night. Single bedside lamp on the far right " +
      "throws warm amber light from that side — the light catches her open " +
      "expression, the curve of her throat, the hang of her heavy breasts, and " +
      "the line of her arched back. The rest of the room falls into deep warm " +
      "shadow. African print headboard visible in background. White rumpled " +
      "sheets beneath her forearms. " +
      "Wide side-angle medium shot, her body in profile from the knees up, " +
      "filling the frame. Face on the right, cock entering from the left. " +
      "Shallow depth of field. Photorealistic, cinematic, 8k editorial photography.",
  },

  {
    id: "side_04_arm_around",
    name: "Side Profile 4: Kitchen Counter — Arm Around, Gripping Breast",
    seeds: 1,
    description:
      "Side angle. Lindiwe bent forward over a kitchen counter, face forward/downward. " +
      "Man's dark arm reaches around from behind, hand gripping her breast from the side. " +
      "Second hand on her hip. His cock visible at left edge, body off-frame. " +
      "Domestic interior warm light.",
    prompt:
      `${LINDIWE} ` +
      "She bends forward from the waist over a kitchen counter in a South African " +
      "home interior, upper body low, forearms braced on the counter surface. " +
      "Shot from the side at 90 degrees — her body in left-facing profile. Her " +
      "face is turned forward and slightly downward, not toward camera — eyes " +
      "half-closed, jaw loose, expression overwhelmed and surrendered, head " +
      "dropping forward with the rhythm. Her long black braids fall forward over " +
      "the counter surface. Her very large heavy breasts hang in side view. " +
      "Her very wide hips and large round backside push back toward the left " +
      "edge of frame. " +
      "From the left edge of the frame a dark thick erect penis penetrates her " +
      "from behind — the shaft and point of penetration visible at the far left. " +
      "One large very dark arm reaches all the way around her body from behind, " +
      "the large dark hand gripping her heavy breast firmly from below and the " +
      "side — fingers spread across the full weight of it, pulling her back into " +
      "him. A second large dark hand grips her hip from behind. His torso, " +
      "shoulders, and face are entirely off-frame to the left — only his two " +
      "dark arms, his hands, and his cock are visible in the frame. " +
      "South African domestic interior — warm kitchen, counter with everyday " +
      "items blurred in the background. Warm overhead domestic light, soft " +
      "amber-orange tones across the room. Her bare skin catches the warm " +
      "indoor light along the curve of her spine, the hanging breast in the " +
      "gripping hand, and the side of her jaw. " +
      "Wide side-angle medium shot, her body in profile from the knees to just " +
      "above her head, filling the frame. Her face on the right side, cock and " +
      "arms entering from the left. The dark arm reaching around and gripping " +
      "the breast is a strong visual element in the centre of frame. Shallow " +
      "depth of field. Photorealistic, cinematic, 8k editorial photography.",
  },

  // ── PART C: BLOWJOB POV — 3 variations ──
  {
    id: "bj_01_bare",
    name: "BJ Variation 1: Workshop Floor — Looking Up, No Hands",
    seeds: 1,
    description:
      "Lindiwe kneels on workshop concrete, face tilted fully up toward camera. " +
      "Anonymous dark male — only cock and hips. His hands are not on her head. " +
      "Fluorescent workshop light from above.",
    prompt:
      `${LINDIWE} ` +
      "She kneels on the oil-stained concrete floor of the mechanic workshop, " +
      "her face tilted fully upward toward the camera, chin raised, throat " +
      "exposed. Shot from above, camera positioned just above the anonymous " +
      "man's hips looking straight down at her upturned face. Her dark brown " +
      "eyes look directly up at the camera — heavy-lidded, intense, holding eye " +
      "contact. Her lips are parted, wrapped around the shaft of a dark thick " +
      "erect penis that extends from just outside the upper edge of frame " +
      "downward toward her open mouth. Her lips close around it, cheeks slightly " +
      "hollowed. Her long black braids fall loose around her bare shoulders and " +
      "pool on the concrete behind her. Her voluptuous nude body kneels below — " +
      "very large heavy breasts visible, hands resting lightly on her thick thighs. " +
      "The anonymous dark-skinned man is above frame — only the base and shaft of " +
      "his dark cock and the lowest edge of his hips are visible at the top of " +
      "frame, no hands, no torso, no face. " +
      "Middelburg mechanic workshop, after closing. Single fluorescent strip light " +
      "directly overhead throws harsh clean white-blue light downward onto her " +
      "upturned face, illuminating her expression and the curve of her throat and " +
      "chest. Hard shadows under her cheekbones. Tools and bay door out of focus " +
      "behind her on the floor level. " +
      "Shot from directly above, tight crop on her upturned face, throat, upper " +
      "chest, and the cock in her mouth. POV perspective looking down. Shallow " +
      "depth of field. Photorealistic, cinematic, 8k editorial photography.",
  },
  {
    id: "bj_02_one_hand",
    name: "BJ Variation 2: Bedroom — Looking Up, One Hand on Head",
    seeds: 1,
    description:
      "Lindiwe kneels by the bed, face tilted up. One large dark hand grips " +
      "her braids from above, guiding her. Amber bedside lamp light.",
    prompt:
      `${LINDIWE} ` +
      "She kneels on the floor beside the bed in Sibusiso's Middelburg bedroom, " +
      "face tilted fully upward toward the camera, chin raised. Shot from above, " +
      "camera at hip-level of the anonymous man looking straight down at her face. " +
      "Her dark brown eyes look directly up at the camera — heavy-lidded, expression " +
      "a mix of effort and desire. Her lips are wrapped around a dark thick erect " +
      "penis that comes from the top of frame downward into her mouth. Her lips " +
      "seal around the shaft, cheeks slightly hollowed, the cock in her mouth. " +
      "One large dark-skinned hand grips her black braids from above, fingers " +
      "wound into her hair just above her scalp, the grip firm and guiding. Her " +
      "head is angled back into the grip, throat extended, face fully upturned. " +
      "Her long braids spill over the hand and down her bare back. Her voluptuous " +
      "nude body kneels at the bedside — very large heavy breasts hanging, hands " +
      "resting on the bed edge for balance. " +
      "The anonymous man is entirely above frame except for his dark cock, one " +
      "large dark gripping hand, and the very lowest edge of his hips. " +
      "Middelburg flat bedroom, late night. Single bedside lamp on the right " +
      "throws warm amber light from the side — the light catches the line of her " +
      "upturned jaw, the curve of her throat, the swell of her breasts, the dark " +
      "gripping hand against her black braids. Deep shadows in the rest of the " +
      "room. " +
      "Shot from directly above, tight crop on her upturned face, the cock, and " +
      "the gripping hand. POV perspective looking down. Shallow depth of field. " +
      "Photorealistic, cinematic, 8k editorial photography.",
  },
  {
    id: "bj_03_two_hands",
    name: "BJ Variation 3: Workshop — Looking Up, Both Hands Holding Head",
    seeds: 1,
    description:
      "Lindiwe kneels, face tilted up. Both dark hands grip her head on either " +
      "side, fingers in her braids, holding her firmly. She looks up past them " +
      "directly at the camera. Fluorescent workshop light.",
    prompt:
      `${LINDIWE} ` +
      "She kneels on the oil-stained concrete of the mechanic workshop, face " +
      "tilted fully upward. Shot from above, camera at the anonymous man's " +
      "hip-level looking straight down at her upturned face. Her dark brown eyes " +
      "look directly up at the camera past the man — her gaze is held, intense, " +
      "unbreaking eye contact with the camera even as both of his large dark " +
      "hands grip her head firmly on either side. His fingers are wound into her " +
      "black braids at her temples, palms against the sides of her skull, holding " +
      "her head in place and angling her face fully upward. Her lips are wrapped " +
      "around a dark thick erect penis that descends from just above the frame — " +
      "the shaft entering her mouth, her lips sealed around it, her expression " +
      "overwhelmed but eyes locked on the camera. Her long braids spill over " +
      "both of his gripping hands. Her voluptuous bare chest and heavy breasts " +
      "visible below in the lower frame. " +
      "The anonymous dark-skinned man is entirely above frame — only his dark " +
      "cock, his two large dark hands gripping her head on both sides, and the " +
      "bare lowest edge of his hips visible at the very top of frame. " +
      "Middelburg mechanic workshop, after closing. Single fluorescent strip " +
      "light directly overhead throws harsh clean white-blue light onto her " +
      "upturned face and the two dark hands gripping her braids. Dramatic " +
      "overhead illumination, hard shadows under her cheekbones. Workshop " +
      "concrete floor and tool wall blurred behind her. " +
      "Shot from directly above, tight crop on her upturned face, both gripping " +
      "hands, and the cock in her mouth. POV perspective looking down. Shallow " +
      "depth of field. Photorealistic, cinematic, 8k editorial photography.",
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
  const dateStr = new Date().toLocaleString("en-GB");

  const byScene = new Map<string, Result[]>();
  for (const r of results) {
    if (!byScene.has(r.sceneId)) byScene.set(r.sceneId, []);
    byScene.get(r.sceneId)!.push(r);
  }

  let sceneHtml = "";
  let lastPart = "";

  for (const scene of SCENES) {
    const part = scene.id.startsWith("kiss") ? "A" : scene.id.startsWith("side") ? "B" : "C";
    if (part !== lastPart) {
      const label = part === "A"
        ? "Part A — Kissing (Sibusiso's locked description + lips pressed together)"
        : part === "B"
          ? "Part B — Side Profile (woman's face & breasts visible, man cropped out except cock)"
          : "Part C — Blowjob POV (looking up at camera, man anonymous)";
      sceneHtml += `<div class="part-header"><h2>${label}</h2></div>`;
      lastPart = part;
    }

    const sceneResults = byScene.get(scene.id) || [];
    const cols = sceneResults.map((r) => {
      const img = r.success
        ? `<img src="${r.filename}" loading="lazy" onclick="openModal(this.src,'${scene.name} — seed ${r.seed}')" />`
        : `<div class="filtered">${r.filtered ? "⚠ FILTERED" : "✗ FAILED"}<br><span>${r.error || ""}</span></div>`;
      const badge = r.success
        ? `<span class="badge pass">✓ ${(r.executionTime / 1000).toFixed(1)}s</span>`
        : `<span class="badge ${r.filtered ? "filtered-badge" : "fail"}">${r.filtered ? "Filtered" : "Failed"}</span>`;
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
<title>Hunyuan Kiss v2 + BJ POV</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{--bg:#0a0607;--surface:#1a1012;--crimson:#8b1a2b;--crimson-light:#c4384f;--amber-light:#f5c542;--text:#e8ddd0;--text-muted:#8a7d72;--radius:8px}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;line-height:1.6}
  .header{text-align:center;padding:60px 20px 40px;background:linear-gradient(180deg,#1a0a0e 0%,var(--bg) 100%);border-bottom:1px solid rgba(139,26,43,0.3)}
  .header h1{font-family:'Playfair Display',serif;font-size:2.2rem;background:linear-gradient(135deg,var(--amber-light),var(--crimson-light));-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px}
  .header .subtitle{color:var(--text-muted);font-size:.9rem}
  .stats{display:flex;justify-content:center;gap:40px;margin-top:20px}
  .stat .number{font-family:'Playfair Display',serif;font-size:2rem;color:var(--amber-light)}
  .stat .label{font-size:.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px}
  .section{max-width:1300px;margin:0 auto;padding:40px 20px}
  .part-header{margin:40px 0 16px}
  .part-header h2{font-family:'Playfair Display',serif;font-size:1.4rem;color:var(--crimson-light);border-bottom:1px solid rgba(139,26,43,0.3);padding-bottom:10px}
  .scene-block{background:var(--surface);border:1px solid rgba(139,26,43,0.15);border-radius:var(--radius);margin-bottom:24px;overflow:hidden}
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
  .filtered span{font-size:.7rem;color:var(--text-muted);font-weight:400;margin-top:6px}
  .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.7rem;font-weight:600;margin-top:6px}
  .badge.pass{background:rgba(45,106,79,.2);color:#6fcf97;border:1px solid rgba(45,106,79,.4)}
  .badge.fail,.badge.filtered-badge{background:rgba(139,26,43,.2);color:var(--crimson-light);border:1px solid rgba(139,26,43,.4)}
  .modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:1000;align-items:center;justify-content:center;padding:20px;cursor:pointer}
  .modal-overlay.active{display:flex}
  .modal-content{max-width:90vw;max-height:90vh;display:flex;gap:24px;align-items:flex-start;cursor:default}
  .modal-content img{max-height:88vh;max-width:60vw;object-fit:contain;border-radius:var(--radius)}
  .modal-details h3{font-family:'Playfair Display',serif;font-size:1rem;color:var(--amber-light);max-width:320px}
  @media(max-width:800px){.seed-grid{grid-template-columns:1fr!important}.modal-content{flex-direction:column}.modal-content img{max-width:90vw}}
</style>
</head>
<body>
<div class="header">
  <h1>Hunyuan Kiss v2 + BJ POV Test</h1>
  <p class="subtitle">Lips pressed together · Sibusiso's locked description · BJ POV variations · ${dateStr}</p>
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

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

async function main() {
  if (!process.env.REPLICATE_API_TOKEN) {
    console.error("ERROR: REPLICATE_API_TOKEN not found in .env.local");
    process.exit(1);
  }

  const totalGenerations = SCENES.reduce((acc, s) => acc + s.seeds, 0);

  console.log("=".repeat(60));
  console.log("  Hunyuan Kiss v2 + BJ POV Test");
  console.log("=".repeat(60));
  console.log(`  Part A: kissing × 3 seeds (Sibusiso locked + lips fixed)`);
  console.log(`  Part B: side profile × 4 variations × 1 seed each`);
  console.log(`  Part C: BJ POV × 3 variations × 1 seed each`);
  console.log(`  Total:  ${totalGenerations} generations`);
  console.log("=".repeat(60));

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const results: Result[] = [];
  const baseSeed = Math.floor(Math.random() * 1_000_000);
  let genIndex = 0;

  for (const scene of SCENES) {
    const partLabel = scene.id.startsWith("kiss") ? "PART A: KISSING" : scene.id.startsWith("side") ? "PART B: SIDE PROFILE" : "PART C: BJ POV";
    console.log(`\n━━━ ${partLabel} — ${scene.name} ━━━`);

    for (let s = 0; s < scene.seeds; s++) {
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

  const passed = results.filter((r) => r.success).length;
  const filtered = results.filter((r) => r.filtered).length;
  console.log("\n" + "=".repeat(60));
  console.log("  RESULTS");
  console.log("=".repeat(60));
  for (const r of results) {
    const icon = r.success ? "✓" : r.filtered ? "⚠" : "✗";
    const status = r.success ? `${(r.executionTime / 1000).toFixed(1)}s` : r.filtered ? "FILTERED" : "FAILED";
    console.log(`  ${icon} [seed ${r.seed}] ${r.sceneName.split(":")[0]} [${status}]`);
  }
  console.log(`\n  Total: ${passed}/${totalGenerations} generated, ${filtered} filtered`);
  console.log(`\n  open ${path.resolve(reportPath)}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
