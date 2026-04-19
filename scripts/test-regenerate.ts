/**
 * Test script: regenerate a small batch of Middelburg Nights v2 images
 * to verify the pipeline fixes (noise detection, prompt adherence).
 *
 * Usage: npx tsx --env-file=apps/web/.env.local scripts/test-regenerate.ts
 */

import { buildV4SceneGenerationPayload, fetchCharacterDataMap } from "../apps/web/lib/server/generate-scene-image-v4";
import { submitRunPodJob } from "@no-safe-word/image-gen";
import { supabase } from "@no-safe-word/story-engine";

const SERIES_ID = "a1d144cd-d670-4ca2-8f48-cb123a183bdb";

async function main() {
  // Get all pending prompts
  const { data: posts } = await supabase
    .from("story_posts")
    .select("id")
    .eq("series_id", SERIES_ID);

  if (!posts || posts.length === 0) {
    console.error("No posts found for series");
    return;
  }

  const { data: allPrompts } = await supabase
    .from("story_image_prompts")
    .select("id, post_id, image_type, position, character_name, character_id, secondary_character_name, secondary_character_id, prompt")
    .in("post_id", posts.map((p) => p.id))
    .eq("status", "pending");

  if (!allPrompts || allPrompts.length === 0) {
    console.log("No pending prompts");
    return;
  }

  // Pick 3 diverse test prompts:
  // 1. Zanele solo SFW (previously produced noise)
  // 2. Non-Zanele solo SFW (previously worked)
  // 3. Dual-character scene (previously produced noise)
  const zaneleSolo = allPrompts.find(
    (p) => p.character_name === "Zanele Mokoena" && !p.secondary_character_id && p.image_type === "facebook_sfw"
  );
  const nonZaneleSolo = allPrompts.find(
    (p) => p.character_name !== "Zanele Mokoena" && !p.secondary_character_id && p.image_type === "facebook_sfw"
  );
  const dual = allPrompts.find((p) => !!p.secondary_character_id);

  const testPrompts = [zaneleSolo, nonZaneleSolo, dual].filter(Boolean);
  console.log(`\n=== Testing ${testPrompts.length} prompts ===\n`);
  for (const p of testPrompts) {
    if (!p) continue;
    console.log(`  ${p.character_name}${p.secondary_character_name ? " + " + p.secondary_character_name : " (solo)"} [${p.image_type}]`);
    console.log(`  Prompt: ${p.prompt.substring(0, 100)}...`);
    console.log();
  }

  // Pre-fetch character data
  const charIds = Array.from(
    new Set(
      testPrompts
        .flatMap((p) => [p!.character_id, p!.secondary_character_id])
        .filter((id): id is string => id !== null)
    )
  );
  const characterDataMap = await fetchCharacterDataMap(charIds);

  const jobs: { promptId: string; jobId: string; imageId: string; character: string }[] = [];

  for (const imgPrompt of testPrompts) {
    if (!imgPrompt) continue;
    try {
      const seed = Math.floor(Math.random() * 2_147_483_647) + 1;
      console.log(`--- Generating: ${imgPrompt.character_name} (${imgPrompt.image_type}) seed=${seed} ---`);

      const result = await buildV4SceneGenerationPayload({
        imgPrompt,
        seriesId: SERIES_ID,
        characterDataMap,
        seed,
      });

      console.log("  Assembled prompt:", result.assembledPrompt);
      console.log("  Negative:", result.negativePrompt.substring(0, 80) + "...");
      console.log("  LoRAs:", result.characterLoraDownloads.map((d) => d.filename));
      console.log("  Profile:", `${result.profile.compositionType}/${result.profile.contentMode} cfg=${result.profile.cfg} steps=${result.profile.steps}`);

      const { jobId } = await submitRunPodJob(
        result.workflow,
        result.images.length > 0 ? result.images : undefined,
        result.characterLoraDownloads.length > 0 ? result.characterLoraDownloads : undefined
      );

      // Create image record
      const { data: imageRow, error: imgError } = await supabase
        .from("images")
        .insert({
          character_id: imgPrompt.character_id || null,
          prompt: result.assembledPrompt,
          negative_prompt: result.negativePrompt,
          settings: {
            width: result.width,
            height: result.height,
            steps: result.profile.steps,
            cfg: result.profile.cfg,
            seed: result.seed,
            engine: "runpod-v4-juggernaut-ragnarok",
            attemptNumber: 1,
            compositionType: result.profile.compositionType,
            contentMode: result.profile.contentMode,
          },
          mode: result.mode,
        })
        .select("id")
        .single();

      if (imgError || !imageRow) {
        throw new Error(`Failed to create image record: ${imgError?.message}`);
      }

      await supabase.from("generation_jobs").insert({
        job_id: `runpod-${jobId}`,
        image_id: imageRow.id,
        status: "pending",
        cost: 0,
      });

      await supabase
        .from("story_image_prompts")
        .update({ image_id: imageRow.id, status: "generating" })
        .eq("id", imgPrompt.id);

      jobs.push({
        promptId: imgPrompt.id,
        jobId: `runpod-${jobId}`,
        imageId: imageRow.id,
        character: imgPrompt.character_name || "unknown",
      });

      console.log(`  ✓ Submitted: job=${jobId} image=${imageRow.id}\n`);
    } catch (err) {
      console.error(`  ✗ FAILED: ${err}\n`);
    }
  }

  console.log("\n=== Submitted Jobs ===");
  for (const job of jobs) {
    console.log(`  ${job.character}: jobId=${job.jobId} imageId=${job.imageId}`);
  }

  console.log("\nPoll status with:");
  for (const job of jobs) {
    console.log(`  curl http://localhost:3001/api/status/${job.jobId}`);
  }
}

main().catch(console.error);
