/**
 * Test script: Two-pass generation for multi-person interaction scenes.
 *
 * Tests the new two-pass workflow:
 *   Pass 1: Scene composition WITHOUT character LoRAs (full CLIP budget for pose)
 *   Pass 2: Identity refinement WITH character LoRAs (moderate denoise)
 *
 * Usage: npx tsx --env-file=apps/web/.env.local scripts/test-two-pass.ts
 */

import { buildTwoPassWorkflow, buildWorkflow } from "@no-safe-word/image-gen";
import { submitRunPodJob, getRunPodJobStatus, base64ToBuffer, detectCorruptedImage } from "@no-safe-word/image-gen";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const OUTPUT_DIR = "/tmp/two-pass-test";

const CHARACTER_LORAS: Record<string, { filename: string; url: string; triggerWord: string }> = {
  thabo: { filename: "characters/lora_thabo_nkosi_nsw.safetensors", url: "https://mqemiteirxwscxtamdtj.supabase.co/storage/v1/object/public/lora-training-datasets/trained/characters/lora_thabo_nkosi_nsw_1775678623117.safetensors", triggerWord: "thabo_nkosi_nsw" },
  naledi: { filename: "characters/lora_naledi_dlamini_nsw.safetensors", url: "https://mqemiteirxwscxtamdtj.supabase.co/storage/v1/object/public/lora-training-datasets/trained/characters/lora_naledi_dlamini_nsw_1775697205367.safetensors", triggerWord: "naledi_dlamini_nsw" },
};

interface TestJob {
  label: string;
  /** Pass 1: Full scene description, no trigger words */
  scenePrompt: string;
  /** Pass 2: Scene + trigger words for identity */
  refinementPrompt: string;
  negativePrompt: string;
  characters: string[];
  loraStrengthModel: number;
  loraStrengthClip: number;
  refinementDenoise: number;
  width: number;
  height: number;
  cfg: number;
  steps: number;
}

const NSFW_NEG = "bad anatomy, bad hands, extra limbs, extra fingers, mutated hands, watermark, blurry, text, cartoon, illustration, painting, drawing, low quality, worst quality, deformed, disfigured, three people, group, crowd";

const JOBS: TestJob[] = [
  // ── Doggystyle: the prompt that kept failing ──
  {
    label: "2pass_doggy",
    scenePrompt: "photograph, cinematic, 1girl 1boy, sex, doggystyle, rear entry sex position on bed, woman on her hands and knees facing away, man kneeling directly behind her gripping her wide hips, she looks back over her shoulder at him with parted lips, both completely nude, dark bedroom, moonlight through curtains casting blue-silver stripes across bodies, low angle, dramatic lighting",
    refinementPrompt: "photograph, cinematic, thabo_nkosi_nsw, naledi_dlamini_nsw, 1girl 1boy, sex, doggystyle on bed, both nude, dark bedroom, moonlight through curtains, dramatic lighting",
    negativePrompt: NSFW_NEG,
    characters: ["thabo", "naledi"],
    loraStrengthModel: 0.75,
    loraStrengthClip: 0.45,
    refinementDenoise: 0.35,
    width: 1216,
    height: 832,
    cfg: 4.5,
    steps: 35,
  },

  // ── Cowgirl: woman on top ──
  {
    label: "2pass_cowgirl",
    scenePrompt: "photograph, cinematic, 1girl 1boy, sex, cowgirl position, woman sitting upright straddling man lying flat on his back, her hands pressing on his chest, head tilted back eyes closed in pleasure, his hands on her thighs, both nude, sweat on skin, township bedroom, warm bedside lamp light from below, tangled sheets, medium shot slightly low angle looking up, golden warm tones",
    refinementPrompt: "photograph, cinematic, thabo_nkosi_nsw, naledi_dlamini_nsw, 1girl 1boy, cowgirl position, both nude, township bedroom, warm golden light",
    negativePrompt: NSFW_NEG,
    characters: ["thabo", "naledi"],
    loraStrengthModel: 0.75,
    loraStrengthClip: 0.45,
    refinementDenoise: 0.35,
    width: 1216,
    height: 832,
    cfg: 4.5,
    steps: 35,
  },

  // ── Kissing at bar ──
  {
    label: "2pass_bar_kiss",
    scenePrompt: "photograph, cinematic, 1girl 1boy, kissing against bar counter, she sits on counter legs wrapped around his waist, his hands on her hips, her arms around his neck, empty shebeen after closing, neon beer signs glowing, bottles on shelves behind, medium shot, neon green and amber light, moody atmosphere",
    refinementPrompt: "photograph, cinematic, thabo_nkosi_nsw, naledi_dlamini_nsw, 1girl 1boy, kissing at bar, neon beer signs, moody atmosphere",
    negativePrompt: NSFW_NEG,
    characters: ["thabo", "naledi"],
    loraStrengthModel: 0.75,
    loraStrengthClip: 0.45,
    refinementDenoise: 0.35,
    width: 1216,
    height: 832,
    cfg: 4.5,
    steps: 35,
  },

  // ── Control: same doggystyle prompt with OLD single-pass unified approach ──
  {
    label: "1pass_doggy_control",
    scenePrompt: "", // Not used for single-pass
    refinementPrompt: "", // Not used
    negativePrompt: NSFW_NEG,
    characters: ["thabo", "naledi"],
    loraStrengthModel: 0.65,
    loraStrengthClip: 0.4,
    refinementDenoise: 0, // 0 = single-pass mode
    width: 1216,
    height: 832,
    cfg: 4.5,
    steps: 35,
  },
];

