/**
 * Iteration 3: Final 3 images that still need work.
 * - Bathroom F/F: generated 3 people, need exactly 2
 * - Doggy: wrong position, need specific pose
 * - Cowgirl: wrong position, need woman on top
 *
 * Strategy: Even more explicit descriptions, no LoRAs for position-critical shots
 * to maximize token budget for pose details.
 *
 * Usage: npx tsx --env-file=apps/web/.env.local scripts/iterate-image-v3.ts
 */

import { buildWorkflow } from "@no-safe-word/image-gen";
import { submitRunPodJob, getRunPodJobStatus, base64ToBuffer, detectCorruptedImage } from "@no-safe-word/image-gen";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const OUTPUT_DIR = "/tmp/middelburg-iterations-v3";

const CHARACTER_LORAS: Record<string, { filename: string; url: string; triggerWord: string }> = {
  thabo: { filename: "characters/lora_thabo_nkosi_nsw.safetensors", url: "https://mqemiteirxwscxtamdtj.supabase.co/storage/v1/object/public/lora-training-datasets/trained/characters/lora_thabo_nkosi_nsw_1775678623117.safetensors", triggerWord: "thabo_nkosi_nsw" },
  naledi: { filename: "characters/lora_naledi_dlamini_nsw.safetensors", url: "https://mqemiteirxwscxtamdtj.supabase.co/storage/v1/object/public/lora-training-datasets/trained/characters/lora_naledi_dlamini_nsw_1775697205367.safetensors", triggerWord: "naledi_dlamini_nsw" },
};

interface ImageJob {
  promptId: string;
  label: string;
  positivePrompt: string;
  negativePrompt: string;
  characters: string[];
  loraStrengthModel: number;
  loraStrengthClip: number;
  mode: "sfw" | "nsfw";
  width: number;
  height: number;
  cfg: number;
  steps: number;
}

const NSFW_NEG = "bad anatomy, bad hands, extra limbs, extra fingers, mutated hands, watermark, blurry, text, cartoon, illustration, painting, drawing, low quality, worst quality, deformed, disfigured, three people, group, crowd";

const JOBS: ImageJob[] = [
  // ── Bathroom F/F: exactly 2 women, tiled bathroom ──
  // Added "two women only" and "three people" to negative
  {
    promptId: "9421c92b-101a-49dd-ae3f-9d8e724b2c06",
    label: "P2 Bathroom FF NSFW v3",
    positivePrompt: "photograph, cinematic, exactly two women alone in small tiled bathroom, one woman with braids wearing white blouse open at front pressing the other woman against blue tile wall, second woman with short TWA natural hair wearing satin slip dress pulled off one shoulder, intimate touching, foreheads close, fluorescent ceiling light, small cramped bathroom, tight close-up two-shot, naledi_dlamini_nsw",
    negativePrompt: NSFW_NEG,
    characters: ["naledi"],
    loraStrengthModel: 0.5,
    loraStrengthClip: 0.25,
    mode: "nsfw",
    width: 1216,
    height: 832,
    cfg: 5.5,
    steps: 35,
  },

  // ── Doggy: Drop LoRA entirely to maximize position accuracy ──
  {
    promptId: "e926d559-253b-4fa2-b9d1-79e33487024a",
    label: "P3 Doggy NSFW v3",
    positivePrompt: "photograph, cinematic, rear entry sex position on bed, Black woman on her hands and knees facing away from camera, muscular Black man kneeling directly behind her gripping her hips, her back arched deeply, she turns her head looking back over her shoulder, both completely nude, dark blue bedroom, moonlight streaming through sheer curtains casting silver light stripes across their bodies, dramatic side lighting, medium wide shot from low angle",
    negativePrompt: "bad anatomy, bad hands, extra limbs, watermark, blurry, text, cartoon, illustration, painting, low quality, worst quality, deformed, three people, group",
    characters: [],
    loraStrengthModel: 0,
    loraStrengthClip: 0,
    mode: "nsfw",
    width: 1216,
    height: 832,
    cfg: 5.5,
    steps: 35,
  },

  // ── Cowgirl: Drop LoRA, maximize position detail ──
  {
    promptId: "54007739-b33e-4eca-b974-15f002d6f07e",
    label: "P3 Cowgirl NSFW v3",
    positivePrompt: "photograph, cinematic, woman on top cowgirl sex position, curvy Black woman sitting upright straddling a muscular Black man who lies flat on his back on bed, her palms pressing on his chest, her head tilted back with eyes closed in ecstasy, his hands gripping her thighs, both nude, warm bedside lamp illumination from below, white tangled sheets, township bedroom, medium shot from slightly low angle looking up at her, golden warm tones",
    negativePrompt: "bad anatomy, bad hands, extra limbs, watermark, blurry, text, cartoon, illustration, painting, low quality, worst quality, deformed, three people, group",
    characters: [],
    loraStrengthModel: 0,
    loraStrengthClip: 0,
    mode: "nsfw",
    width: 1216,
    height: 832,
    cfg: 5.5,
    steps: 35,
  },
];

