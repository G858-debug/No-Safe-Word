/**
 * Iteration 2: Focused on the 13 images that still need work.
 *
 * Key changes from iteration 1:
 * - Lower LoRA strength (model 0.55, clip 0.3) to let scene details come through
 * - Put ACTION/POSE first in prompt, before quality prefix
 * - Use more explicit booru-style position tags for NSFW
 * - Higher CFG (5.5) for better prompt adherence
 * - For dual-char scenes: describe the INTERACTION prominently
 *
 * Usage: npx tsx --env-file=apps/web/.env.local scripts/iterate-image-v2.ts
 */

import { buildWorkflow } from "@no-safe-word/image-gen";
import { submitRunPodJob, getRunPodJobStatus, base64ToBuffer, detectCorruptedImage } from "@no-safe-word/image-gen";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const OUTPUT_DIR = "/tmp/middelburg-iterations-v2";

const CHARACTER_LORAS: Record<string, {
  filename: string;
  url: string;
  triggerWord: string;
}> = {
  thabo: {
    filename: "characters/lora_thabo_nkosi_nsw.safetensors",
    url: "https://mqemiteirxwscxtamdtj.supabase.co/storage/v1/object/public/lora-training-datasets/trained/characters/lora_thabo_nkosi_nsw_1775678623117.safetensors",
    triggerWord: "thabo_nkosi_nsw",
  },
  sipho: {
    filename: "characters/lora_sipho_mthembu_nsw.safetensors",
    url: "https://mqemiteirxwscxtamdtj.supabase.co/storage/v1/object/public/lora-training-datasets/trained/characters/lora_sipho_mthembu_nsw_1775697202770.safetensors",
    triggerWord: "sipho_mthembu_nsw",
  },
  naledi: {
    filename: "characters/lora_naledi_dlamini_nsw.safetensors",
    url: "https://mqemiteirxwscxtamdtj.supabase.co/storage/v1/object/public/lora-training-datasets/trained/characters/lora_naledi_dlamini_nsw_1775697205367.safetensors",
    triggerWord: "naledi_dlamini_nsw",
  },
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

const SFW_NEG = "nudity, naked, nsfw, topless, nude, exposed breasts, nipples, bad anatomy, bad hands, extra limbs, extra fingers, mutated hands, watermark, blurry, text, cartoon, illustration, painting, drawing, low quality, worst quality, deformed, disfigured";
const NSFW_NEG = "bad anatomy, bad hands, extra limbs, extra fingers, mutated hands, watermark, blurry, text, cartoon, illustration, painting, drawing, low quality, worst quality, deformed, disfigured";

const JOBS: ImageJob[] = [
  // ── #1: Workshop dual - PUT INTERACTION FIRST ──
  {
    promptId: "ca4f323c-72c8-460f-b729-4a4fb118b057",
    label: "P1 Workshop dual NSFW v2",
    positivePrompt: "photograph, cinematic, couple standing face to face in mechanic workshop, woman placing her hand on man's chest, man's hand on her waist, intense eye contact between them, sexual tension, she wears tank top and unzipped overalls, he wears grey henley shirt, single work lamp dramatic side lighting, warm golden tones, two-shot medium close-up, thabo_nkosi_nsw",
    negativePrompt: NSFW_NEG,
    characters: ["thabo"],
    loraStrengthModel: 0.55,
    loraStrengthClip: 0.3,
    mode: "nsfw",
    width: 1216,
    height: 832,
    cfg: 5.5,
    steps: 35,
  },

  // ── #6: Shebeen wall - NEED BOTH PEOPLE ──
  {
    promptId: "f2463cfe-4bc2-41fa-9f45-d69f6818848e",
    label: "P2 Shebeen wall NSFW v2",
    positivePrompt: "photograph, cinematic, couple outside at night, man pinning woman against corrugated iron wall, his hand braced on wall above her head, she looks up at him defiantly, he looks down with desire, both fully clothed, amber streetlight casting long shadows, township street background, full body shot low angle, thabo_nkosi_nsw",
    negativePrompt: NSFW_NEG,
    characters: ["thabo"],
    loraStrengthModel: 0.55,
    loraStrengthClip: 0.3,
    mode: "nsfw",
    width: 1216,
    height: 832,
    cfg: 5.5,
    steps: 35,
  },

  // ── #10: Kiss wall - EMPHASIZE KISSING ──
  {
    promptId: "c312822d-0417-46c7-ba9a-5eb5424151b0",
    label: "P2 Kiss wall NSFW v2",
    positivePrompt: "photograph, cinematic, man and woman kissing passionately, mouths pressed together, eyes closed, pressed against corrugated iron wall at night, his hand cupping her face, her hands gripping his shirt, single amber streetlight, Middelburg township, medium shot, shallow depth of field, thabo_nkosi_nsw",
    negativePrompt: NSFW_NEG,
    characters: ["thabo"],
    loraStrengthModel: 0.55,
    loraStrengthClip: 0.3,
    mode: "nsfw",
    width: 1216,
    height: 832,
    cfg: 5.5,
    steps: 35,
  },

  // ── #7: Bathroom F/F - SETTING AND CLOTHING FIRST ──
  {
    promptId: "9421c92b-101a-49dd-ae3f-9d8e724b2c06",
    label: "P2 Bathroom FF NSFW v2",
    positivePrompt: "photograph, cinematic, two women in tiled bathroom, fluorescent light overhead, one woman with braids in unbuttoned white blouse pushing the other against tile wall, second woman with short natural hair in slip dress off one shoulder, intimate body contact, hands on each other, tight two-shot framing, harsh fluorescent lighting on tile, naledi_dlamini_nsw",
    negativePrompt: NSFW_NEG,
    characters: ["naledi"],
    loraStrengthModel: 0.55,
    loraStrengthClip: 0.3,
    mode: "nsfw",
    width: 1216,
    height: 832,
    cfg: 5.5,
    steps: 35,
  },

  // ── #11: F/F Kiss couch - FOREHEAD KISS ──
  {
    promptId: "a45e1fc1-8ae9-41b7-a43a-1e09e928978e",
    label: "P2 FF Kiss couch NSFW v2",
    positivePrompt: "photograph, cinematic, two women kissing tenderly on couch, foreheads touching, lips meeting, fingers interlaced, one with long braids one with short TWA, seated close on worn brown couch, table lamp warm glow beside them, lace curtains in background, dimly lit room, intimate close-up, soft warm lighting, naledi_dlamini_nsw",
    negativePrompt: NSFW_NEG,
    characters: ["naledi"],
    loraStrengthModel: 0.55,
    loraStrengthClip: 0.3,
    mode: "nsfw",
    width: 1216,
    height: 832,
    cfg: 5.5,
    steps: 35,
  },

  // ── #14: Naledi street - NURSE UNIFORM ──
  {
    promptId: "675e2c2a-7a93-481e-837a-8e4d10f97112",
    label: "P3 Naledi street NSFW v2",
    positivePrompt: "photograph, cinematic, woman in white nurse scrubs uniform under open dark jacket, walking alone on quiet township street at night, short natural TWA hair, looking at phone screen that illuminates her face, single streetlight overhead, long shadow stretching behind, Middelburg corrugated iron houses, full body shot, moody blue nighttime tones, naledi_dlamini_nsw",
    negativePrompt: NSFW_NEG,
    characters: ["naledi"],
    loraStrengthModel: 0.6,
    loraStrengthClip: 0.35,
    mode: "nsfw",
    width: 832,
    height: 1216,
    cfg: 5.5,
    steps: 35,
  },

  // ── #15: Toyota sex - NEED BOTH PEOPLE ON CAR ──
  {
    promptId: "6c315584-d193-4c99-8be8-b6e7751c59c7",
    label: "P3 Toyota sex NSFW v2",
    positivePrompt: "photograph, cinematic, couple on car hood at night, woman lying back on car bonnet, man leaning over her between her legs, his shirt removed, her top pulled up exposing stomach, bodies pressed together, sweat glistening, wide starry night sky overhead, moonlight and amber streetlight, overhead angle looking down at them, thabo_nkosi_nsw",
    negativePrompt: NSFW_NEG,
    characters: ["thabo"],
    loraStrengthModel: 0.55,
    loraStrengthClip: 0.3,
    mode: "nsfw",
    width: 1216,
    height: 832,
    cfg: 5.5,
    steps: 35,
  },

  // ── #17: Naledi+Sipho bar - NEED MAN + WOMAN ──
  // Key issue: both LoRAs loaded but model produced two women
  // Try: put sipho trigger FIRST, describe "man and woman" explicitly
  {
    promptId: "0c874b0f-e478-4e9a-8e7b-405ceade7e74",
    label: "P3 Naledi Sipho bar NSFW v2",
    positivePrompt: "photograph, cinematic, sipho_mthembu_nsw, 1boy 1girl, man and woman kissing at bar counter, she sits on wooden counter with legs wrapped around his waist, his hands on her hips, her arms around his neck, empty shebeen after hours, neon beer signs glowing green, bottles on shelves, medium shot, moody neon lighting, naledi_dlamini_nsw",
    negativePrompt: NSFW_NEG,
    characters: ["sipho", "naledi"],
    loraStrengthModel: 0.55,
    loraStrengthClip: 0.3,
    mode: "nsfw",
    width: 1216,
    height: 832,
    cfg: 5.5,
    steps: 35,
  },

  // ── #18: Missionary - POSITION FIRST ──
  {
    promptId: "39796451-64d7-4705-854a-dae304119890",
    label: "P3 Missionary NSFW v2",
    positivePrompt: "photograph, cinematic, missionary position sex on bed, man on top of woman, she lies on her back with legs wrapped around his waist, his arms braced beside her head, her hands gripping rumpled white sheets, eye contact between them, both nude, sweat on skin, township bedroom, warm bedside lamp amber glow, medium shot from side angle, thabo_nkosi_nsw",
    negativePrompt: NSFW_NEG,
    characters: ["thabo"],
    loraStrengthModel: 0.5,
    loraStrengthClip: 0.25,
    mode: "nsfw",
    width: 1216,
    height: 832,
    cfg: 5.5,
    steps: 35,
  },

  // ── #19: Doggy - POSITION DESCRIPTION FIRST ──
  {
    promptId: "e926d559-253b-4fa2-b9d1-79e33487024a",
    label: "P3 Doggy NSFW v2",
    positivePrompt: "photograph, cinematic, doggy style sex on bed, woman on all fours hands and knees, man kneeling behind her, his hands gripping her hips, her back arched, she looks back over shoulder at him, both nude, dark bedroom, moonlight through curtains casting blue silver light stripes on bodies, dramatic low angle, thabo_nkosi_nsw",
    negativePrompt: NSFW_NEG,
    characters: ["thabo"],
    loraStrengthModel: 0.5,
    loraStrengthClip: 0.25,
    mode: "nsfw",
    width: 1216,
    height: 832,
    cfg: 5.5,
    steps: 35,
  },

  // ── #20: Cowgirl - WOMAN ON TOP EMPHASIZED ──
  {
    promptId: "54007739-b33e-4eca-b974-15f002d6f07e",
    label: "P3 Cowgirl NSFW v2",
    positivePrompt: "photograph, cinematic, cowgirl position sex, woman straddling man on bed, she sits upright on top of him with hands on his chest, head tilted back in pleasure, he lies on his back with hands on her thighs, both nude, township bedroom, warm bedside lamp glow from below, tangled white sheets, medium shot low angle looking up at her, golden warm tones, thabo_nkosi_nsw",
    negativePrompt: NSFW_NEG,
    characters: ["thabo"],
    loraStrengthModel: 0.5,
    loraStrengthClip: 0.25,
    mode: "nsfw",
    width: 1216,
    height: 832,
    cfg: 5.5,
    steps: 35,
  },

  // ── #2: Zanele workshop NSFW - UNZIPPED OVERALLS ──
  {
    promptId: "8dead15c-cebb-41a7-83c9-00b8020a96b9",
    label: "P1 Zanele workshop NSFW v2",
    positivePrompt: "photograph, cinematic, young curvy Black woman with long braids in mechanic workshop, blue denim overalls unzipped and pulled down to waist showing fitted white tank top underneath, leaning back against car hood seductively, one hand resting on metal, provocative gaze at camera, lips parted, golden hour amber light from open bay door, oil and grease on her arms, medium shot, workshop interior with tools",
    negativePrompt: NSFW_NEG,
    characters: [],
    loraStrengthModel: 0,
    loraStrengthClip: 0,
    mode: "nsfw",
    width: 832,
    height: 1216,
    cfg: 5.0,
    steps: 35,
  },

  // ── #12: Standing sex NSFW - more specific position ──
  {
    promptId: "1bc67e60-5655-41e7-a393-8cdcc58d4e04",
    label: "P2 Standing sex NSFW v2",
    positivePrompt: "photograph, cinematic, standing sex against wall, woman pressed against concrete wall with one leg raised and held by man, man facing her supporting her lifted thigh, her arms wrapped around his neck, foreheads touching, both nude, concrete room with single bare bulb overhead, harsh light deep shadows, full body shot, raw urgent atmosphere, thabo_nkosi_nsw",
    negativePrompt: NSFW_NEG,
    characters: ["thabo"],
    loraStrengthModel: 0.5,
    loraStrengthClip: 0.25,
    mode: "nsfw",
    width: 832,
    height: 1216,
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
    filenamePrefix: `iter2_${job.promptId.substring(0, 8)}`,
    loras: loras.length > 0 ? loras : undefined,
  });

  const { jobId } = await submitRunPodJob(workflow, undefined, loraDownloads.length > 0 ? loraDownloads : undefined);
  console.log(`   Submitted: ${jobId}`);

  const { data: imageRow, error } = await supabase.from("images").insert({
    character_id: null,
    prompt: job.positivePrompt,
    negative_prompt: job.negativePrompt,
    settings: { width: job.width, height: job.height, steps: job.steps, cfg: job.cfg, seed, engine: "runpod-v4-juggernaut-ragnarok", attemptNumber: 2, compositionType: job.characters.length > 1 ? "dual" : "solo", contentMode: job.mode },
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
  console.log(`   ✗ Timed out`);
  return null;
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`=== Iteration 2: ${JOBS.length} images ===\n`);

  const results: { label: string; success: boolean; imageId?: string; path?: string }[] = [];

  for (const job of JOBS) {
    const result = await generateAndPoll(job);
    if (result) {
      await supabase.from("story_image_prompts").update({ image_id: result.imageId, status: "generated" }).eq("id", job.promptId);
      results.push({ label: job.label, success: true, imageId: result.imageId, path: result.imagePath });
    } else {
      results.push({ label: job.label, success: false });
    }
  }

  console.log("\n=== Results ===");
  for (const r of results) console.log(`  ${r.success ? "✓" : "✗"} ${r.label}${r.path ? ` → ${r.path}` : ""}`);
}

main().catch(console.error);
