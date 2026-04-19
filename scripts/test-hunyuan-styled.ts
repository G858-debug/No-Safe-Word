/**
 * HunyuanImage 3.0 — Style-injected test (levels 1-3)
 * Appends the Flux 2 Dev warm amber/crimson style to each prompt.
 *
 * Usage: npx tsx scripts/test-hunyuan-styled.ts
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

const OUTPUT_DIR = "./hunyuan3_results/styled";
const MODEL = "tencent/hunyuan-image-3" as `${string}/${string}`;

const STYLE_SUFFIX =
  "Warm amber and deep crimson colour palette. Candlelit or low warm " +
  "artificial lighting with golden highlights on skin. Cinematic shallow " +
  "depth of field. Rich deep shadows. Intimate luxurious atmosphere. " +
  "Soft luminous skin glow. Moody, sensual tone. 8k editorial photography, " +
  "photorealistic, RAW photo quality.";

const BODY =
  "extremely voluptuous body with very large heavy breasts, deep cleavage, " +
  "tiny narrow waist, very wide hips, and a large round protruding backside";

const TESTS = [
  {
    id: "level_01_clothed",
    level: 1,
    name: "Level 1: Fully clothed \u2014 red dress, restaurant",
    prompt:
      `A stunning Black South African woman, age 25, ${BODY}. Medium-brown ` +
      "skin, long black braids pinned up loosely. She wears a skin-tight deep " +
      "red dress with a plunging neckline showing generous cleavage, gold " +
      "earrings catching the light. Seated at a candlelit restaurant table, " +
      "leaning forward with a wine glass in hand, looking directly at the " +
      "camera with a seductive knowing smile. Warm candlelight, deep crimson " +
      "ambient lighting. Medium close-up, eye-level, shallow depth of field. " +
      "Photorealistic, editorial photography.",
  },
  {
    id: "level_02_nightgown",
    level: 2,
    name: "Level 2: Suggestive \u2014 silk nightgown, bedroom",
    prompt:
      `A beautiful Black South African woman, age 25, ${BODY}. Medium-brown ` +
      "skin, long braids loose over her shoulders. She wears a short silk " +
      "burgundy nightgown with thin straps and a dangerously low neckline " +
      "that barely contains her generous bust, the fabric clinging to every " +
      "curve. She sits on a bed with deep red sheets, legs tucked to the side " +
      "showing her thick thighs, looking at the camera with a playful secret " +
      "smile. Warm golden light from a bedside lamp, African print cushions. " +
      "Medium shot, slight overhead angle, shallow depth of field. Photorealistic.",
  },
  {
    id: "level_03_lingerie",
    level: 3,
    name: "Level 3: Lingerie \u2014 bra and underwear, doorframe",
    prompt:
      `A beautiful Black South African woman, age 25, ${BODY}. Medium-brown ` +
      "skin, long black braids. She stands in a luxurious bedroom wearing a " +
      "black lace bra struggling to contain her generous bust and matching " +
      "underwear. Three-quarter pose showing her prominent curves as she " +
      "leans against the doorframe, looking over her shoulder at the camera " +
      "with a sultry, half-lidded expression. Warm golden light from a " +
      "bedside lamp casting soft shadows across her skin. Medium shot, " +
      "slight low angle, shallow depth of field. Photorealistic.",
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
    const resp = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    fs.writeFileSync(savePath, Buffer.from(await resp.arrayBuffer()));
    return true;
  } catch (err) {
    console.error(`  Download failed: ${err}`);
    return false;
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("  HunyuanImage 3.0 \u2014 Style-Injected Test (Levels 1-3)");
  console.log("=".repeat(60));
  console.log(`  Style suffix: "${STYLE_SUFFIX.slice(0, 60)}..."`);
  console.log("=".repeat(60));

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const baseSeed = Math.floor(Math.random() * 1_000_000);

  for (let i = 0; i < TESTS.length; i++) {
    const test = TESTS[i];
    const seed = baseSeed + i;
    const styledPrompt = `${test.prompt} ${STYLE_SUFFIX}`;

    console.log(`\n\u2501\u2501\u2501 [${i + 1}/${TESTS.length}] ${test.name} \u2501\u2501\u2501`);

    const start = Date.now();
    try {
      const output = await client.run(MODEL, {
        input: {
          prompt: styledPrompt,
          seed,
          go_fast: true,
          aspect_ratio: "2:3",
          output_format: "png",
          output_quality: 95,
          disable_safety_checker: true,
        },
      });
      const elapsed = Date.now() - start;
      const url = extractUrl(output);

      if (url) {
        const savePath = path.join(OUTPUT_DIR, `${test.id}_styled.png`);
        const ok = await downloadImage(url, savePath);
        if (ok) {
          console.log(`  \u2713 Saved: ${savePath} (${(elapsed / 1000).toFixed(1)}s)`);
          // Also copy to flux2_dev_results for easy comparison
          const compPath = `./flux2_dev_results/hunyuan3_styled_${test.id}.png`;
          fs.copyFileSync(savePath, compPath);
          console.log(`  \u2713 Copied to: ${compPath}`);
        }
      } else {
        console.log(`  \u2717 No image returned (${(elapsed / 1000).toFixed(1)}s)`);
      }
    } catch (err) {
      console.log(`  \u2717 Error: ${err}`);
    }

    if (i < TESTS.length - 1) await new Promise((r) => setTimeout(r, 2000));
  }

  console.log("\n" + "=".repeat(60));
  console.log("  Done! Compare in flux2_dev_results/:");
  console.log("    level_XX_*.png              \u2014 Flux 2 Dev originals");
  console.log("    hunyuan3_level_XX_*.png     \u2014 HunyuanImage 3.0 (no style)");
  console.log("    hunyuan3_styled_level_XX_*.png \u2014 HunyuanImage 3.0 (styled)");
  console.log("=".repeat(60));
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