async function generateAndPoll(job: ImageJob): Promise<{ imagePath: string; imageId: string } | null> {
  const seed = Math.floor(Math.random() * 2_147_483_647) + 1;
  console.log(`\n── ${job.label} (seed=${seed}) ──`);

  const loras = job.characters.map(charKey => {
    const lora = CHARACTER_LORAS[charKey];
    return { filename: lora.filename, strengthModel: job.loraStrengthModel, strengthClip: job.loraStrengthClip };
  });
  const loraDownloads = job.characters.map(charKey => {
    const lora = CHARACTER_LORAS[charKey];
    return { filename: lora.filename, url: lora.url };
  });

  const workflow = buildWorkflow({
    positivePrompt: job.positivePrompt,
    negativePrompt: job.negativePrompt,
    width: job.width,
    height: job.height,
    seed,
    cfg: job.cfg,
    steps: job.steps,
    filenamePrefix: `iter3_${job.promptId.substring(0, 8)}`,
    loras: loras.length > 0 ? loras : undefined,
  });

  const { jobId } = await submitRunPodJob(workflow, undefined, loraDownloads.length > 0 ? loraDownloads : undefined);
  console.log(`   Submitted: ${jobId}`);

  const { data: imageRow, error } = await supabase.from("images").insert({
    character_id: null, prompt: job.positivePrompt, negative_prompt: job.negativePrompt,
    settings: { width: job.width, height: job.height, steps: job.steps, cfg: job.cfg, seed, engine: "runpod-v4-juggernaut-ragnarok", attemptNumber: 3, compositionType: "dual", contentMode: job.mode },
    mode: job.mode,
  }).select("id").single();

  if (error || !imageRow) { console.error(`   DB error: ${error?.message}`); return null; }
  await supabase.from("generation_jobs").insert({ job_id: `runpod-${jobId}`, image_id: imageRow.id, status: "pending", cost: 0 });

  let attempts = 0;
  while (attempts < 60) {
    attempts++;
    await new Promise(r => setTimeout(r, 5000));
    const status = await getRunPodJobStatus(jobId);
    if (status.status === "COMPLETED" && status.output?.images?.[0]) {
      const imageData = status.output.images[0].data;
      const base64Data = imageData.includes(",") ? imageData.split(",")[1] : imageData;
      const buffer = base64ToBuffer(base64Data);
      const corruption = await detectCorruptedImage(base64Data);
      if (corruption.corrupted) { console.log(`   ✗ NOISE: ${corruption.reason.substring(0, 60)}`); return null; }

      const filename = `${job.label.replace(/[^a-zA-Z0-9]/g, "_")}_${seed}.png`;
      const filepath = path.join(OUTPUT_DIR, filename);
      fs.writeFileSync(filepath, buffer);
      console.log(`   ✓ Saved: ${filepath} (${(buffer.length / 1024).toFixed(0)}KB)`);

      const timestamp = Date.now();
      const storagePath = `stories/${imageRow.id}-${timestamp}.png`;
      await supabase.storage.from("story-images").upload(storagePath, buffer, { contentType: "image/png", upsert: true });
      const { data: { publicUrl } } = supabase.storage.from("story-images").getPublicUrl(storagePath);
      await supabase.from("images").update({ stored_url: publicUrl, sfw_url: publicUrl }).eq("id", imageRow.id);
      await supabase.from("generation_jobs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("job_id", `runpod-${jobId}`);
      return { imagePath: filepath, imageId: imageRow.id };
    }
    if (status.status === "FAILED") { console.log(`   ✗ FAILED: ${status.error}`); return null; }
    if (attempts % 6 === 0) console.log(`   ... polling (${attempts * 5}s, status=${status.status})`);
  }
  return null;
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`=== Iteration 3: ${JOBS.length} images ===\n`);
  const results: { label: string; success: boolean; path?: string; imageId?: string }[] = [];
  for (const job of JOBS) {
    const result = await generateAndPoll(job);
    if (result) {
      await supabase.from("story_image_prompts").update({ image_id: result.imageId, status: "generated" }).eq("id", job.promptId);
      results.push({ label: job.label, success: true, path: result.imagePath, imageId: result.imageId });
    } else {
      results.push({ label: job.label, success: false });
    }
  }
  console.log("\n=== Results ===");
  for (const r of results) console.log(`  ${r.success ? "✓" : "✗"} ${r.label}${r.path ? ` → ${r.path}` : ""}`);
}

main().catch(console.error);
