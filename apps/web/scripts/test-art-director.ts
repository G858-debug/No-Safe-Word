#!/usr/bin/env npx tsx
/**
 * Art Director E2E Test Script
 *
 * Runs the full 8-step Art Director flow standalone (no Next.js server needed).
 * Tests: intent analysis -> CivitAI search -> reference ranking -> recipe adaptation
 *        -> CivitAI generation -> evaluation -> iteration loop
 *
 * Usage: cd apps/web && npx tsx scripts/test-art-director.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";

// ── Load .env.local ──
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
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
} catch {
  console.error(`Could not read ${envPath}`);
  process.exit(1);
}

// ── Imports (after env is loaded) ──
import {
  analyzeText,
  analyzeImage,
  analyzeMultipleImages,
  parseJsonResponse,
  ensureArray,
  healthCheck,
} from "../lib/art-director/qwen-vl-client";
import {
  searchMultipleQueries,
  downloadImageAsBase64,
  parseImageMetadata,
  generateViaCivitAI,
  waitForCivitAIJob,
  normalizeScheduler,
} from "../lib/art-director/civitai-client";
import {
  INTENT_ANALYSIS_SYSTEM,
  buildReferenceRankingPrompt,
  buildRecipeAdaptationPrompt,
  EVALUATION_SYSTEM,
  ITERATION_FEEDBACK_SYSTEM,
} from "../lib/art-director/prompts";
import type {
  IntentAnalysis,
  ParsedRecipe,
  EvaluationScores,
  RankedReference,
  CivitAIImageResult,
} from "../lib/art-director/types";

// ── Constants ──

const TEST_PROMPT = `1girl 1boy, sex, cowgirl position, woman straddling man lying on his back, her hands on his chest, head tilted back eyes closed in pleasure, his hands on her thighs, both nude, sweat on skin, township bedroom, warm bedside lamp light from below, tangled sheets, medium shot slightly low angle looking up, golden warm tones`;

const FEMALE_DESCRIPTION = "Black South African woman, 24, medium-brown skin, oval face, high cheekbones, braids worn loose, curvaceous figure — full breasts, defined waist, round hips";
const MALE_DESCRIPTION = "Black South African man, 28, dark brown skin, short natural hair, muscular build, broad shoulders, strong jawline";

const MAX_ITERATIONS = 8;
const PASS_THRESHOLD = 90;
const OUTPUT_DIR = resolve(__dirname, "../test-output");

// ── Logging ──

interface LogEntry {
  timestamp: string;
  step: string;
  message: string;
  data?: unknown;
}

const logEntries: LogEntry[] = [];

function timestamp(): string {
  return new Date().toLocaleTimeString("en-ZA", { hour12: false });
}

function log(step: string, message: string, data?: unknown): void {
  const ts = timestamp();
  const entry: LogEntry = { timestamp: ts, step, message, data };
  logEntries.push(entry);
  console.log(`[${ts}] ${step} ${message}`);
}

function saveLog(): void {
  writeFileSync(
    resolve(OUTPUT_DIR, "test-log.json"),
    JSON.stringify(logEntries, null, 2)
  );
}

// ── Results tracking ──

interface StepResult {
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  summary: string;
  durationMs: number;
}

interface IterationScore {
  attempt: number;
  overall: number;
  scores: EvaluationScores;
  feedback: string;
}

const stepResults: StepResult[] = [];
const iterationScores: IterationScore[] = [];
let bestScore = 0;
let bestIteration = 0;
let totalIterations = 0;
let qwenVLMaxModelLen: number | null = null;

// ── Helpers ──

async function downloadAndSaveImage(url: string, filename: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const filepath = resolve(OUTPUT_DIR, filename);
  writeFileSync(filepath, buffer);
  return filepath;
}

// ── Main Flow ──

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  log("[SETUP]", "Art Director E2E Test starting...");
  log("[SETUP]", `Pod ID: ${process.env.QWEN_VL_POD_ID}`);
  log("[SETUP]", `Test prompt: ${TEST_PROMPT.slice(0, 80)}...`);

  // ── Pre-flight: Health check ──
  log("[SETUP]", "Checking Qwen VL health...");
  const health = await healthCheck();
  if (health.status !== "ok") {
    log("[SETUP]", `Qwen VL not ready: ${health.status}. Waiting 30s...`);
    await new Promise((r) => setTimeout(r, 30_000));
    const health2 = await healthCheck();
    if (health2.status !== "ok") {
      log("[SETUP]", `Qwen VL still not ready: ${health2.status}. Aborting.`);
      saveLog();
      process.exit(1);
    }
  }
  log("[SETUP]", "Qwen VL is healthy.");

  // Check max_model_len from /v1/models
  try {
    const podId = process.env.QWEN_VL_POD_ID!;
    const modelsRes = await fetch(`https://${podId}-8000.proxy.runpod.net/v1/models`);
    if (modelsRes.ok) {
      const modelsData = await modelsRes.json() as any;
      const modelInfo = modelsData?.data?.[0];
      qwenVLMaxModelLen = modelInfo?.max_model_len ?? null;
      log("[SETUP]", `Model: ${modelInfo?.id}, max_model_len: ${qwenVLMaxModelLen}`);
    }
  } catch (err) {
    log("[SETUP]", `Could not fetch /v1/models: ${err}`);
  }

  let intentAnalysis: IntentAnalysis | null = null;
  let rankedReferences: RankedReference[] = [];
  let selectedReference: RankedReference | null = null;
  let adaptedRecipe: ParsedRecipe | null = null;

  // ══════════════════════════════════════════════════════════════
  // STEP 1: Intent Analysis
  // ══════════════════════════════════════════════════════════════
  try {
    const start = Date.now();
    log("[STEP 1/7]", "Analyzing intent...");

    const intentPrompt = `Scene description: "${TEST_PROMPT}"
Characters mentioned: Female character, Male character
Image type: website_exclusive

Character descriptions:
- Female: ${FEMALE_DESCRIPTION}
- Male: ${MALE_DESCRIPTION}

Analyze this scene and return the structured intent JSON.`;

    const intentResponse = await analyzeText(intentPrompt, {
      systemPrompt: INTENT_ANALYSIS_SYSTEM,
      jsonMode: true,
      maxTokens: 2048,
    });

    intentAnalysis = parseJsonResponse<IntentAnalysis>(intentResponse, "intent analysis");

    const duration = Date.now() - start;
    log("[STEP 1/7]", `✓ Intent: ${intentAnalysis.characterCount} characters, ${intentAnalysis.poses[0] || "unknown pose"}, ${intentAnalysis.nsfwLevel}, ${intentAnalysis.setting}`);
    log("[STEP 1/7]", `  Search queries: ${intentAnalysis.searchQueries.join(" | ")}`);
    log("[STEP 1/7]", `  Tokens used: ${intentResponse.usage.prompt_tokens} prompt, ${intentResponse.usage.completion_tokens} completion`);

    stepResults.push({
      name: "Intent Analysis",
      status: "PASS",
      summary: `${intentAnalysis.characterCount} chars, ${intentAnalysis.interactionType}, ${intentAnalysis.nsfwLevel}, queries: ${intentAnalysis.searchQueries.join(" | ")}`,
      durationMs: duration,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("[STEP 1/7]", `✗ Failed: ${msg}`);
    stepResults.push({ name: "Intent Analysis", status: "FAIL", summary: msg, durationMs: 0 });
    saveLog();
    generateReport();
    process.exit(1);
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 2: CivitAI Search
  // ══════════════════════════════════════════════════════════════
  let searchResults: CivitAIImageResult[] = [];
  let downloadedImages: Array<{ base64: string; result: CivitAIImageResult; recipe: ParsedRecipe }> = [];

  try {
    const start = Date.now();
    log("[STEP 2/7]", `Searching CivitAI (${intentAnalysis!.searchQueries.length} queries)...`);

    searchResults = await searchMultipleQueries(intentAnalysis!.searchQueries, {
      nsfw: true,
      sort: "Most Reactions",
      period: "AllTime",
      limit: 10,
    });

    // Filter to images with metadata
    const withMeta = searchResults.filter((r) => r.meta && r.meta.prompt);
    log("[STEP 2/7]", `Found ${searchResults.length} total, ${withMeta.length} with metadata`);

    // Take top 5 with metadata and download
    const candidates = withMeta.slice(0, 5);
    for (const candidate of candidates) {
      try {
        const base64 = await downloadImageAsBase64(candidate.url);
        const recipe = parseImageMetadata(candidate.meta);
        downloadedImages.push({ base64, result: candidate, recipe });
        log("[STEP 2/7]", `  Downloaded ${candidate.id}: ${recipe.model || "unknown model"}, ${recipe.dimensions.width}x${recipe.dimensions.height}, CFG ${recipe.cfgScale}, ${recipe.loras.length} LoRAs`);
      } catch (err) {
        log("[STEP 2/7]", `  Failed to download ${candidate.id}: ${err}`);
      }
    }

    const duration = Date.now() - start;
    log("[STEP 2/7]", `✓ Found ${downloadedImages.length} unique references with recipes`);

    stepResults.push({
      name: "CivitAI Search",
      status: downloadedImages.length > 0 ? "PASS" : "FAIL",
      summary: `${searchResults.length} total, ${downloadedImages.length} downloaded with recipes`,
      durationMs: duration,
    });

    if (downloadedImages.length === 0) {
      log("[STEP 2/7]", "No references found with metadata.");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("[STEP 2/7]", `✗ Search failed: ${msg}`);
    stepResults.push({ name: "CivitAI Search", status: "FAIL", summary: msg, durationMs: 0 });
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 3: Reference Ranking (skip if no images from search)
  // ══════════════════════════════════════════════════════════════
  if (downloadedImages.length > 0) {
    try {
      const start = Date.now();
      log("[STEP 3/7]", `Ranking references with Qwen VL (sending ${downloadedImages.length} images)...`);

      const imageInputs = downloadedImages.map((img, i) => ({
        url: img.base64,
        label: `Image ${i}: ${img.recipe.model || "unknown"} — ${img.recipe.prompt.slice(0, 60)}`,
      }));

      const rankingPrompt = `Scene intent: ${JSON.stringify(intentAnalysis)}

I'm showing you ${imageInputs.length} candidate reference images. Rank them by how well their composition, pose, and mood match the intended scene. Return the JSON array as specified.`;

      const rankResponse = await analyzeMultipleImages(imageInputs, rankingPrompt, {
        systemPrompt: buildReferenceRankingPrompt(),
        jsonMode: true,
        maxTokens: 3000,
      });

      const rawRankings = parseJsonResponse<unknown>(rankResponse, "reference ranking");

      // Qwen VL sometimes returns a single object instead of an array — normalize
      const typedRankings = ensureArray(rawRankings) as Array<{
        imageIndex: number;
        rank: number;
        relevanceScore: number;
        whatMatches: string;
        whatDoesnt: string;
        explanation: string;
      }>;

      // Build ranked references
      rankedReferences = typedRankings
        .filter((r) => r.imageIndex >= 0 && r.imageIndex < downloadedImages.length)
        .slice(0, 5)
        .map((r) => {
          const img = downloadedImages[r.imageIndex];
          return {
            id: img.result.id,
            url: img.result.url,
            recipe: img.recipe,
            rank: r.rank,
            explanation: r.explanation,
            whatMatches: r.whatMatches,
            whatDoesnt: r.whatDoesnt,
            relevanceScore: r.relevanceScore,
          };
        });

      // Auto-select top ranked
      selectedReference = rankedReferences[0] || null;

      const duration = Date.now() - start;
      if (selectedReference) {
        log("[STEP 3/7]", `✓ Top reference: ${selectedReference.recipe.model || "unknown"}, score ${selectedReference.relevanceScore}/100`);
        log("[STEP 3/7]", `  Matches: ${selectedReference.whatMatches}`);
        log("[STEP 3/7]", `  Doesn't match: ${selectedReference.whatDoesnt}`);
        log("[STEP 3/7]", `  Tokens used: ${rankResponse.usage.prompt_tokens} prompt, ${rankResponse.usage.completion_tokens} completion`);
      }

      stepResults.push({
        name: "Reference Ranking",
        status: selectedReference ? "PASS" : "FAIL",
        summary: selectedReference
          ? `Top: ${selectedReference.recipe.model}, score ${selectedReference.relevanceScore}/100 — ${selectedReference.whatMatches.slice(0, 80)}`
          : "No valid rankings returned",
        durationMs: duration,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("[STEP 3/7]", `✗ Failed: ${msg}`);
      stepResults.push({ name: "Reference Ranking", status: "FAIL", summary: msg, durationMs: 0 });
    }
  } else {
    log("[STEP 3/7]", "Skipped — no reference images to rank.");
    stepResults.push({ name: "Reference Ranking", status: "SKIP", summary: "No reference images available (CivitAI search failed)", durationMs: 0 });
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 4: Recipe Adaptation (or direct recipe construction if no reference)
  // ══════════════════════════════════════════════════════════════
  try {
    const start = Date.now();

    if (selectedReference) {
      // Normal path: adapt from reference
      log("[STEP 4/7]", "Adapting recipe from selected reference...");

      const referenceModelName = selectedReference.recipe.model;
      const adaptationSystemPrompt = buildRecipeAdaptationPrompt(referenceModelName);

      const refImg = downloadedImages.find((img) => img.result.id === selectedReference!.id);
      const refBase64 = refImg?.base64 || downloadedImages[0].base64;

      const adaptPrompt = `REFERENCE IMAGE RECIPE:
${JSON.stringify(selectedReference.recipe, null, 2)}

TARGET SCENE:
${JSON.stringify(intentAnalysis, null, 2)}

CHARACTER DESCRIPTIONS:
- Female: ${FEMALE_DESCRIPTION}
- Male: ${MALE_DESCRIPTION}

Adapt the reference recipe for our target scene. Keep what makes the reference look good, change what needs to match our scene.`;

      const response = await analyzeImage(refBase64, adaptPrompt, {
        systemPrompt: adaptationSystemPrompt,
        jsonMode: true,
        maxTokens: 3000,
      });

      adaptedRecipe = parseJsonResponse<ParsedRecipe>(response, "recipe adaptation");
    } else {
      // Fallback: construct recipe directly with Qwen VL + SD knowledge
      log("[STEP 4/7]", "No reference available — constructing recipe directly with Qwen VL...");

      const directRecipeSystemPrompt = buildRecipeAdaptationPrompt("Juggernaut XL Ragnarok");

      const directPrompt = `There is no reference image available. Construct a generation recipe from scratch for this scene.

TARGET SCENE:
${JSON.stringify(intentAnalysis, null, 2)}

CHARACTER DESCRIPTIONS:
- Female: ${FEMALE_DESCRIPTION}
- Male: ${MALE_DESCRIPTION}

Use Juggernaut XL Ragnarok as the base model. Create an optimised SDXL recipe following the technical knowledge provided. Focus on:
1. Front-loading character count and interaction type in the prompt
2. Using the exact skin tone descriptors for each character
3. Setting appropriate CFG for the darker skin tones (4.5-5.5)
4. Landscape orientation (1216x832) for a two-character scene
5. Keeping prompt under 77 tokens

Return the recipe JSON as specified.`;

      const response = await analyzeText(directPrompt, {
        systemPrompt: directRecipeSystemPrompt,
        jsonMode: true,
        maxTokens: 3000,
      });

      adaptedRecipe = parseJsonResponse<ParsedRecipe>(response, "direct recipe construction");
    }

    const duration = Date.now() - start;
    log("[STEP 4/7]", `✓ Recipe: ${adaptedRecipe.model || "default"}, CFG ${adaptedRecipe.cfgScale}, ${adaptedRecipe.steps} steps, ${adaptedRecipe.loras.length} LoRAs`);
    log("[STEP 4/7]", `  Prompt: ${adaptedRecipe.prompt.slice(0, 120)}...`);
    log("[STEP 4/7]", `  Negative: ${adaptedRecipe.negativePrompt.slice(0, 80)}...`);
    log("[STEP 4/7]", `  Dimensions: ${adaptedRecipe.dimensions.width}x${adaptedRecipe.dimensions.height}`);
    log("[STEP 4/7]", `  Sampler: ${adaptedRecipe.sampler}`);

    stepResults.push({
      name: "Recipe Adaptation",
      status: "PASS",
      summary: `${adaptedRecipe.model}, CFG ${adaptedRecipe.cfgScale}, ${adaptedRecipe.steps} steps, ${adaptedRecipe.loras.length} LoRAs, ${adaptedRecipe.dimensions.width}x${adaptedRecipe.dimensions.height}`,
      durationMs: duration,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("[STEP 4/7]", `✗ Failed: ${msg}`);
    stepResults.push({ name: "Recipe Adaptation", status: "FAIL", summary: msg, durationMs: 0 });
    saveLog();
    generateReport();
    process.exit(1);
  }

  // ══════════════════════════════════════════════════════════════
  // STEPS 5-7: Generate -> Evaluate -> Iterate
  // ══════════════════════════════════════════════════════════════
  let currentRecipe = { ...adaptedRecipe! };
  let generationPassed = false;
  let evaluationPassed = false;

  for (let attempt = 1; attempt <= MAX_ITERATIONS; attempt++) {
    totalIterations = attempt;

    // ── Step 5: Generate ──
    let imageUrl: string | null = null;
    let imageBase64: string | null = null;

    try {
      const genStart = Date.now();
      log(`[STEP 5/7]`, `Generating via CivitAI (attempt ${attempt}/${MAX_ITERATIONS})...`);

      // Build model URN
      let modelUrn = currentRecipe.model || "";
      if (!modelUrn.startsWith("urn:air:")) {
        modelUrn = "urn:air:sdxl:checkpoint:civitai:133005@357609"; // Juggernaut XL Ragnarok
        log(`[STEP 5/7]`, `  Model "${currentRecipe.model}" is not a URN — using Juggernaut XL Ragnarok`);
      }

      // Build additional networks for LoRAs (only URN-based ones work with CivitAI generation)
      const additionalNetworks: Record<string, { type: string; strength: number }> = {};
      for (const lora of currentRecipe.loras) {
        if (lora.name.startsWith("urn:air:")) {
          additionalNetworks[lora.name] = { type: "Lora", strength: lora.weight };
        }
      }

      // Normalize scheduler name for CivitAI SDK
      const scheduler = normalizeScheduler(currentRecipe.sampler);
      // Juggernaut XL uses clipSkip 1
      const clipSkip = modelUrn.includes("133005") ? 1 : (currentRecipe.clipSkip || 1);

      log(`[STEP 5/7]`, `  Scheduler: ${currentRecipe.sampler} -> ${scheduler}, clipSkip: ${clipSkip}`);

      const genResult = await generateViaCivitAI({
        model: modelUrn,
        prompt: currentRecipe.prompt,
        negativePrompt: currentRecipe.negativePrompt,
        scheduler: scheduler,
        steps: currentRecipe.steps,
        cfgScale: currentRecipe.cfgScale,
        width: currentRecipe.dimensions.width,
        height: currentRecipe.dimensions.height,
        clipSkip: clipSkip,
        additionalNetworks: Object.keys(additionalNetworks).length > 0 ? additionalNetworks : undefined,
      });

      log(`[STEP 5/7]`, `  Job submitted, token: ${genResult.token}. Waiting for completion...`);

      const imageResult = await waitForCivitAIJob(genResult.token);
      imageUrl = imageResult.url;

      // Download and save
      const filepath = await downloadAndSaveImage(imageUrl, `iteration-${attempt}.png`);
      log(`[STEP 5/7]`, `✓ Image generated (${currentRecipe.dimensions.width}x${currentRecipe.dimensions.height}), saved to ${filepath}`);

      // Get base64 for evaluation
      imageBase64 = await downloadImageAsBase64(imageUrl);

      const genDuration = Date.now() - genStart;
      if (attempt === 1) {
        generationPassed = true;
        stepResults.push({
          name: "Generation",
          status: "PASS",
          summary: `Image produced, ${currentRecipe.dimensions.width}x${currentRecipe.dimensions.height}`,
          durationMs: genDuration,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`[STEP 5/7]`, `✗ Generation failed (attempt ${attempt}): ${msg}`);

      if (attempt === 1) {
        stepResults.push({ name: "Generation", status: "FAIL", summary: msg, durationMs: 0 });

        // Log the recipe that was submitted for debugging
        log(`[STEP 5/7]`, `  Recipe submitted: ${JSON.stringify({
          model: currentRecipe.model,
          prompt: currentRecipe.prompt,
          negativePrompt: currentRecipe.negativePrompt,
          sampler: currentRecipe.sampler,
          cfgScale: currentRecipe.cfgScale,
          steps: currentRecipe.steps,
          dimensions: currentRecipe.dimensions,
          loras: currentRecipe.loras,
        }, null, 2)}`);
      }

      // Try next iteration with different seed
      continue;
    }

    // ── Step 6: Evaluate ──
    try {
      const evalStart = Date.now();
      log(`[STEP 6/7]`, `Evaluating with Qwen VL (attempt ${attempt})...`);

      const evalPrompt = `ORIGINAL SCENE INTENT:
${JSON.stringify(intentAnalysis, null, 2)}

CHARACTER DESCRIPTIONS:
- Female: ${FEMALE_DESCRIPTION}
- Male: ${MALE_DESCRIPTION}

GENERATION PROMPT USED:
${currentRecipe.prompt}

Evaluate how well this generated image matches the scene intent. Score each dimension 0-100.`;

      const evalResponse = await analyzeImage(imageBase64!, evalPrompt, {
        systemPrompt: EVALUATION_SYSTEM,
        jsonMode: true,
        maxTokens: 1500,
      });

      const evaluation = parseJsonResponse<{
        scores: EvaluationScores;
        overall: number;
        feedback: string;
        passesThreshold: boolean;
      }>(evalResponse, "image evaluation");

      const evalDuration = Date.now() - evalStart;

      iterationScores.push({
        attempt,
        overall: evaluation.overall,
        scores: evaluation.scores,
        feedback: evaluation.feedback,
      });

      if (evaluation.overall > bestScore) {
        bestScore = evaluation.overall;
        bestIteration = attempt;
      }

      log(`[STEP 6/7]`, `Score: ${evaluation.overall}/100 — ${evaluation.feedback}`);
      log(`[STEP 6/7]`, `  Position/Pose: ${evaluation.scores.positionPose}, CharCount: ${evaluation.scores.characterCount}, Setting: ${evaluation.scores.settingEnvironment}`);
      log(`[STEP 6/7]`, `  Appearance: ${evaluation.scores.characterAppearance}, Lighting: ${evaluation.scores.lightingMood}, Composition: ${evaluation.scores.compositionQuality}`);

      if (attempt === 1) {
        evaluationPassed = true;
        stepResults.push({
          name: "Evaluation",
          status: "PASS",
          summary: `Score: ${evaluation.overall}/100 — ${evaluation.feedback}`,
          durationMs: evalDuration,
        });
      }

      // Check if we pass
      if (evaluation.overall >= PASS_THRESHOLD) {
        log(`[DONE]`, `PASSED threshold (${evaluation.overall} >= ${PASS_THRESHOLD}) after ${attempt} iterations`);
        stepResults.push({
          name: "Iteration",
          status: "PASS",
          summary: `Passed at iteration ${attempt} with score ${evaluation.overall}/100`,
          durationMs: 0,
        });
        break;
      }

      if (attempt >= MAX_ITERATIONS) {
        log(`[DONE]`, `Max iterations reached. Best score: ${bestScore}/100 at iteration ${bestIteration}`);
        stepResults.push({
          name: "Iteration",
          status: bestScore >= 70 ? "PASS" : "FAIL",
          summary: `${totalIterations} iterations, best score ${bestScore}/100 at iteration ${bestIteration}`,
          durationMs: 0,
        });
        break;
      }

      // ── Character count regression detection ──
      const isCharCountFailure = evaluation.scores.characterCount < 50;
      const otherDimensionsOk =
        evaluation.scores.positionPose >= 60 &&
        evaluation.scores.settingEnvironment >= 60 &&
        evaluation.scores.characterAppearance >= 60;

      // Count consecutive char count failures
      let consecutiveCharFails = 0;
      for (let i = iterationScores.length - 1; i >= 0; i--) {
        if (iterationScores[i].scores.characterCount < 50) {
          consecutiveCharFails++;
        } else {
          break;
        }
      }

      if (isCharCountFailure && otherDimensionsOk && consecutiveCharFails < 3) {
        log(`[ITERATION ${attempt + 1}]`, `Character count failure (${evaluation.scores.characterCount}/100) — retrying with new seed only (${consecutiveCharFails}/3 before escalation)`);
        // Don't modify the recipe — just retry with a different seed
        continue;
      }

      if (isCharCountFailure && consecutiveCharFails >= 3) {
        log(`[ITERATION ${attempt + 1}]`, `Character count failed ${consecutiveCharFails}x in a row — escalating to full prompt rewrite`);
      }

      // ── Step 7: Get iteration feedback ──
      log(`[ITERATION ${attempt + 1}]`, "Adjusting recipe based on feedback...");

      const historyDesc = iterationScores.map((s) => ({
        attempt: s.attempt,
        score: s.overall,
        feedback: s.feedback,
        scores: s.scores,
        prompt: currentRecipe.prompt.slice(0, 100),
      }));

      const charCountContext = isCharCountFailure
        ? `\n\nCRITICAL: Character count has failed ${consecutiveCharFails} times in a row. The prompt structure needs a fundamentally different approach to enforce character count.`
        : "";

      const feedbackPrompt = `SCENE INTENT:
${JSON.stringify(intentAnalysis, null, 2)}

CURRENT RECIPE:
${JSON.stringify(currentRecipe, null, 2)}

ATTEMPT HISTORY (${iterationScores.length} attempts so far):
${JSON.stringify(historyDesc, null, 2)}

LATEST EVALUATION:
${JSON.stringify(evaluation, null, 2)}
${charCountContext}
This is attempt ${attempt} of ${MAX_ITERATIONS}. What specific changes should I make for the next attempt?`;

      const feedbackResponse = await analyzeImage(imageBase64!, feedbackPrompt, {
        systemPrompt: ITERATION_FEEDBACK_SYSTEM,
        jsonMode: true,
        maxTokens: 2000,
      });

      const adjustments = parseJsonResponse<{
        diagnosis: string;
        promptChanges: string[];
        loraChanges: Array<{ action: string; name: string; weight: number }>;
        settingChanges: {
          cfgScale: number | null;
          steps: number | null;
          sampler: string | null;
          dimensions: { width: number; height: number } | null;
        };
        newPrompt: string;
        newNegativePrompt: string;
        confidence: number;
        reasoning: string;
      }>(feedbackResponse, "iteration feedback");

      log(`[ITERATION ${attempt + 1}]`, `Diagnosis: ${adjustments.diagnosis}`);
      log(`[ITERATION ${attempt + 1}]`, `Confidence: ${adjustments.confidence}/100`);

      // Apply adjustments
      if (adjustments.newPrompt) currentRecipe.prompt = adjustments.newPrompt;
      if (adjustments.newNegativePrompt) currentRecipe.negativePrompt = adjustments.newNegativePrompt;
      if (adjustments.settingChanges?.cfgScale) currentRecipe.cfgScale = adjustments.settingChanges.cfgScale;
      if (adjustments.settingChanges?.steps) currentRecipe.steps = adjustments.settingChanges.steps;
      if (adjustments.settingChanges?.sampler) currentRecipe.sampler = adjustments.settingChanges.sampler;
      if (adjustments.settingChanges?.dimensions) currentRecipe.dimensions = adjustments.settingChanges.dimensions;

      // Apply LoRA changes
      if (adjustments.loraChanges) {
        for (const change of adjustments.loraChanges) {
          if (change.action === "add") {
            currentRecipe.loras.push({ name: change.name, weight: change.weight });
          } else if (change.action === "remove") {
            currentRecipe.loras = currentRecipe.loras.filter((l) => l.name !== change.name);
          } else if (change.action === "adjust") {
            const lora = currentRecipe.loras.find((l) => l.name === change.name);
            if (lora) lora.weight = change.weight;
          }
        }
      }

      log(`[ITERATION ${attempt + 1}]`, `Updated recipe: CFG ${currentRecipe.cfgScale}, ${currentRecipe.steps} steps, prompt: ${currentRecipe.prompt.slice(0, 80)}...`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`[STEP 6/7]`, `✗ Evaluation/iteration failed (attempt ${attempt}): ${msg}`);

      if (attempt === 1 && !evaluationPassed) {
        stepResults.push({ name: "Evaluation", status: "FAIL", summary: msg, durationMs: 0 });
      }
      // Continue to next iteration
      continue;
    }
  }

  // If no generation or evaluation step was recorded (all attempts failed)
  if (!generationPassed) {
    stepResults.push({ name: "Generation", status: "FAIL", summary: "All generation attempts failed", durationMs: 0 });
  }
  if (!evaluationPassed) {
    stepResults.push({ name: "Evaluation", status: "FAIL", summary: "No evaluations completed", durationMs: 0 });
  }
  if (!stepResults.find((s) => s.name === "Iteration")) {
    stepResults.push({ name: "Iteration", status: "FAIL", summary: "No iterations completed", durationMs: 0 });
  }

  // ── Save and report ──
  log("[DONE]", `Best score: ${bestScore}/100 after ${totalIterations} iterations`);
  log("[DONE]", `Images saved to ${OUTPUT_DIR}/`);

  saveLog();
  generateReport();
}

// ── Report Generator ──

function generateReport(): void {
  const scoreProgression = iterationScores
    .map((s) => `Iteration ${s.attempt}: ${s.overall}/100 — ${s.feedback}`)
    .join("\n");

  const stepResultsFormatted = stepResults
    .map((s) => `- ${s.name}: [${s.status}] — ${s.summary}`)
    .join("\n");

  const report = `## ART DIRECTOR E2E TEST RESULTS

### Configuration
- Qwen VL: Qwen2.5-VL-72B-Instruct-AWQ, max-model-len ${qwenVLMaxModelLen ?? "unknown"}, A100 SXM 80GB
- CivitAI: Generation via Juggernaut XL Ragnarok (fallback URN)

### Step Results
${stepResultsFormatted}

### Score Progression
${scoreProgression || "No scores recorded"}

### Final Result
- Best score: ${bestScore}/100
- Total iterations: ${totalIterations}
- Best image: test-output/iteration-${bestIteration}.png

### Comparison with Old Pipeline
The same cowgirl prompt on the old ComfyUI pipeline produced:
- A solo woman sitting on a bed (no male character, no cowgirl position)

The Art Director produced:
${iterationScores.length > 0
    ? `- Two characters present: ${iterationScores[iterationScores.length - 1]?.scores.characterCount >= 50 ? "yes" : "no"}
- Correct position: ${iterationScores[iterationScores.length - 1]?.scores.positionPose >= 50 ? "partially/yes" : "no"}
- Setting match: ${iterationScores[iterationScores.length - 1]?.scores.settingEnvironment >= 50 ? "yes" : "no"}`
    : "- No images were generated successfully"}

### Issues Encountered
${stepResults.filter((s) => s.status === "FAIL").map((s) => `- ${s.name}: ${s.summary}`).join("\n") || "None"}

### Recommendations
${bestScore >= 90
    ? "- Pipeline is working well for this prompt type. Ready for production testing."
    : bestScore >= 70
      ? `- Score of ${bestScore} is close but below the 90 threshold. Consider:\n  - More aggressive prompt rewriting in iteration feedback\n  - Testing with different reference images\n  - Adjusting CFG for skin tone accuracy`
      : bestScore > 0
        ? `- Score of ${bestScore} indicates significant issues. Investigate:\n  - Whether CivitAI generation model supports the adapted prompt style\n  - Whether the reference selection was appropriate for the scene type\n  - Whether CLIP token budget is being exceeded`
        : "- No successful generations. Check CivitAI API status and model availability."}
`;

  console.log("\n" + report);

  writeFileSync(resolve(OUTPUT_DIR, "test-report.md"), report);
  log("[REPORT]", `Report saved to ${OUTPUT_DIR}/test-report.md`);
}

// ── Run ──
main().catch((err) => {
  console.error("Fatal error:", err);
  saveLog();
  generateReport();
  process.exit(1);
});