async function generateAndPoll(job: TestJob): Promise<string | null> {
  const seed = Math.floor(Math.random() * 2_147_483_647) + 1;
  console.log(`\n━━ ${job.label} (seed=${seed}) ━━`);

  const loras = job.characters.map(charKey => {
    const lora = CHARACTER_LORAS[charKey];
    return {
      filename: lora.filename,
      strengthModel: job.loraStrengthModel,
      strengthClip: job.loraStrengthClip,
    };
  });

  const characterLoraDownloads = job.characters.map(charKey => {
    const lora = CHARACTER_LORAS[charKey];
    return { filename: lora.filename, url: lora.url };
  });

  let workflow: Record<string, any>;

  if (job.refinementDenoise > 0) {
    // Two-pass mode
    console.log(`  Mode: TWO-PASS (denoise=${job.refinementDenoise})`);
    console.log(`  Pass 1: ${job.scenePrompt.substring(0, 80)}...`);
    console.log(`  Pass 2: ${job.refinementPrompt.substring(0, 80)}...`);

    workflow = buildTwoPassWorkflow({
      scenePrompt: job.scenePrompt,
      refinementPrompt: job.refinementPrompt,
      negativePrompt: job.negativePrompt,
      width: job.width,
      height: job.height,
      seed,
      cfg: job.cfg,
      steps: job.steps,
      refinementDenoise: job.refinementDenoise,
      refinementSteps: 20,
      filenamePrefix: `test_${job.label}`,
      loras,
    });
  } else {
    // Single-pass control (old approach)
    const controlPrompt = "photograph, cinematic, thabo_nkosi_nsw, naledi_dlamini_nsw, 1boy, 1girl, sex, doggystyle, rear entry sex position on bed, woman on her hands and knees, man kneeling behind her gripping her hips, looking back over shoulder, both nude, dark bedroom, moonlight through curtains, dramatic lighting";
    console.log(`  Mode: SINGLE-PASS (control)`);
    console.log(`  Prompt: ${controlPrompt.substring(0, 80)}...`);

    workflow = buildWorkflow({
      positivePrompt: controlPrompt,
      negativePrompt: job.negativePrompt,
      width: job.width,
      height: job.height,
      seed,
      cfg: job.cfg,
      steps: job.steps,
      filenamePrefix: `test_${job.label}`,
      loras,
    });
  }

  const { jobId } = await submitRunPodJob(workflow, undefined, characterLoraDownloads);
  console.log(`  Submitted: ${jobId}`);

  let attempts = 0;
  while (attempts < 90) {
    attempts++;
    await new Promise(r => setTimeout(r, 5000));
    const status = await getRunPodJobStatus(jobId);

    if (status.status === "COMPLETED" && status.output?.images?.[0]) {
      const imageData = status.output.images[0].data;
      const base64Data = imageData.includes(",") ? imageData.split(",")[1] : imageData;
      const buffer = base64ToBuffer(base64Data);

      const corruption = await detectCorruptedImage(base64Data);
      if (corruption.corrupted) {
        console.log(`  ✗ NOISE DETECTED: ${corruption.reason}`);
        return null;
      }

      const filename = `${job.label}_${seed}.png`;
      const filepath = path.join(OUTPUT_DIR, filename);
      fs.writeFileSync(filepath, buffer);
      console.log(`  ✓ Saved: ${filepath} (${(buffer.length / 1024).toFixed(0)}KB)`);
      return filepath;
    }

    if (status.status === "FAILED") {
      console.log(`  ✗ FAILED: ${status.error}`);
      return null;
    }

    if (attempts % 12 === 0) console.log(`  ... polling (${attempts * 5}s)`);
  }

  console.log(`  ✗ TIMEOUT after ${attempts * 5}s`);
  return null;
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`Output directory: ${OUTPUT_DIR}`);
  console.log(`Testing ${JOBS.length} jobs...\n`);

  const results: Array<{ label: string; path: string | null }> = [];

  for (const job of JOBS) {
    const filepath = await generateAndPoll(job);
    results.push({ label: job.label, path: filepath });
  }

  console.log("\n\n═══ RESULTS ═══");
  for (const r of results) {
    console.log(`  ${r.path ? "✓" : "✗"} ${r.label}: ${r.path || "FAILED"}`);
  }
  console.log(`\nOpen ${OUTPUT_DIR} to compare two-pass vs single-pass results.`);
}

main().catch(console.error);
