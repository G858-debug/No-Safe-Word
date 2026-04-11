/**
 * Middelburg Nights v2 — Full Pipeline Rerun
 *
 * Orchestrates:
 *   Phase 0: Pre-flight checks
 *   Phase 1: Retrain Zanele's LoRA (or fallback to archived)
 *   Phase 2: Regenerate all 20 images with eval/retry pipeline
 *   Phase 3: Comprehensive report
 *
 * Usage:
 *   # Start dev server first:
 *   cd apps/web && npm run dev
 *
 *   # Then run:
 *   npx tsx --env-file=apps/web/.env.local scripts/run-middelburg-pipeline.ts
 *
 * Flags:
 *   --skip-lora         Skip LoRA training (assumes Zanele's LoRA is deployed)
 *   --use-archived-lora Immediately use the old working LoRA instead of retraining
 *   --skip-images       Skip image generation (test LoRA training only)
 *   --server-url=URL    Override dev server URL (default: http://localhost:3000)
 */

import { createClient } from "@supabase/supabase-js";
import { createHmac } from "crypto";

// ── Config ──

const SERIES_ID = "a1d144cd-d670-4ca2-8f48-cb123a183bdb";
const ZANELE_STORY_CHAR_ID = "90da82f5-8af9-4881-b786-df9aac5d1073";
const ZANELE_CHARACTER_ID = "7e3fad85-6d96-4b88-9eab-78f38b78a52d";
const ARCHIVED_LORA_ID = "48906184-f9c1-4a2b-bec5-fb8c1c3e809b";

const args = process.argv.slice(2);
const SKIP_LORA = args.includes("--skip-lora");
const USE_ARCHIVED = args.includes("--use-archived-lora");
const SKIP_IMAGES = args.includes("--skip-images");
const SERVER_URL = args.find(a => a.startsWith("--server-url="))?.split("=")[1] || "http://localhost:3001";

const LORA_POLL_INTERVAL = 30_000;   // 30s between LoRA progress polls
const LORA_TIMEOUT = 120 * 60_000;   // 120 minutes max for LoRA training
const IMAGE_POLL_INTERVAL = 5_000;   // 5s between image status polls
const IMAGE_TIMEOUT = 30 * 60_000;   // 30 minutes max per image
const CONCURRENT_POLLS = 5;          // Poll 5 jobs at a time

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Generate admin session cookie (HMAC-SHA256 of "nsw-admin-session" with ADMIN_PASSWORD)
function generateAdminToken(): string {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error("ADMIN_PASSWORD not set");
  const hmac = createHmac("sha256", password);
  hmac.update("nsw-admin-session");
  return hmac.digest("hex");
}

const ADMIN_TOKEN = generateAdminToken();

// ── Types ──

interface CharacterStatus {
  name: string;
  role: string;
  storyCharId: string;
  characterId: string;
  loraStatus: string | null;
  loraId: string | null;
  validationScore: number | null;
}

interface ImageJob {
  promptId: string;
  jobId: string;
  character: string;
  imageType: string;
  partNumber: number;
  postTitle: string;
  status: "polling" | "completed" | "failed";
  attempts: number;
  finalScore: number | null;
  failures: string[];
  startTime: number;
  endTime: number | null;
}

interface PipelineReport {
  loraResult: {
    method: string;
    loraId: string | null;
    validationScore: number | null;
    timeMs: number;
    success: boolean;
    error?: string;
  };
  imageResults: ImageJob[];
  bugsFixes: string[];
  startTime: number;
  endTime: number;
}

// ── Utilities ──

function elapsed(startMs: number): string {
  const sec = Math.round((Date.now() - startMs) / 1000);
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return min > 0 ? `${min}m${s}s` : `${s}s`;
}

function log(phase: string, msg: string) {
  const ts = new Date().toISOString().substring(11, 19);
  console.log(`[${ts}][${phase}] ${msg}`);
}

function logError(phase: string, msg: string) {
  const ts = new Date().toISOString().substring(11, 19);
  console.error(`[${ts}][${phase}] ERROR: ${msg}`);
}

