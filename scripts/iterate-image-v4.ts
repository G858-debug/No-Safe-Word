/**
 * Iteration 4: Final attempt at cowgirl position.
 * Drop all LoRAs, use maximum token budget for pose description.
 */

import { buildWorkflow } from "@no-safe-word/image-gen";
import { submitRunPodJob, getRunPodJobStatus, base64ToBuffer, detectCorruptedImage } from "@no-safe-word/image-gen";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const OUTPUT_DIR = "/tmp/middelburg-iterations-v4";

async function generateAndPoll(label: string, promptId: string, positivePrompt: string, negativePrompt: string, width: number, height: number): Promise<{ imagePath: string; imageId: string } | null> {
  const seed = Math.floor(Math.random() * 2_147_483_647) + 1;
  console.log(`\n── ${label} (seed=${seed}) ──`);

  const workflow = buildWorkflow({
    positivePrompt, negativePrompt, width, height, seed, cfg: 6.0, steps: 40,
    filenamePrefix: `iter4_${promptId.substring(0, 8)}`,
  });

  const { jobId } = await submitRunPodJob(workflow);
  console.log(`   Submitted: ${jobId}`);

  const { data: imageRow, error } = await supabase.from("images").insert({
    character_id: null, prompt: positivePrompt, negative_prompt: negativePrompt,
    settings: { width, height, steps: 40, cfg: 6.0, seed, engine: "runpod-v4-juggernaut-ragnarok", attemptNumber: 4, compositionType: "dual", contentMode: "nsfw" },
    mode: "nsfw",
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
      if (corruption.corrupted) { console.log(`   ✗ NOISE`); return null; }

      const filename = `${label.replace(/[^a-zA-Z0-9]/g, "_")}_${seed}.png`;
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
    if (attempts % 6 === 0) console.log(`   ... polling (${attempts * 5}s)`);
  }
  return null;
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Cowgirl: emphasize "riding" and "on top" with maximum clarity
  const result = await generateAndPoll(
    "P3 Cowgirl NSFW v4",
    "54007739-b33e-4eca-b974-15f002d6f07e",
    "photograph, cinematic, woman riding man cowgirl position, she sits upright on top of him straddling his hips, her back straight hands pressing down on his muscular chest, head thrown back in pleasure with closed eyes, he lies flat on his back beneath her looking up, his hands on her wide hips, both nude Black couple, sweat glistening, warm bedside lamp casting golden light from below, white rumpled sheets, bedroom at night, medium shot from slightly below her eye level",
    "bad anatomy, bad hands, extra limbs, watermark, blurry, text, cartoon, illustration, painting, low quality, worst quality, deformed, three people, group, side by side, standing",
    1216,
    832,
  );

  if (result) {
    await supabase.from("story_image_prompts").update({ image_id: result.imageId, status: "generated" }).eq("id", "54007739-b33e-4eca-b974-15f002d6f07e");
    console.log(`\n✓ Done: ${result.imagePath}`);
  } else {
    console.log("\n✗ Failed");
  }
}

main().catch(console.error);
