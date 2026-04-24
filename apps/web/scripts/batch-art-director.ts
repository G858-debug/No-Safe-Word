#!/usr/bin/env npx tsx
/**
 * Batch Art Director — Generate all Middelburg Nights images via the Art Director pipeline.
 *
 * Auto-selects the top-ranked reference for each prompt and runs the full
 * 8-step flow: intent analysis → CivitAI search → ranking → recipe adaptation
 * → generation → evaluation → iteration → approval.
 *
 * Usage: cd apps/web && npx tsx scripts/batch-art-director.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";

// ── Load .env.local BEFORE any other imports ──
const envPath = resolve(__dirname, "../.env.local");
try {
  const envFile = readFileSync(envPath, "utf-8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const val = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  console.error(`Could not read ${envPath}`);
  process.exit(1);
}

// ── Constants ──
const SERIES_ID = "a1d144cd-d670-4ca2-8f48-cb123a183bdb";
const MAX_ITERATIONS = 8;
const PASS_THRESHOLD = 90;
const OUTPUT_DIR = resolve(__dirname, "../test-output/batch-art-director");

// ── Logging ──
function ts(): string {
  return new Date().toLocaleTimeString("en-ZA", { hour12: false });
}
function log(msg: string): void {
  console.log(`[${ts()}] ${msg}`);
}

// ── Results ──
interface PromptResult {
  promptId: string;
  partNumber: number;
  imageType: string;
  characterName: string | null;
  status: "success" | "failed" | "skipped";
  bestScore: number | null;
  iterations: number;
  imageUrl: string | null;
  error: string | null;
  durationMs: number;
}

const results: PromptResult[] = [];

// ── Main (uses dynamic imports so env vars are available to module-level constants) ──
async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // Dynamic imports — run AFTER env vars are set
  const { supabase } = await import("@no-safe-word/story-engine");
  const {
    analyzeAndSearch,
    selectReference,
    adaptRecipe,
    runIteration,
    approveIteration,
    getJob,
  } = await import("../lib/art-director/orchestrator");
  const { ensurePodRunning, healthCheck } = await import("../lib/art-director/qwen-vl-client");

  type CharacterDataForArtDirector = import("../lib/art-director/orchestrator").CharacterDataForArtDirector;

  // ── Character data fetching ──
  async function fetchCharacterData(characterNames: string[]): Promise<CharacterDataForArtDirector[]> {
    if (characterNames.length === 0) return [];

    const { data: storyChars } = await supabase
      .from("story_characters")
      .select(
        `character:characters!inner(name, description, approved_image_id)`
      )
      .eq("series_id", SERIES_ID);

    if (!storyChars) return [];

    const wanted = new Set(characterNames.map((n) => n.toLowerCase()));
    const out: CharacterDataForArtDirector[] = [];
    for (const sc of storyChars) {
      const charRel = sc.character as any;
      const charName: string | undefined = charRel?.name;
      if (!charName || !wanted.has(charName.toLowerCase())) continue;
      const cd: CharacterDataForArtDirector = { name: charName, structured: null, portraitUrl: null };
      if (charRel?.description) {
        try {
          const desc = typeof charRel.description === "string" ? JSON.parse(charRel.description) : charRel.description;
          cd.structured = {
            skinTone: desc.skinTone || null,
            bodyType: desc.bodyType || null,
            hairColor: desc.hairColor || null,
            hairStyle: desc.hairStyle || null,
            eyeColor: desc.eyeColor || null,
            ethnicity: desc.ethnicity || null,
            age: desc.age || null,
          };
        } catch {}
      }
      const approvedImageId: string | null = charRel?.approved_image_id ?? null;
      if (approvedImageId) {
        const { data: imgData } = await supabase
          .from("images")
          .select("stored_url")
          .eq("id", approvedImageId)
          .single();
        if (imgData?.stored_url) cd.portraitUrl = imgData.stored_url;
      }
      out.push(cd);
    }
    return out;
  }

  // ── Process a single prompt ──
  async function processPrompt(prompt: {
    id: string;
    prompt: string;
    image_type: string;
    character_name: string | null;
    secondary_character_name: string | null;
    part_number: number;
  }): Promise<PromptResult> {
    const startTime = Date.now();
    const result: PromptResult = {
      promptId: prompt.id,
      partNumber: prompt.part_number,
      imageType: prompt.image_type,
      characterName: prompt.character_name,
      status: "failed",
      bestScore: null,
      iterations: 0,
      imageUrl: null,
      error: null,
      durationMs: 0,
    };

    try {
      const charNames: string[] = [];
      if (prompt.character_name) charNames.push(prompt.character_name);
      if (prompt.secondary_character_name) charNames.push(prompt.secondary_character_name);

      const charData = await fetchCharacterData(charNames);

      // Steps 1-3: Analyze intent + search + rank
      log(`  Steps 1-3: Analyzing intent and searching CivitAI...`);
      const analysisResult = await analyzeAndSearch(
        prompt.prompt,
        prompt.image_type,
        charNames,
        SERIES_ID,
        prompt.id,
        charData
      );

      const { jobId, rankedReferences } = analysisResult;

      if (rankedReferences.length === 0) {
        result.error = "No reference images found with generation metadata";
        result.durationMs = Date.now() - startTime;
        return result;
      }

      log(`  Found ${rankedReferences.length} references. Top score: ${rankedReferences[0].relevanceScore}`);

      // Step 4: Auto-select top reference
      const topRef = rankedReferences[0];
      log(`  Step 4: Selecting reference #${topRef.id}`);
      await selectReference(jobId, topRef.id);

      // Step 5: Adapt recipe
      log(`  Step 5: Adapting recipe...`);
      const recipe = await adaptRecipe(jobId);
      log(`  Recipe: model=${(recipe.model || "").slice(0, 30)}, steps=${recipe.steps}, cfg=${recipe.cfgScale}`);

      // Steps 6-8: Generate + evaluate + iterate
      for (let attempt = 1; attempt <= MAX_ITERATIONS; attempt++) {
        log(`  Iteration ${attempt}/${MAX_ITERATIONS}...`);

        const iteration = await runIteration(jobId);
        result.iterations = attempt;

        if (iteration.status === "failed") {
          log(`  Attempt ${attempt} failed: ${iteration.error}`);
          continue;
        }

        const score = iteration.evaluation?.overall ?? 0;
        if (!result.bestScore || score > result.bestScore) {
          result.bestScore = score;
        }

        log(`  Attempt ${attempt}: score=${Math.round(score)}/100${score >= PASS_THRESHOLD ? " PASSED" : ""}`);

        const job = await getJob(jobId);
        if (job.status === "completed") {
          log(`  Complete! Best: ${Math.round(job.bestScore ?? 0)}`);
          break;
        }
      }

      // Approve best
      log(`  Approving best iteration...`);
      const approval = await approveIteration(jobId);
      result.imageUrl = approval.imageUrl;
      result.status = "success";
      log(`  Approved: ${approval.imageUrl.slice(0, 80)}...`);
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      log(`  FAILED: ${result.error}`);
    }

    result.durationMs = Date.now() - startTime;
    return result;
  }

  // ── Run ──
  log("=== Batch Art Director — Middelburg Nights ===");

  // 1. Check pod — ensure it's running AND model is loaded
  log("Checking Qwen VL pod...");
  try {
    await ensurePodRunning();

    // Wait for model to be fully loaded (vLLM takes time to load the 72B model)
    const MAX_HEALTH_POLLS = 60; // 60 * 10s = 10 minutes (72B model takes time to load)
    for (let i = 0; i < MAX_HEALTH_POLLS; i++) {
      const health = await healthCheck();
      if (health.status === "ok" && health.modelLoaded) {
        log("Pod is healthy and model is loaded.");
        break;
      }

      if (i === MAX_HEALTH_POLLS - 1) {
        log(`FATAL: Model not loaded after ${MAX_HEALTH_POLLS * 10}s.`);
        process.exit(1);
      }

      const statusMsg = health.status === "loading" ? "Model loading..." :
                         health.status === "unreachable" ? "Pod unreachable, waiting..." :
                         `Status: ${health.status}`;
      log(`  ${statusMsg} (${i + 1}/${MAX_HEALTH_POLLS})`);
      await new Promise((r) => setTimeout(r, 10000));
    }
  } catch (err) {
    log(`FATAL: Pod error: ${err}`);
    process.exit(1);
  }

  // 2. Fetch prompts
  log("Fetching image prompts...");
  const { data: prompts, error } = await supabase
    .from("story_image_prompts")
    .select(`
      id, prompt, image_type, character_name, secondary_character_name, status, position,
      post:story_posts!inner(part_number, series_id)
    `)
    .eq("post.series_id", SERIES_ID)
    .order("position");

  if (error || !prompts) {
    log(`FATAL: ${error?.message}`);
    process.exit(1);
  }

  // Check which prompts already have successful art_director_jobs
  const { data: completedJobs } = await supabase
    .from("art_director_jobs")
    .select("prompt_id, status, final_image_id")
    .eq("series_id", SERIES_ID)
    .eq("status", "completed")
    .not("final_image_id", "is", null);

  const completedPromptIds = new Set(
    (completedJobs || []).map((j: any) => j.prompt_id)
  );

  const pendingPrompts = prompts.filter(
    (p: any) => !completedPromptIds.has(p.id)
  );

  log(`Found ${prompts.length} total prompts, ${completedPromptIds.size} already completed via Art Director, ${pendingPrompts.length} to process`);

  // 3. Process each
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < pendingPrompts.length; i++) {
    const p = pendingPrompts[i];
    const post = p.post as any;
    const partNum = Array.isArray(post) ? post[0]?.part_number : post?.part_number;

    log(`\n[${i + 1}/${pendingPrompts.length}] Part ${partNum} | ${p.image_type} | ${p.character_name || "no char"}`);
    log(`  Prompt: ${p.prompt.slice(0, 100)}...`);

    const result = await processPrompt({
      id: p.id,
      prompt: p.prompt,
      image_type: p.image_type,
      character_name: p.character_name,
      secondary_character_name: p.secondary_character_name,
      part_number: partNum || 0,
    });

    results.push(result);
    if (result.status === "success") successCount++;
    else failCount++;

    // Save progress
    writeFileSync(
      resolve(OUTPUT_DIR, "batch-results.json"),
      JSON.stringify({ results, summary: { total: pendingPrompts.length, success: successCount, failed: failCount } }, null, 2)
    );

    if (i < pendingPrompts.length - 1) {
      log("  Waiting 5s...");
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  // 4. Summary
  log("\n=== BATCH COMPLETE ===");
  log(`Total: ${pendingPrompts.length} | Success: ${successCount} | Failed: ${failCount}`);

  const scored = results.filter((r) => r.bestScore != null);
  if (scored.length > 0) {
    const avgScore = scored.reduce((s, r) => s + (r.bestScore ?? 0), 0) / scored.length;
    log(`Avg best score: ${Math.round(avgScore)}/100`);
  }

  if (failCount > 0) {
    log("\nFailed:");
    results.filter((r) => r.status === "failed").forEach((r) => {
      log(`  Part ${r.partNumber} ${r.imageType}: ${r.error}`);
    });
  }

  writeFileSync(
    resolve(OUTPUT_DIR, "batch-results.json"),
    JSON.stringify({ results, summary: { total: prompts.length, success: successCount, failed: failCount } }, null, 2)
  );
  log(`Results saved to ${OUTPUT_DIR}/batch-results.json`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