async function fetchApi(path: string, options?: RequestInit): Promise<Response> {
  const url = `${SERVER_URL}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Cookie": `admin-session=${ADMIN_TOKEN}`,
      ...options?.headers,
    },
  });
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Phase 0: Pre-flight ──

async function preflight(): Promise<CharacterStatus[]> {
  log("PREFLIGHT", "Checking environment variables...");

  const required = [
    "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
    "RUNPOD_API_KEY", "RUNPOD_ENDPOINT_ID", "ANTHROPIC_API_KEY",
    "ENABLE_LORA_TRAINING", "ADMIN_PASSWORD",
  ];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing env vars: ${missing.join(", ")}`);
  }

  if (process.env.ENABLE_LORA_TRAINING !== "true") {
    throw new Error("ENABLE_LORA_TRAINING must be 'true'");
  }

  log("PREFLIGHT", `Pinging dev server at ${SERVER_URL}...`);
  try {
    const res = await fetch(`${SERVER_URL}/api/status/health-check`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    // Even a 404 means the server is running
    if (!res) {
      // Try a simpler endpoint
      const res2 = await fetch(SERVER_URL, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (!res2) {
        throw new Error(`Dev server not responding at ${SERVER_URL}. Start it with: cd apps/web && npm run dev`);
      }
    }
    log("PREFLIGHT", "Dev server is running.");
  } catch (err: any) {
    if (err.message?.includes("Dev server not responding")) throw err;
    // Connection errors mean server is down
    throw new Error(`Dev server not responding at ${SERVER_URL}. Start it with: cd apps/web && npm run dev`);
  }

  log("PREFLIGHT", "Loading characters and LoRA statuses...");

  const { data: storyChars } = await supabase
    .from("story_characters")
    .select("id, character_id, role, active_lora_id")
    .eq("series_id", SERIES_ID);

  if (!storyChars?.length) throw new Error("No story characters found for Middelburg Nights");

  const charIds = storyChars.map(sc => sc.character_id);
  const { data: chars } = await supabase.from("characters").select("id, name").in("id", charIds);
  const charMap = new Map((chars || []).map(c => [c.id, c.name]));

  const loraIds = storyChars.map(sc => sc.active_lora_id).filter(Boolean);
  const { data: loras } = loraIds.length > 0
    ? await supabase.from("character_loras").select("id, status, validation_score").in("id", loraIds)
    : { data: [] };
  const loraMap = new Map((loras || []).map(l => [l.id, l]));

  const statuses: CharacterStatus[] = storyChars.map(sc => {
    const lora = sc.active_lora_id ? loraMap.get(sc.active_lora_id) : null;
    return {
      name: charMap.get(sc.character_id) || "Unknown",
      role: sc.role,
      storyCharId: sc.id,
      characterId: sc.character_id,
      loraStatus: lora?.status || null,
      loraId: sc.active_lora_id,
      validationScore: lora ? Number(lora.validation_score) : null,
    };
  });

  // Verify Zanele's portrait URLs
  const zanele = statuses.find(s => s.characterId === ZANELE_CHARACTER_ID);
  if (!zanele) throw new Error("Zanele not found in series characters");

  const { data: zaneleSC } = await (supabase as any)
    .from("story_characters")
    .select("approved_image_id, approved_fullbody_image_id")
    .eq("id", ZANELE_STORY_CHAR_ID)
    .single();

  if (zaneleSC?.approved_image_id) {
    const { data: img } = await supabase.from("images").select("stored_url, sfw_url").eq("id", zaneleSC.approved_image_id).single();
    const url = img?.sfw_url || img?.stored_url;
    if (url) {
      try {
        const headRes = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10000) });
        log("PREFLIGHT", `Zanele portrait URL: ${headRes.ok ? "OK" : `HTTP ${headRes.status}`} (${url.substring(0, 60)}...)`);
      } catch {
        logError("PREFLIGHT", `Zanele portrait URL unreachable: ${url.substring(0, 60)}...`);
      }
    }
  }

  // Count image prompts
  const { data: posts } = await supabase.from("story_posts").select("id").eq("series_id", SERIES_ID);
  const postIds = (posts || []).map(p => p.id);
  const { data: prompts } = await supabase
    .from("story_image_prompts")
    .select("status")
    .in("post_id", postIds);

  const promptCounts: Record<string, number> = {};
  for (const p of prompts || []) {
    promptCounts[p.status] = (promptCounts[p.status] || 0) + 1;
  }

  // Dashboard
  console.log("\n" + "=".repeat(60));
  console.log("  MIDDELBURG NIGHTS v2 — PRE-FLIGHT STATUS");
  console.log("=".repeat(60));
  for (const s of statuses) {
    const scoreStr = s.validationScore ? ` (score: ${s.validationScore})` : "";
    const loraStr = s.loraStatus || "no LoRA";
    console.log(`  ${s.name.padEnd(20)} ${s.role.padEnd(15)} LoRA: ${loraStr}${scoreStr}`);
  }
  console.log(`\n  Image prompts: ${prompts?.length || 0} total`);
  for (const [status, count] of Object.entries(promptCounts)) {
    console.log(`    ${status}: ${count}`);
  }
  console.log("=".repeat(60) + "\n");

  return statuses;
}

