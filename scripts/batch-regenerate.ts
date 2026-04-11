/**
 * Batch regenerate all pending Middelburg Nights v2 images.
 * Submits all jobs, then polls until complete.
 *
 * Usage: npx tsx --env-file=apps/web/.env.local scripts/batch-regenerate.ts
 */

import { buildV4SceneGenerationPayload, fetchCharacterDataMap } from "../apps/web/lib/server/generate-scene-image-v4";
import { submitRunPodJob, getRunPodJobStatus, base64ToBuffer, detectCorruptedImage } from "@no-safe-word/image-gen";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const SERIES_ID = "a1d144cd-d670-4ca2-8f48-cb123a183bdb";

interface Job {
  promptId: string;
  jobId: string;
  imageId: string;
  character: string;
  status: "pending" | "completed" | "failed";
}

async function submitAll(): Promise<Job[]> {
  const { data: posts } = await supabase.from("story_posts").select("id").eq("series_id", SERIES_ID);
  if (!posts?.length) { console.error("No posts"); return []; }

  const { data: prompts } = await supabase
    .from("story_image_prompts")
    .select("id, post_id, image_type, position, character_name, character_id, secondary_character_name, secondary_character_id, prompt")
    .in("post_id", posts.map(p => p.id))
    .eq("status", "pending");

  if (!prompts?.length) { console.log("No pending prompts"); return []; }

  const charIds = Array.from(new Set(
    prompts.flatMap(p => [p.character_id, p.secondary_character_id]).filter((id): id is string => id !== null)
  ));
  const characterDataMap = await fetchCharacterDataMap(charIds);

  const jobs: Job[] = [];

  for (let i = 0; i < prompts.length; i++) {
    const imgPrompt = prompts[i];
    try {
      const seed = Math.floor(Math.random() * 2_147_483_647) + 1;
      const result = await buildV4SceneGenerationPayload({ imgPrompt, seriesId: SERIES_ID, characterDataMap, seed });

      const { jobId } = await submitRunPodJob(
        result.workflow,
        result.images.length > 0 ? result.images : undefined,
        result.characterLoraDownloads.length > 0 ? result.characterLoraDownloads : undefined,
      );

      const { data: imageRow } = await supabase.from("images").insert({
        character_id: imgPrompt.character_id || null,
        prompt: result.assembledPrompt,
        negative_prompt: result.negativePrompt,
        settings: { width: result.width, height: result.height, steps: result.profile.steps, cfg: result.profile.cfg, seed: result.seed, engine: "runpod-v4-juggernaut-ragnarok", attemptNumber: 1, compositionType: result.profile.compositionType, contentMode: result.profile.contentMode },
        mode: result.mode,
      }).select("id").single();

      if (!imageRow) throw new Error("Failed to create image record");

      await supabase.from("generation_jobs").insert({ job_id: `runpod-${jobId}`, image_id: imageRow.id, status: "pending", cost: 0 });
      await supabase.from("story_image_prompts").update({ image_id: imageRow.id, status: "generating" }).eq("id", imgPrompt.id);

      jobs.push({ promptId: imgPrompt.id, jobId, imageId: imageRow.id, character: `${imgPrompt.character_name}${imgPrompt.secondary_character_name ? " + " + imgPrompt.secondary_character_name : ""}`, status: "pending" });
      console.log(`[${i + 1}/${prompts.length}] ${jobs[jobs.length - 1].character} [${imgPrompt.image_type}] → ${jobId.substring(0, 8)}...`);

      if (i < prompts.length - 1) await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`[${i + 1}/${prompts.length}] FAILED: ${err}`);
      await supabase.from("story_image_prompts").update({ status: "failed" }).eq("id", imgPrompt.id);
    }
  }

  return jobs;
}

async function pollAndStore(jobs: Job[]): Promise<void> {
  const pending = new Set(jobs.filter(j => j.status === "pending").map(j => j.jobId));
  let round = 0;

  while (pending.size > 0 && round < 60) {
    round++;
    await new Promise(r => setTimeout(r, 5000));
    console.log(`\n--- Poll round ${round} (${pending.size} pending) ---`);

    for (const jobId of Array.from(pending)) {
      const job = jobs.find(j => j.jobId === jobId)!;
      try {
        const status = await getRunPodJobStatus(jobId);

        if (status.status === "COMPLETED" && status.output?.images?.[0]) {
          const imageData = status.output.images[0].data;
          const base64Data = imageData.includes(",") ? imageData.split(",")[1] : imageData;
          const buffer = base64ToBuffer(base64Data);
          const corruption = await detectCorruptedImage(base64Data);

          if (corruption.corrupted) {
            console.log(`  ✗ ${job.character}: NOISE — ${corruption.reason.substring(0, 60)}`);
            job.status = "failed";
            await supabase.from("generation_jobs").update({ status: "failed" }).eq("job_id", `runpod-${jobId}`);
            await supabase.from("story_image_prompts").update({ status: "failed" }).eq("image_id", job.imageId);
          } else {
            const timestamp = Date.now();
            const storagePath = `stories/${job.imageId}-${timestamp}.png`;
            await supabase.storage.from("story-images").upload(storagePath, buffer, { contentType: "image/png", upsert: true });
            const { data: { publicUrl } } = supabase.storage.from("story-images").getPublicUrl(storagePath);
            await supabase.from("images").update({ stored_url: publicUrl, sfw_url: publicUrl }).eq("id", job.imageId);
            await supabase.from("story_image_prompts").update({ status: "generated" }).eq("image_id", job.imageId);
            await supabase.from("generation_jobs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("job_id", `runpod-${jobId}`);
            console.log(`  ✓ ${job.character}: ${(buffer.length / 1024).toFixed(0)}KB stored`);
            job.status = "completed";
          }
          pending.delete(jobId);
        } else if (status.status === "FAILED") {
          console.log(`  ✗ ${job.character}: RunPod FAILED — ${status.error}`);
          job.status = "failed";
          await supabase.from("generation_jobs").update({ status: "failed" }).eq("job_id", `runpod-${jobId}`);
          await supabase.from("story_image_prompts").update({ status: "failed" }).eq("image_id", job.imageId);
          pending.delete(jobId);
        }
      } catch (err) {
        console.error(`  ! ${job.character}: poll error — ${err}`);
      }
    }
  }

  const completed = jobs.filter(j => j.status === "completed").length;
  const failed = jobs.filter(j => j.status === "failed").length;
  const stillPending = jobs.filter(j => j.status === "pending").length;
  console.log(`\n=== DONE: ${completed} completed, ${failed} failed, ${stillPending} still pending ===`);
}

async function main() {
  console.log("=== Submitting all pending prompts ===\n");
  const jobs = await submitAll();
  if (jobs.length === 0) return;

  console.log(`\n=== ${jobs.length} jobs submitted, polling for results ===`);
  await pollAndStore(jobs);
}

main().catch(console.error);
