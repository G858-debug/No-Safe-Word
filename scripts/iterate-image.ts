/**
 * Iterative image regeneration script.
 *
 * Bypasses convertProseToPrompt to use hand-crafted prompts for better prompt adherence.
 * For dual-character scenes, uses a single unified prompt instead of regional conditioning
 * to ensure interactions are properly rendered.
 *
 * Usage: npx tsx --env-file=apps/web/.env.local scripts/iterate-image.ts
 */

import { buildWorkflow } from "@no-safe-word/image-gen";
import { submitRunPodJob, getRunPodJobStatus, base64ToBuffer, detectCorruptedImage } from "@no-safe-word/image-gen";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const OUTPUT_DIR = "/tmp/middelburg-iterations";

// ── LoRA registry for deployed character LoRAs ──
const CHARACTER_LORAS: Record<string, {
  filename: string;
  url: string;
  triggerWord: string;
  expected_bytes?: number;
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

// ── Images to regenerate ──
// Each entry: promptId, hand-crafted positive prompt, characters to load LoRAs for,
// content mode, and orientation
interface ImageJob {
  promptId: string;
  label: string;
  positivePrompt: string;
  negativePrompt: string;
  characters: string[]; // keys into CHARACTER_LORAS
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

// ══════════════════════════════════════════════════════════════════════
// DEFINE IMAGES TO REGENERATE HERE
// ══════════════════════════════════════════════════════════════════════

const JOBS: ImageJob[] = [
  // ── #5: Sipho behind bar in shebeen (TOTAL FAIL - no person) ──
  {
    promptId: "89a5092a-d1a6-425e-89c8-fbd7c69e3c7c",
    label: "P2 Sipho shebeen SFW",
    positivePrompt: "photograph, high resolution, cinematic, skin textures, detailed, sipho_mthembu_nsw, 1boy, lean man with shaved head standing behind wooden bar counter, grinning while pouring beer from bottle, neon beer signs on wall behind him, green and amber neon glow, smoky township shebeen interior, medium shot straight-on angle",
    negativePrompt: SFW_NEG,
    characters: ["sipho"],
    loraStrengthModel: 0.75,
    loraStrengthClip: 0.5,
    mode: "sfw",
    width: 832,
    height: 1216,
    cfg: 4.5,
    steps: 35,
  },

  // ── #1: Workshop dual - Zanele + Thabo tension (TOTAL FAIL) ──
  // Dropping regional conditioning — using unified prompt for interaction
  {
    promptId: "ca4f323c-72c8-460f-b729-4a4fb118b057",
    label: "P1 Workshop dual NSFW",
    positivePrompt: "photograph, high resolution, cinematic, skin textures, detailed, thabo_nkosi_nsw, 1boy 1girl, mechanic workshop interior at dusk, man and woman standing face to face very close, her hand on his chest, his hand on her waist, intense eye contact, sexual tension, she wears tank top and unzipped overalls, he wears grey henley, single work lamp casting dramatic shadows, warm light, two-shot tight framing",
    negativePrompt: NSFW_NEG,
    characters: ["thabo"],
    loraStrengthModel: 0.7,
    loraStrengthClip: 0.5,
    mode: "nsfw",
    width: 1216,
    height: 832,
    cfg: 4.5,
    steps: 35,
  },

  // ── #6: Zanele + Thabo outside shebeen wall (TOTAL FAIL) ──
  {
    promptId: "f2463cfe-4bc2-41fa-9f45-d69f6818848e",
    label: "P2 Shebeen wall dual NSFW",
    positivePrompt: "photograph, high resolution, cinematic, skin textures, detailed, thabo_nkosi_nsw, 1boy 1girl, outside shebeen at night, woman leaning back against corrugated iron wall, tall man standing close facing her, his hand braced on wall above her shoulder, she looks up at him with challenging expression, he looks down with restrained desire, amber streetlight overhead, long shadows, full body shot low angle",
    negativePrompt: NSFW_NEG,
    characters: ["thabo"],
    loraStrengthModel: 0.7,
    loraStrengthClip: 0.5,
    mode: "nsfw",
    width: 1216,
    height: 832,
    cfg: 4.5,
    steps: 35,
  },

  // ── #8: Two women at bar SFW (TOTAL FAIL - nudity in SFW) ──
  {
    promptId: "e3ecc6d4-7e9d-4fd2-9ed8-77dfd7193202",
    label: "P2 Bar F/F SFW",
    positivePrompt: "photograph, high resolution, cinematic, skin textures, detailed, naledi_dlamini_nsw, two women sitting at bar counter in township shebeen, one with long braids wearing fitted blouse, other with short TWA wearing colorful wrap top, leaning toward each other laughing, colorful drinks on bar, neon beer signs overhead reflecting on skin, warm neon glow, close-up two-shot",
    negativePrompt: SFW_NEG,
    characters: ["naledi"],
    loraStrengthModel: 0.7,
    loraStrengthClip: 0.5,
    mode: "sfw",
    width: 1216,
    height: 832,
    cfg: 4.5,
    steps: 35,
  },

  // ── #10: Kiss against wall (TOTAL FAIL - only one person) ──
  {
    promptId: "c312822d-0417-46c7-ba9a-5eb5424151b0",
    label: "P2 Kiss wall NSFW",
    positivePrompt: "photograph, high resolution, cinematic, skin textures, detailed, thabo_nkosi_nsw, 1boy 1girl, passionate kiss outside shebeen, couple pressed against corrugated iron wall, eyes closed, his hand cupping her face, her hands gripping his shirt collar, single amber streetlight overhead, Middelburg township night, medium shot, shallow depth of field, warm amber light",
    negativePrompt: NSFW_NEG,
    characters: ["thabo"],
    loraStrengthModel: 0.7,
    loraStrengthClip: 0.5,
    mode: "nsfw",
    width: 1216,
    height: 832,
    cfg: 4.5,
    steps: 35,
  },

  // ── #7: Bathroom F/F NSFW (TOTAL FAIL - wrong setting/pose) ──
  {
    promptId: "9421c92b-101a-49dd-ae3f-9d8e724b2c06",
    label: "P2 Bathroom F/F NSFW",
    positivePrompt: "photograph, high resolution, cinematic, skin textures, detailed, naledi_dlamini_nsw, two women intimate moment in bathroom, woman with long braids pinning woman with short TWA against tiled wall, braided woman wears unbuttoned blouse, TWA woman wears slip dress pulled off shoulder, hands exploring, close body contact, flickering fluorescent overhead light, tiled bathroom walls, tight framing two-shot",
    negativePrompt: NSFW_NEG,
    characters: ["naledi"],
    loraStrengthModel: 0.7,
    loraStrengthClip: 0.5,
    mode: "nsfw",
    width: 1216,
    height: 832,
    cfg: 4.5,
    steps: 35,
  },

  // ── #11: F/F kiss on couch (TOTAL FAIL - only one person) ──
  {
    promptId: "a45e1fc1-8ae9-41b7-a43a-1e09e928978e",
    label: "P2 F/F Kiss couch NSFW",
    positivePrompt: "photograph, high resolution, cinematic, skin textures, detailed, naledi_dlamini_nsw, two women kissing tenderly on worn couch, one with long braids other with short TWA, foreheads touching lips together, fingers interlaced, seated side by side, dimly lit township lounge, single table lamp warm glow, lace curtains, intimate close-up two-shot, soft warm lighting",
    negativePrompt: NSFW_NEG,
    characters: ["naledi"],
    loraStrengthModel: 0.7,
    loraStrengthClip: 0.5,
    mode: "nsfw",
    width: 1216,
    height: 832,
    cfg: 4.5,
    steps: 35,
  },

  // ── #12: Standing sex (TOTAL FAIL) ──
  {
    promptId: "1bc67e60-5655-41e7-a393-8cdcc58d4e04",
    label: "P2 Standing sex NSFW",
    positivePrompt: "photograph, high resolution, cinematic, skin textures, detailed, thabo_nkosi_nsw, 1boy 1girl, standing sex against wall, woman pressed against concrete wall with one leg lifted, man supporting her thigh facing her, her arms around his neck, foreheads touching, both nude, abandoned back room, single bare bulb overhead, harsh overhead lighting, deep shadows, full body shot",
    negativePrompt: NSFW_NEG,
    characters: ["thabo"],
    loraStrengthModel: 0.7,
    loraStrengthClip: 0.5,
    mode: "nsfw",
    width: 832,
    height: 1216,
    cfg: 4.5,
    steps: 35,
  },

  // ── #13: Zanele on Toyota at night SFW (FAIL - daytime, wrong position) ──
  {
    promptId: "5344834b-b8cd-48eb-96bf-5e9153b08301",
    label: "P3 Zanele Toyota SFW",
    positivePrompt: "photograph, high resolution, cinematic, skin textures, detailed, young Black South African woman with long braids, sitting on bonnet of old Toyota at night, jeans and loose off-shoulder top, legs dangling off car hood, looking up at starry sky, contemplative expression, Middelburg township background, wide Highveld sky full of stars, single amber streetlight, wide shot cinematic composition, nighttime",
    negativePrompt: SFW_NEG,
    characters: [],
    loraStrengthModel: 0,
    loraStrengthClip: 0,
    mode: "sfw",
    width: 832,
    height: 1216,
    cfg: 4.5,
    steps: 35,
  },

  // ── #14: Naledi walking at night (FAIL - wrong hair, clothing) ──
  {
    promptId: "675e2c2a-7a93-481e-837a-8e4d10f97112",
    label: "P3 Naledi street NSFW",
    positivePrompt: "photograph, high resolution, cinematic, skin textures, detailed, naledi_dlamini_nsw, 1girl, woman with very short natural TWA hair walking alone through quiet Middelburg township street late at night, nurse uniform white scrubs under open jacket, phone screen illuminating her face, single streetlight overhead, long shadow behind her, full body shot, moody nighttime, cinematic blue tones",
    negativePrompt: NSFW_NEG,
    characters: ["naledi"],
    loraStrengthModel: 0.75,
    loraStrengthClip: 0.5,
    mode: "nsfw",
    width: 832,
    height: 1216,
    cfg: 4.5,
    steps: 35,
  },

  // ── #15: Toyota sex (TOTAL FAIL) ──
  {
    promptId: "6c315584-d193-4c99-8be8-b6e7751c59c7",
    label: "P3 Toyota sex NSFW",
    positivePrompt: "photograph, high resolution, cinematic, skin textures, detailed, thabo_nkosi_nsw, 1boy 1girl, woman lying back on car hood outdoors at night, man on top of her, his shirt off her top pulled up, bodies intertwined, sweat glistening on dark skin, wide starry Highveld sky above, moonlight mixed with amber streetlight, overhead shot angled down, intimate framing",
    negativePrompt: NSFW_NEG,
    characters: ["thabo"],
    loraStrengthModel: 0.7,
    loraStrengthClip: 0.5,
    mode: "nsfw",
    width: 1216,
    height: 832,
    cfg: 4.5,
    steps: 35,
  },

  // ── #17: Naledi + Sipho kissing at bar (TOTAL FAIL) ──
  {
    promptId: "0c874b0f-e478-4e9a-8e7b-405ceade7e74",
    label: "P3 Naledi+Sipho bar NSFW",
    positivePrompt: "photograph, high resolution, cinematic, skin textures, detailed, naledi_dlamini_nsw, sipho_mthembu_nsw, 1girl 1boy, woman sitting on bar counter with legs wrapped around man's waist, kissing passionately, his hands on her hips, her arms around his neck, empty shebeen after closing, neon beer signs glowing green and amber, bottles on shelves behind them, medium shot, moody neon lighting",
    negativePrompt: NSFW_NEG,
    characters: ["naledi", "sipho"],
    loraStrengthModel: 0.7,
    loraStrengthClip: 0.5,
    mode: "nsfw",
    width: 1216,
    height: 832,
    cfg: 4.5,
    steps: 35,
  },

  // ── #18: Missionary (FAIL - wrong position) ──
  {
    promptId: "39796451-64d7-4705-854a-dae304119890",
    label: "P3 Missionary NSFW",
    positivePrompt: "photograph, high resolution, cinematic, skin textures, detailed, thabo_nkosi_nsw, 1boy 1girl, missionary position on bed, woman lying on her back, man on top between her thighs, her legs wrapped around his waist, hands gripping white sheets, his arms braced beside her head, both nude, sweat on dark skin, eye contact between them, expressions of pleasure, township bedroom, bedside lamp warm amber glow, medium shot side angle",
    negativePrompt: NSFW_NEG,
    characters: ["thabo"],
    loraStrengthModel: 0.7,
    loraStrengthClip: 0.5,
    mode: "nsfw",
    width: 1216,
    height: 832,
    cfg: 4.5,
    steps: 35,
  },

  // ── #19: Doggy style (PARTIAL FAIL) ──
  {
    promptId: "e926d559-253b-4fa2-b9d1-79e33487024a",
    label: "P3 Doggy NSFW",
    positivePrompt: "photograph, high resolution, cinematic, skin textures, detailed, thabo_nkosi_nsw, 1boy 1girl, sex from behind doggy style on bed, woman on hands and knees, man kneeling behind her gripping her hips, her back arched looking over shoulder at him, both nude, dark bedroom, moonlight through curtains casting blue silver light stripes across bodies, low angle, dramatic lighting",
    negativePrompt: NSFW_NEG,
    characters: ["thabo"],
    loraStrengthModel: 0.7,
    loraStrengthClip: 0.5,
    mode: "nsfw",
    width: 1216,
    height: 832,
    cfg: 4.5,
    steps: 35,
  },

  // ── #20: Cowgirl (TOTAL FAIL - only man visible) ──
  {
    promptId: "54007739-b33e-4eca-b974-15f002d6f07e",
    label: "P3 Cowgirl NSFW",
    positivePrompt: "photograph, high resolution, cinematic, skin textures, detailed, thabo_nkosi_nsw, 1boy 1girl, cowgirl position, curvy woman straddling man lying on his back on bed, her hands on his chest, head tilted back eyes closed in pleasure, his hands on her thighs, both nude, sweat on skin, township bedroom, warm bedside lamp, tangled white sheets, medium shot slightly low angle looking up, golden warm tones",
    negativePrompt: NSFW_NEG,
    characters: ["thabo"],
    loraStrengthModel: 0.7,
    loraStrengthClip: 0.5,
    mode: "nsfw",
    width: 1216,
    height: 832,
    cfg: 4.5,
    steps: 35,
  },

  // ── #16: Sipho closing shebeen (PARTIAL FAIL) ──
  {
    promptId: "11fea12d-344d-47ad-87f0-1161ce4071bb",
    label: "P3 Sipho closing NSFW",
    positivePrompt: "photograph, high resolution, cinematic, skin textures, detailed, sipho_mthembu_nsw, 1boy, man silhouetted in shebeen doorway at night, rolling down metal security gate with one hand, cigarette in other hand smoke curling, warm interior light behind him, cool dark exterior, Middelburg township street, medium shot, film noir composition, strong backlight contrast",
    negativePrompt: NSFW_NEG,
    characters: ["sipho"],
    loraStrengthModel: 0.75,
    loraStrengthClip: 0.5,
    mode: "nsfw",
    width: 832,
    height: 1216,
    cfg: 4.5,
    steps: 35,
  },

  // ── #2: Zanele workshop NSFW (PARTIAL FAIL - wrong clothing) ──
  {
    promptId: "8dead15c-cebb-41a7-83c9-00b8020a96b9",
    label: "P1 Zanele workshop NSFW",
    positivePrompt: "photograph, high resolution, cinematic, skin textures, detailed, young curvy Black South African woman with long braids, mechanic workshop in Middelburg at golden hour, overalls unzipped to waist revealing fitted tank top, leaning back against car hood, one hand resting on metal, provocative gaze at viewer, lips slightly parted, warm amber light from bay door, oil-stained skin glistening, medium shot, workshop tools in background",
    negativePrompt: NSFW_NEG,
    characters: [],
    loraStrengthModel: 0,
    loraStrengthClip: 0,
    mode: "nsfw",
    width: 832,
    height: 1216,
    cfg: 4.5,
    steps: 35,
  },
];

// ══════════════════════════════════════════════════════════════════════

async function generateAndPoll(job: ImageJob): Promise<{ imagePath: string; imageId: string } | null> {
  const seed = Math.floor(Math.random() * 2_147_483_647) + 1;
  console.log(`\n── ${job.label} (seed=${seed}) ──`);
  console.log(`   Prompt: ${job.positivePrompt.substring(0, 120)}...`);

  // Build LoRA stack
  const loras = job.characters.map(charKey => {
    const lora = CHARACTER_LORAS[charKey];
    return {
      filename: lora.filename,
      strengthModel: job.loraStrengthModel,
      strengthClip: job.loraStrengthClip,
    };
  });

  const loraDownloads = job.characters.map(charKey => {
    const lora = CHARACTER_LORAS[charKey];
    return {
      filename: lora.filename,
      url: lora.url,
      ...(lora.expected_bytes ? { expected_bytes: lora.expected_bytes } : {}),
    };
  });

  // Build workflow — NO regional conditioning, single unified prompt
  const workflow = buildWorkflow({
    positivePrompt: job.positivePrompt,
    negativePrompt: job.negativePrompt,
    width: job.width,
    height: job.height,
    seed,
    cfg: job.cfg,
    steps: job.steps,
    filenamePrefix: `iter_${job.promptId.substring(0, 8)}`,
    loras: loras.length > 0 ? loras : undefined,
    // NO dualCharacterPrompts — unified prompt for better interactions
  });

  // Submit to RunPod
  const { jobId } = await submitRunPodJob(
    workflow,
    undefined,
    loraDownloads.length > 0 ? loraDownloads : undefined,
  );
  console.log(`   Submitted: ${jobId}`);

  // Create image record
  const { data: imageRow, error } = await supabase.from("images").insert({
    character_id: null,
    prompt: job.positivePrompt,
    negative_prompt: job.negativePrompt,
    settings: {
      width: job.width,
      height: job.height,
      steps: job.steps,
      cfg: job.cfg,
      seed,
      engine: "runpod-v4-juggernaut-ragnarok",
      attemptNumber: 1,
      compositionType: job.characters.length > 1 ? "dual" : "solo",
      contentMode: job.mode,
    },
    mode: job.mode,
  }).select("id").single();

  if (error || !imageRow) {
    console.error(`   Failed to create image record: ${error?.message}`);
    return null;
  }

  await supabase.from("generation_jobs").insert({
    job_id: `runpod-${jobId}`,
    image_id: imageRow.id,
    status: "pending",
    cost: 0,
  });

  // Poll for completion
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
      if (corruption.corrupted) {
        console.log(`   ✗ NOISE detected: ${corruption.reason.substring(0, 60)}`);
        return null;
      }

      // Save locally
      const filename = `${job.label.replace(/[^a-zA-Z0-9]/g, "_")}_${seed}.png`;
      const filepath = path.join(OUTPUT_DIR, filename);
      fs.writeFileSync(filepath, buffer);
      console.log(`   ✓ Saved: ${filepath} (${(buffer.length / 1024).toFixed(0)}KB)`);

      // Upload to Supabase
      const timestamp = Date.now();
      const storagePath = `stories/${imageRow.id}-${timestamp}.png`;
      await supabase.storage.from("story-images").upload(storagePath, buffer, { contentType: "image/png", upsert: true });
      const { data: { publicUrl } } = supabase.storage.from("story-images").getPublicUrl(storagePath);
      await supabase.from("images").update({ stored_url: publicUrl, sfw_url: publicUrl }).eq("id", imageRow.id);
      await supabase.from("generation_jobs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("job_id", `runpod-${jobId}`);

      return { imagePath: filepath, imageId: imageRow.id };
    }

    if (status.status === "FAILED") {
      console.log(`   ✗ RunPod FAILED: ${status.error}`);
      return null;
    }

    if (attempts % 6 === 0) {
      console.log(`   ... polling (${attempts * 5}s, status=${status.status})`);
    }
  }

  console.log(`   ✗ Timed out after 5 minutes`);
  return null;
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`=== Iterative Image Generation ===`);
  console.log(`Generating ${JOBS.length} images...\n`);

  const results: { label: string; success: boolean; imageId?: string; path?: string }[] = [];

  for (const job of JOBS) {
    const result = await generateAndPoll(job);
    if (result) {
      // Link to prompt record
      await supabase.from("story_image_prompts")
        .update({ image_id: result.imageId, status: "generated" })
        .eq("id", job.promptId);
      results.push({ label: job.label, success: true, imageId: result.imageId, path: result.imagePath });
    } else {
      results.push({ label: job.label, success: false });
    }
  }

  console.log("\n=== Results ===");
  for (const r of results) {
    console.log(`  ${r.success ? "✓" : "✗"} ${r.label}${r.path ? ` → ${r.path}` : ""}`);
  }
}

main().catch(console.error);