// ── Phase 1: Retrain Zanele's LoRA ──

async function retrainZaneleLora(): Promise<PipelineReport["loraResult"]> {
  const startTime = Date.now();

  if (USE_ARCHIVED) {
    return await useArchivedLora(startTime);
  }

  log("LORA", "Triggering fresh LoRA training for Zanele...");

  const res = await fetchApi(`/api/stories/characters/${ZANELE_STORY_CHAR_ID}/train-lora`, {
    method: "POST",
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    logError("LORA", `train-lora failed: ${res.status} — ${JSON.stringify(body)}`);
    log("LORA", "Falling back to archived LoRA...");
    return await useArchivedLora(startTime);
  }

  const { loraId } = await res.json();
  log("LORA", `Training started. New LoRA ID: ${loraId}`);

  // Poll until deployed, failed, or timeout
  const deadline = Date.now() + LORA_TIMEOUT;
  let lastStatus = "";
  let datasetAutoApproved = false;

  while (Date.now() < deadline) {
    await sleep(LORA_POLL_INTERVAL);

    const progressRes = await fetchApi(`/api/stories/characters/${ZANELE_STORY_CHAR_ID}/lora-progress`);
    if (!progressRes.ok) {
      logError("LORA", `lora-progress failed: ${progressRes.status}`);
      continue;
    }

    const { status, progress } = await progressRes.json();
    const stage = progress?.stage || status;

    if (stage !== lastStatus) {
      log("LORA", `Status: ${stage}${progress?.trainingAttempts ? ` (attempt ${progress.trainingAttempts})` : ""}`);
      lastStatus = stage;
    }

    // Auto-approve dataset when pipeline pauses
    if ((stage === "awaiting_dataset_approval" || stage === "awaiting_pass2_approval") && !datasetAutoApproved) {
      log("LORA", "Dataset ready for approval — auto-approving passed images...");
      await autoApproveDataset(loraId);
      datasetAutoApproved = true;

      // Resume training
      log("LORA", "Calling resume-training...");
      const resumeRes = await fetchApi(`/api/stories/characters/${ZANELE_STORY_CHAR_ID}/resume-training`, {
        method: "POST",
      });
      if (resumeRes.ok) {
        const resumeData = await resumeRes.json();
        log("LORA", `Resumed: ${resumeData.message}`);
      } else {
        logError("LORA", `resume-training failed: ${resumeRes.status}`);
      }

      // Reset for pass 2 approval
      if (stage === "awaiting_dataset_approval") {
        datasetAutoApproved = false;
      }
    }

    // Terminal states
    if (stage === "deployed") {
      log("LORA", `LoRA DEPLOYED! Validation score: ${progress?.validationScore}`);
      return {
        method: "fresh_training",
        loraId,
        validationScore: progress?.validationScore ? Number(progress.validationScore) : null,
        timeMs: Date.now() - startTime,
        success: true,
      };
    }

    if (stage === "failed") {
      logError("LORA", `Training failed: ${progress?.error || "unknown error"}`);
      log("LORA", "Falling back to archived LoRA...");
      return await useArchivedLora(startTime);
    }
  }

  logError("LORA", `Training timed out after ${elapsed(startTime)}`);
  log("LORA", "Falling back to archived LoRA...");
  return await useArchivedLora(startTime);
}

async function autoApproveDataset(loraId: string): Promise<void> {
  // Get all passed images for this LoRA
  const { data: images } = await supabase
    .from("lora_dataset_images")
    .select("id, category, eval_score, eval_status")
    .eq("lora_id", loraId)
    .eq("eval_status", "passed");

  if (!images?.length) {
    logError("LORA", "No passed images found for auto-approval!");
    return;
  }

  // Approve all passed images
  const ids = images.map(i => i.id);
  await supabase
    .from("lora_dataset_images")
    .update({ human_approved: true })
    .in("id", ids);

  // Log summary
  const categories: Record<string, number> = {};
  let totalScore = 0;
  for (const img of images) {
    categories[img.category] = (categories[img.category] || 0) + 1;
    totalScore += Number(img.eval_score) || 0;
  }

  log("LORA", `Auto-approved ${images.length} images (avg score: ${(totalScore / images.length).toFixed(1)})`);
  for (const [cat, count] of Object.entries(categories)) {
    log("LORA", `  ${cat}: ${count}`);
  }
}

async function useArchivedLora(startTime: number): Promise<PipelineReport["loraResult"]> {
  log("LORA", `Un-archiving old working LoRA (${ARCHIVED_LORA_ID})...`);

  // Check it exists and has a storage URL
  const { data: archivedLora } = await supabase
    .from("character_loras")
    .select("id, status, storage_url, trigger_word, filename, validation_score")
    .eq("id", ARCHIVED_LORA_ID)
    .single();

  if (!archivedLora) {
    return {
      method: "archived_fallback",
      loraId: null,
      validationScore: null,
      timeMs: Date.now() - startTime,
      success: false,
      error: `Archived LoRA ${ARCHIVED_LORA_ID} not found`,
    };
  }

  if (!archivedLora.storage_url) {
    return {
      method: "archived_fallback",
      loraId: ARCHIVED_LORA_ID,
      validationScore: null,
      timeMs: Date.now() - startTime,
      success: false,
      error: "Archived LoRA has no storage URL",
    };
  }

  // Set to deployed
  await supabase
    .from("character_loras")
    .update({
      status: "deployed",
      deployed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", ARCHIVED_LORA_ID);

  // Update story_characters to point to it
  await (supabase as any)
    .from("story_characters")
    .update({ active_lora_id: ARCHIVED_LORA_ID })
    .eq("id", ZANELE_STORY_CHAR_ID);

  log("LORA", `Archived LoRA restored. Trigger: ${archivedLora.trigger_word}, Score: ${archivedLora.validation_score}`);
  log("LORA", "WARNING: Using fallback LoRA — fresh training should be attempted later.");

  return {
    method: "archived_fallback",
    loraId: ARCHIVED_LORA_ID,
    validationScore: archivedLora.validation_score ? Number(archivedLora.validation_score) : null,
    timeMs: Date.now() - startTime,
    success: true,
  };
}

// ── Phase 2: Regenerate Images ──

async function regenerateImages(): Promise<ImageJob[]> {
  log("IMAGES", "Regenerating all images with eval/retry pipeline...");

  // Call generate-images-v4 with regenerate flag
  const res = await fetchApi(`/api/stories/${SERIES_ID}/generate-images-v4`, {
    method: "POST",
    body: JSON.stringify({ regenerate: true }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`generate-images-v4 failed: ${res.status} — ${JSON.stringify(body)}`);
  }

  const result = await res.json();
  log("IMAGES", `Submitted: ${result.queued} jobs, ${result.failed || 0} failed at submission`);

  if (!result.jobs?.length) {
    log("IMAGES", "No jobs to poll.");
    return [];
  }

  // Load prompt metadata for reporting
  const { data: posts } = await supabase.from("story_posts").select("id, part_number, title").eq("series_id", SERIES_ID);
  const postMap = new Map((posts || []).map(p => [p.id, p]));

  const promptIds = result.jobs.map((j: any) => j.promptId);
  const { data: prompts } = await supabase
    .from("story_image_prompts")
    .select("id, post_id, image_type, character_name, secondary_character_name")
    .in("id", promptIds);
  const promptMap = new Map((prompts || []).map(p => [p.id, p]));

  // Build job tracker
  const jobs: ImageJob[] = result.jobs.map((j: any) => {
    const prompt = promptMap.get(j.promptId);
    const post = prompt ? postMap.get(prompt.post_id) : null;
    const charName = prompt?.character_name || "Unknown";
    const secName = prompt?.secondary_character_name;
    return {
      promptId: j.promptId,
      jobId: j.jobId,
      character: secName ? `${charName} + ${secName}` : charName,
      imageType: prompt?.image_type || "unknown",
      partNumber: post?.part_number || 0,
      postTitle: post?.title || "Unknown",
      status: "polling" as const,
      attempts: 1,
      finalScore: null,
      failures: [],
      startTime: Date.now(),
      endTime: null,
    };
  });

  // Also add any submission failures
  if (result.errors) {
    for (const err of result.errors) {
      const prompt = promptMap.get(err.promptId);
      const post = prompt ? postMap.get(prompt.post_id) : null;
      jobs.push({
        promptId: err.promptId,
        jobId: "",
        character: prompt?.character_name || "Unknown",
        imageType: prompt?.image_type || "unknown",
        partNumber: post?.part_number || 0,
        postTitle: post?.title || "Unknown",
        status: "failed",
        attempts: 0,
        finalScore: null,
        failures: [err.error],
        startTime: Date.now(),
        endTime: Date.now(),
      });
    }
  }

  log("IMAGES", `Polling ${jobs.filter(j => j.status === "polling").length} jobs...`);

  // Poll in batches
  await pollImageJobs(jobs);

  return jobs;
}

async function pollImageJobs(jobs: ImageJob[]): Promise<void> {
  const polling = () => jobs.filter(j => j.status === "polling");

  while (polling().length > 0) {
    const batch = polling().slice(0, CONCURRENT_POLLS);

    await Promise.all(batch.map(async (job) => {
      // Timeout check
      if (Date.now() - job.startTime > IMAGE_TIMEOUT) {
        job.status = "failed";
        job.failures.push("Timed out");
        job.endTime = Date.now();
        logError("IMAGES", `${job.character} [${job.imageType}]: timed out after ${elapsed(job.startTime)}`);
        return;
      }

      try {
        const res = await fetchApi(`/api/status/${job.jobId}`);
        if (!res.ok) {
          logError("IMAGES", `Status poll failed for ${job.jobId}: ${res.status}`);
          return;
        }

        const data = await res.json();

        if (data.completed) {
          job.status = "completed";
          job.endTime = Date.now();
          if (data.evaluation) {
            job.finalScore = data.evaluation.overallScore;
            job.attempts = data.evaluation.attempt || 1;
            job.failures = data.evaluation.failures || [];
          }
          log("IMAGES", `  OK ${job.character} [${job.imageType}]: score=${job.finalScore?.toFixed(1) || "?"}, attempts=${job.attempts}, ${elapsed(job.startTime)}`);
          return;
        }

        if (data.status === "RETRYING") {
          // Follow the retry chain
          job.jobId = data.jobId;
          job.attempts = data.evaluation?.attempt || job.attempts + 1;
          const failStr = data.evaluation?.failures?.join(", ") || data.retryReason || "";
          log("IMAGES", `  RETRY ${job.character} [${job.imageType}]: attempt ${job.attempts}, reason: ${failStr.substring(0, 80)}`);
          return;
        }

        if (data.status === "RETRY_FAILED") {
          job.status = "failed";
          job.endTime = Date.now();
          job.failures.push(data.error || "Retry endpoint failed");
          logError("IMAGES", `${job.character} [${job.imageType}]: retry failed — ${data.error}`);
          return;
        }

        if (data.error) {
          job.status = "failed";
          job.endTime = Date.now();
          job.failures.push(data.error);
          logError("IMAGES", `${job.character} [${job.imageType}]: ${data.error}`);
          return;
        }

        // Still in progress (IN_QUEUE, IN_PROGRESS)
        // Continue polling
      } catch (err: any) {
        logError("IMAGES", `Poll error for ${job.character}: ${err.message}`);
      }
    }));

    // Wait before next batch
    if (polling().length > 0) {
      await sleep(IMAGE_POLL_INTERVAL);
    }
  }
}

// ── Phase 3: Report ──

function printReport(report: PipelineReport): void {
  const totalTime = report.endTime - report.startTime;
  const completed = report.imageResults.filter(j => j.status === "completed");
  const failed = report.imageResults.filter(j => j.status === "failed");
  const total = report.imageResults.length;

  console.log("\n" + "=".repeat(70));
  console.log("  MIDDELBURG NIGHTS v2 — PIPELINE RUN REPORT");
  console.log("=".repeat(70));

  // LoRA Training
  console.log("\n  LoRA Training:");
  console.log(`    Zanele Mokoena  — ${report.loraResult.success ? "SUCCESS" : "FAILED"}`);
  console.log(`    Method:         ${report.loraResult.method}`);
  console.log(`    LoRA ID:        ${report.loraResult.loraId || "none"}`);
  console.log(`    Validation:     ${report.loraResult.validationScore ?? "n/a"}`);
  console.log(`    Time:           ${elapsed(report.startTime)}`);
  if (report.loraResult.error) {
    console.log(`    Error:          ${report.loraResult.error}`);
  }

  // Image Generation
  console.log(`\n  Image Generation (${total} prompts):`);
  console.log(`    Completed:      ${completed.length}/${total}`);
  console.log(`    Failed:         ${failed.length}/${total}`);

  if (completed.length > 0) {
    const avgScore = completed.reduce((sum, j) => sum + (j.finalScore || 0), 0) / completed.length;
    const avgAttempts = completed.reduce((sum, j) => sum + j.attempts, 0) / completed.length;
    const firstAttemptPass = completed.filter(j => j.attempts === 1).length;
    const avgTime = completed.reduce((sum, j) => sum + ((j.endTime || 0) - j.startTime), 0) / completed.length;

    console.log(`\n    Average score:         ${avgScore.toFixed(2)}`);
    console.log(`    Average attempts:      ${avgAttempts.toFixed(1)}`);
    console.log(`    First-attempt pass:    ${firstAttemptPass}/${completed.length} (${Math.round(firstAttemptPass / completed.length * 100)}%)`);
    console.log(`    Average time/image:    ${Math.round(avgTime / 1000)}s`);
  }

  // Per-prompt results table
  console.log("\n  Per-Prompt Results:");
  console.log("  " + "-".repeat(66));
  console.log(`  ${"Part".padEnd(5)} ${"Character".padEnd(25)} ${"Type".padEnd(12)} ${"Score".padEnd(7)} ${"Att".padEnd(5)} ${"Status".padEnd(8)} Time`);
  console.log("  " + "-".repeat(66));

  const sorted = [...report.imageResults].sort((a, b) => {
    if (a.partNumber !== b.partNumber) return a.partNumber - b.partNumber;
    return a.imageType.localeCompare(b.imageType);
  });

  for (const job of sorted) {
    const part = `P${job.partNumber}`;
    const char = job.character.substring(0, 24).padEnd(25);
    const type = job.imageType.substring(0, 11).padEnd(12);
    const score = job.finalScore != null ? job.finalScore.toFixed(1).padEnd(7) : "—".padEnd(7);
    const att = String(job.attempts).padEnd(5);
    const status = job.status === "completed" ? "PASS" : "FAIL";
    const time = job.endTime ? elapsed(job.startTime) : "—";
    console.log(`  ${part.padEnd(5)} ${char} ${type} ${score} ${att} ${status.padEnd(8)} ${time}`);
  }
  console.log("  " + "-".repeat(66));

  // Common failures
  if (report.imageResults.some(j => j.failures.length > 0)) {
    const failureCounts: Record<string, number> = {};
    for (const job of report.imageResults) {
      for (const f of job.failures) {
        failureCounts[f] = (failureCounts[f] || 0) + 1;
      }
    }
    console.log("\n  Common Failure Categories:");
    const sortedFailures = Object.entries(failureCounts).sort((a, b) => b[1] - a[1]);
    for (const [cat, count] of sortedFailures.slice(0, 10)) {
      console.log(`    ${cat}: ${count}`);
    }
  }

  // Bug fixes
  if (report.bugsFixes.length > 0) {
    console.log("\n  Pipeline Bug Fixes Applied:");
    for (const fix of report.bugsFixes) {
      console.log(`    - ${fix}`);
    }
  }

  // Summary
  console.log(`\n  Total pipeline time: ${elapsed(report.startTime)}`);
  console.log("=".repeat(70) + "\n");
}

// ── Main ──

async function main(): Promise<void> {
  const pipelineStart = Date.now();

  console.log("\n  Middelburg Nights v2 — Full Pipeline Rerun\n");

  // Phase 0
  const statuses = await preflight();
  const zanele = statuses.find(s => s.characterId === ZANELE_CHARACTER_ID)!;

  // Phase 1: LoRA
  let loraResult: PipelineReport["loraResult"];

  if (SKIP_LORA) {
    log("LORA", "Skipping LoRA training (--skip-lora)");
    loraResult = {
      method: "skipped",
      loraId: zanele.loraId,
      validationScore: zanele.validationScore,
      timeMs: 0,
      success: zanele.loraStatus === "deployed",
    };
    if (!loraResult.success) {
      logError("LORA", `Zanele's LoRA is "${zanele.loraStatus}", not deployed! Images will fail.`);
    }
  } else if (zanele.loraStatus === "deployed") {
    log("LORA", "Zanele's LoRA is already deployed. Skipping training.");
    loraResult = {
      method: "already_deployed",
      loraId: zanele.loraId,
      validationScore: zanele.validationScore,
      timeMs: 0,
      success: true,
    };
  } else {
    loraResult = await retrainZaneleLora();
  }

  if (!loraResult.success) {
    logError("MAIN", "LoRA training failed with no fallback. Cannot generate images.");
    printReport({
      loraResult,
      imageResults: [],
      bugsFixes: [
        "Retry endpoint now stores profile in image settings",
        "Generate-images-v4 now stores profile in image settings",
        "Status endpoint retry calls now use request origin instead of production URL",
      ],
      startTime: pipelineStart,
      endTime: Date.now(),
    });
    process.exit(1);
  }

  // Phase 2: Images
  let imageResults: ImageJob[] = [];

  if (SKIP_IMAGES) {
    log("IMAGES", "Skipping image generation (--skip-images)");
  } else {
    imageResults = await regenerateImages();
  }

  // Phase 3: Report
  const report: PipelineReport = {
    loraResult,
    imageResults,
    bugsFixes: [
      "Retry endpoint now stores profile in image settings (LoRA strength adjustments preserved across retries)",
      "Generate-images-v4 now stores profile in image settings (consistent with retry endpoint)",
      "Status endpoint retry calls use request origin instead of hardcoded production URL",
    ],
    startTime: pipelineStart,
    endTime: Date.now(),
  };

  printReport(report);
}

main().catch((err) => {
  console.error("\nFATAL:", err.message || err);
  process.exit(1);
});
