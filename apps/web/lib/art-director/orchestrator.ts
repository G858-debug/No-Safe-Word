/**
 * Art Director orchestrator — the 8-step flow from story prompt to final image.
 *
 * Step 1: Analyze prompt intent (Qwen VL, text-only)
 * Step 2: Search CivitAI images (3 parallel queries)
 * Step 3: Rank references with Qwen VL (multi-image vision)
 * Step 4: User selects a reference (via API)
 * Step 5: Adapt recipe (Qwen VL)
 * Step 6: Generate via CivitAI
 * Step 7: Evaluate result (Qwen VL)
 * Step 8: Iterate if needed (max 8 attempts)
 */

import { supabase } from "@no-safe-word/story-engine";
import {
  analyzeText,
  analyzeImage,
  analyzeMultipleImages,
  parseJsonResponse,
  ensureArray,
} from "./qwen-vl-client";
import {
  searchMultipleQueries,
  downloadImageAsBase64,
  parseImageMetadata,
  generateViaCivitAI,
  waitForCivitAIJob,
} from "./civitai-client";
import {
  INTENT_ANALYSIS_SYSTEM,
  REFERENCE_RANKING_SYSTEM,
  EVALUATION_SYSTEM,
  ITERATION_FEEDBACK_SYSTEM,
  buildRecipeAdaptationPrompt,
} from "./prompts";
import {
  addLearnedRecipe,
  findSimilarLearnedRecipes,
  formatLearnedRecipesForPrompt,
} from "./learned-recipes";
import type {
  ArtDirectorJob,
  ArtDirectorJobStatus,
  IntentAnalysis,
  RankedReference,
  ParsedRecipe,
  IterationResult,
  EvaluationScores,
} from "./types";

// ── Constants ──

const MAX_ITERATIONS = 4;
const PASS_THRESHOLD = 80;
const MAX_REFERENCES = 5;

// ── Database Helpers ──

async function createJob(
  promptId: string,
  seriesId: string
): Promise<string> {
  const { data, error } = await supabase
    .from("art_director_jobs")
    .insert({
      prompt_id: promptId,
      series_id: seriesId,
      status: "analyzing",
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create art director job: ${error.message}`);
  return data.id;
}

async function updateJob(
  jobId: string,
  updates: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from("art_director_jobs")
    .update(updates as any)
    .eq("id", jobId);

  if (error) throw new Error(`Failed to update art director job: ${error.message}`);
}

export async function getJob(jobId: string): Promise<ArtDirectorJob> {
  const { data, error } = await supabase
    .from("art_director_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (error || !data) throw new Error(`Art director job ${jobId} not found`);

  return {
    id: data.id,
    promptId: data.prompt_id,
    seriesId: data.series_id,
    status: data.status as ArtDirectorJobStatus,
    intentAnalysis: data.intent_analysis as unknown as IntentAnalysis | null,
    referenceImages: (data.reference_images as unknown as RankedReference[]) || [],
    selectedReferenceId: data.selected_reference_id,
    adaptedRecipe: data.adapted_recipe as unknown as ParsedRecipe | null,
    iterations: (data.iterations as unknown as IterationResult[]) || [],
    currentIteration: data.current_iteration,
    bestIteration: data.best_iteration,
    bestScore: data.best_score ? Number(data.best_score) : null,
    finalImageUrl: data.final_image_url,
    finalImageId: data.final_image_id,
    error: data.error,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

// ── Step 1-3: Analyze & Search & Rank ──

export interface CharacterDataForArtDirector {
  name: string;
  structured: Record<string, string> | null;
  portraitUrl: string | null;
}

export async function analyzeAndSearch(
  promptText: string,
  imageType: string,
  characterNames: string[],
  seriesId: string,
  promptId: string,
  characterData?: CharacterDataForArtDirector[]
): Promise<{
  jobId: string;
  intentAnalysis: IntentAnalysis;
  rankedReferences: RankedReference[];
}> {
  // Create the job
  const jobId = await createJob(promptId, seriesId);
  console.log(`[Art Director] Created job ${jobId} for prompt ${promptId}`);

  try {
    // ── Step 1: Analyze prompt intent ──
    console.log(`[Art Director] Step 1: Analyzing prompt intent...`);

    // Build character context from real data if available
    let characterContext = `Characters mentioned: ${characterNames.join(", ") || "none specified"}`;
    if (characterData && characterData.length > 0) {
      const charDescs = characterData.map((c) => {
        const parts = [c.name];
        if (c.structured) {
          const s = c.structured;
          if (s.skinTone) parts.push(`skin: ${s.skinTone}`);
          if (s.bodyType) parts.push(`body: ${s.bodyType}`);
          if (s.hairColor || s.hairStyle) parts.push(`hair: ${[s.hairColor, s.hairStyle].filter(Boolean).join(" ")}`);
          if (s.ethnicity) parts.push(`ethnicity: ${s.ethnicity}`);
          if (s.age) parts.push(`age: ${s.age}`);
        }
        return parts.join(", ");
      });
      characterContext = `Characters (with approved appearance data):\n${charDescs.join("\n")}`;
    }

    const intentPrompt = `Scene description: "${promptText}"
${characterContext}
Image type: ${imageType}

Analyze this scene and return the structured intent JSON.`;

    const intentResponse = await analyzeText(intentPrompt, {
      systemPrompt: INTENT_ANALYSIS_SYSTEM,
      jsonMode: true,
      maxTokens: 2048,
    });

    const intentAnalysis = parseJsonResponse<IntentAnalysis>(intentResponse, "intent analysis");
    console.log(`[Art Director] Intent: ${intentAnalysis.interactionType}, ${intentAnalysis.nsfwLevel}, queries: ${intentAnalysis.searchQueries.join(" | ")}`);

    // Store intent analysis + character data (portrait URLs for evaluation)
    const intentWithCharData = {
      ...intentAnalysis,
      _characterData: characterData || [],
    };
    await updateJob(jobId, { intent_analysis: intentWithCharData });

    // ── Step 2: Search CivitAI ──
    console.log(`[Art Director] Step 2: Searching CivitAI with ${intentAnalysis.searchQueries.length} queries...`);

    const isNsfw = intentAnalysis.nsfwLevel === "nsfw" || intentAnalysis.nsfwLevel === "explicit";
    const allResults = await searchMultipleQueries(intentAnalysis.searchQueries, {
      nsfw: isNsfw,
      sort: "Most Reactions",
      period: "AllTime",
      limit: 10,
    });

    // Filter to images that have generation metadata (we need the recipe)
    const withMeta = allResults.filter((r) => r.meta && r.meta.prompt);
    console.log(`[Art Director] Found ${allResults.length} images, ${withMeta.length} with metadata`);

    if (withMeta.length === 0) {
      await updateJob(jobId, {
        status: "awaiting_selection",
        reference_images: [],
      });
      return { jobId, intentAnalysis, rankedReferences: [] };
    }

    // Take top 5 for ranking (Qwen VL limit is 5 images per request)
    const candidates = withMeta.slice(0, 5);

    // ── Step 3: Rank references with Qwen VL ──
    console.log(`[Art Director] Step 3: Ranking ${candidates.length} references with Qwen VL...`);

    // Download images for vision analysis
    const imageInputs = [];
    for (let i = 0; i < candidates.length; i++) {
      try {
        const base64 = await downloadImageAsBase64(candidates[i].url);
        imageInputs.push({
          url: base64,
          label: `Image ${i}: ${candidates[i].meta?.prompt?.slice(0, 80) || "no prompt"}`,
        });
      } catch (err) {
        console.warn(`[Art Director] Failed to download image ${candidates[i].id}:`, err);
      }
    }

    let rankedReferences: RankedReference[] = [];

    if (imageInputs.length > 0) {
      const rankingPrompt = `Scene intent: ${JSON.stringify(intentAnalysis)}

I'm showing you ${imageInputs.length} candidate reference images. Rank them by how well their composition, pose, and mood match the intended scene. Return the JSON array as specified.`;

      const rankResponse = await analyzeMultipleImages(imageInputs, rankingPrompt, {
        systemPrompt: REFERENCE_RANKING_SYSTEM,
        jsonMode: true,
        maxTokens: 3000,
      });

      const rawRankings = parseJsonResponse<unknown>(rankResponse, "reference ranking");

      // Qwen VL sometimes returns a single object instead of an array — normalize
      const rankings = ensureArray(rawRankings) as Array<{
        imageIndex: number;
        rank: number;
        relevanceScore: number;
        whatMatches: string;
        whatDoesnt: string;
        explanation: string;
      }>;

      // Build ranked references
      rankedReferences = rankings
        .filter((r) => r.imageIndex >= 0 && r.imageIndex < candidates.length)
        .slice(0, MAX_REFERENCES)
        .map((r) => {
          const candidate = candidates[r.imageIndex];
          return {
            id: candidate.id,
            url: candidate.url,
            recipe: parseImageMetadata(candidate.meta),
            rank: r.rank,
            explanation: r.explanation,
            whatMatches: r.whatMatches,
            whatDoesnt: r.whatDoesnt,
            relevanceScore: r.relevanceScore,
          };
        });
    }

    console.log(`[Art Director] Ranked ${rankedReferences.length} references`);

    await updateJob(jobId, {
      status: "awaiting_selection",
      reference_images: rankedReferences,
    });

    return { jobId, intentAnalysis, rankedReferences };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    console.error(`[Art Director] Analysis failed:`, err);
    await updateJob(jobId, { status: "failed", error: message });
    throw err;
  }
}

// ── Step 4: User Selection ──

export async function selectReference(
  jobId: string,
  referenceId: number
): Promise<void> {
  const job = await getJob(jobId);

  if (job.status !== "awaiting_selection") {
    throw new Error(`Job ${jobId} is in state ${job.status}, expected awaiting_selection`);
  }

  const ref = job.referenceImages.find((r) => r.id === referenceId);
  if (!ref) {
    throw new Error(`Reference ${referenceId} not found in job ${jobId}`);
  }

  await updateJob(jobId, {
    selected_reference_id: referenceId,
    status: "generating",
  });

  console.log(`[Art Director] Reference ${referenceId} selected for job ${jobId}`);
}

// ── Step 5: Adapt Recipe ──

export async function adaptRecipe(jobId: string): Promise<ParsedRecipe> {
  const job = await getJob(jobId);
  if (!job.selectedReferenceId || !job.intentAnalysis) {
    throw new Error("Job missing selected reference or intent analysis");
  }

  const selectedRef = job.referenceImages.find(
    (r) => r.id === job.selectedReferenceId
  );
  if (!selectedRef) throw new Error("Selected reference not found");

  console.log(`[Art Director] Step 5: Adapting recipe from reference ${selectedRef.id}...`);

  // Fetch character descriptions from the intent analysis
  const characterDescs = job.intentAnalysis.characters
    .map((c) => `${c.name}: ${c.physicalDescription}`)
    .join("\n");

  // Download the reference image for Qwen VL
  const refImageBase64 = await downloadImageAsBase64(selectedRef.url);

  // Build contextual system prompt with model-specific knowledge
  const referenceModelName = selectedRef.recipe.model;
  const adaptationSystemPrompt = buildRecipeAdaptationPrompt(referenceModelName);

  // Check for similar learned recipes to inject as additional few-shot examples
  const similarRecipes = findSimilarLearnedRecipes(job.intentAnalysis, 2);
  const learnedRecipeContext = formatLearnedRecipesForPrompt(similarRecipes);
  if (similarRecipes.length > 0) {
    console.log(`[Art Director] Found ${similarRecipes.length} similar learned recipes to inject`);
  }

  const adaptPrompt = `REFERENCE IMAGE RECIPE:
${JSON.stringify(selectedRef.recipe, null, 2)}

TARGET SCENE:
${JSON.stringify(job.intentAnalysis, null, 2)}

CHARACTER DESCRIPTIONS:
${characterDescs || "No specific characters — use the scene description."}
${learnedRecipeContext}
Adapt the reference recipe for our target scene. Keep what makes the reference look good, change what needs to match our scene.`;

  const response = await analyzeImage(refImageBase64, adaptPrompt, {
    systemPrompt: adaptationSystemPrompt,
    jsonMode: true,
    maxTokens: 3000,
  });

  const adaptedRecipe = parseJsonResponse<ParsedRecipe>(response, "recipe adaptation");
  console.log(`[Art Director] Adapted recipe: model=${adaptedRecipe.model}, prompt=${adaptedRecipe.prompt.slice(0, 80)}...`);

  await updateJob(jobId, { adapted_recipe: adaptedRecipe });

  return adaptedRecipe;
}

// ── Steps 6-8: Generate & Evaluate & Iterate ──

/**
 * Run a single generation-evaluation cycle.
 * Returns the iteration result.
 */
export async function runIteration(jobId: string): Promise<IterationResult> {
  const job = await getJob(jobId);
  if (!job.adaptedRecipe) {
    throw new Error("No adapted recipe — call adaptRecipe first");
  }

  const attempt = job.currentIteration + 1;
  console.log(`[Art Director] Step 6: Generation attempt ${attempt}/${MAX_ITERATIONS}...`);

  // Determine which recipe to use — base adapted or modified by previous feedback
  let recipe = { ...job.adaptedRecipe };
  const lastIteration = job.iterations[job.iterations.length - 1];
  if (lastIteration?.recipeAdjustments) {
    try {
      const adjustments = JSON.parse(lastIteration.recipeAdjustments);
      if (adjustments.newPrompt) recipe.prompt = adjustments.newPrompt;
      if (adjustments.newNegativePrompt) recipe.negativePrompt = adjustments.newNegativePrompt;
      if (adjustments.settingChanges?.cfgScale) recipe.cfgScale = adjustments.settingChanges.cfgScale;
      if (adjustments.settingChanges?.steps) recipe.steps = adjustments.settingChanges.steps;
      if (adjustments.settingChanges?.sampler) recipe.sampler = adjustments.settingChanges.sampler;
      if (adjustments.settingChanges?.dimensions) recipe.dimensions = adjustments.settingChanges.dimensions;

      // Apply LoRA changes
      if (adjustments.loraChanges) {
        for (const change of adjustments.loraChanges) {
          if (change.action === "add") {
            recipe.loras.push({ name: change.name, weight: change.weight });
          } else if (change.action === "remove") {
            recipe.loras = recipe.loras.filter((l) => l.name !== change.name);
          } else if (change.action === "adjust") {
            const lora = recipe.loras.find((l) => l.name === change.name);
            if (lora) lora.weight = change.weight;
          }
        }
      }
    } catch {
      console.warn(`[Art Director] Failed to parse recipe adjustments, using base recipe`);
    }
  }

  // Create the iteration record
  const iteration: IterationResult = {
    attempt,
    civitaiToken: null,
    imageUrl: null,
    recipe: recipe,
    evaluation: null,
    recipeAdjustments: null,
    status: "generating",
  };

  const updatedIterations = [...job.iterations, iteration];
  await updateJob(jobId, {
    iterations: updatedIterations,
    current_iteration: attempt,
  });

  try {
    // ── Step 6: Generate via CivitAI ──
    // Build the model URN — for now use Juggernaut XL as default if recipe model isn't a URN
    let modelUrn = recipe.model || "";
    if (!modelUrn.startsWith("urn:air:")) {
      // Default to Juggernaut XL Ragnarok
      modelUrn = "urn:air:sdxl:checkpoint:civitai:133005@357609";
    }

    // Build additional networks for LoRAs
    const additionalNetworks: Record<string, { type: string; strength: number }> = {};
    for (const lora of recipe.loras) {
      // Try to find a CivitAI URN for the LoRA name — for now skip non-URN LoRAs
      // CivitAI generation only works with their model IDs
      if (lora.name.startsWith("urn:air:")) {
        additionalNetworks[lora.name] = { type: "Lora", strength: lora.weight };
      }
    }

    const genResult = await generateViaCivitAI({
      model: modelUrn,
      prompt: recipe.prompt,
      negativePrompt: recipe.negativePrompt,
      scheduler: recipe.sampler,
      steps: recipe.steps,
      cfgScale: recipe.cfgScale,
      width: recipe.dimensions.width,
      height: recipe.dimensions.height,
      clipSkip: recipe.clipSkip,
      additionalNetworks: Object.keys(additionalNetworks).length > 0 ? additionalNetworks : undefined,
    });

    iteration.civitaiToken = genResult.token;
    iteration.status = "generating";

    // Update with token
    updatedIterations[updatedIterations.length - 1] = iteration;
    await updateJob(jobId, { iterations: updatedIterations });

    // Wait for generation
    const imageResult = await waitForCivitAIJob(genResult.token);
    iteration.imageUrl = imageResult.url;
    iteration.status = "evaluating";

    updatedIterations[updatedIterations.length - 1] = iteration;
    await updateJob(jobId, { iterations: updatedIterations });

    // ── Step 7: Evaluate ──
    console.log(`[Art Director] Step 7: Evaluating attempt ${attempt}...`);

    const imageBase64 = await downloadImageAsBase64(imageResult.url);
    // NOTE: Do NOT store imageBase64 on the iteration object — it's ~5MB and
    // blows up the Supabase JSONB column when we persist iterations.

    // Build character portrait context for evaluation
    const charData = (job.intentAnalysis as any)?._characterData as CharacterDataForArtDirector[] | undefined;
    const charPortraitContext = charData?.filter((c) => c.portraitUrl).length
      ? `\n\nCHARACTER REFERENCE PORTRAITS: The following characters have approved portraits that the generated image should match for appearance consistency: ${charData.filter((c) => c.portraitUrl).map((c) => c.name).join(", ")}`
      : "";

    const evalPrompt = `ORIGINAL SCENE INTENT:
${JSON.stringify(job.intentAnalysis, null, 2)}

GENERATION PROMPT USED:
${recipe.prompt}
${charPortraitContext}
Evaluate how well this generated image matches the scene intent. Score each dimension 0-100.`;

    // If character portraits are available, use multi-image evaluation for appearance comparison
    let evalResponse: { content: string };
    const portraitChars = charData?.filter((c) => c.portraitUrl) || [];
    if (portraitChars.length > 0) {
      const evalImages = [
        { label: "Generated Image", base64OrUrl: imageBase64 },
        ...await Promise.all(
          portraitChars.map(async (c) => ({
            label: `${c.name} Reference Portrait`,
            base64OrUrl: await downloadImageAsBase64(c.portraitUrl!),
          }))
        ),
      ];
      evalResponse = await analyzeMultipleImages(evalImages, evalPrompt, {
        systemPrompt: EVALUATION_SYSTEM,
        jsonMode: true,
        maxTokens: 1500,
      });
    } else {
      evalResponse = await analyzeImage(imageBase64, evalPrompt, {
        systemPrompt: EVALUATION_SYSTEM,
        jsonMode: true,
        maxTokens: 1500,
      });
    }

    const evaluation = parseJsonResponse<{
      scores: EvaluationScores;
      overall: number;
      feedback: string;
      passesThreshold: boolean;
    }>(evalResponse, "image evaluation");

    iteration.evaluation = evaluation;
    iteration.status = evaluation.passesThreshold ? "completed" : "completed";

    // Track best iteration
    let bestIteration = job.bestIteration;
    let bestScore = job.bestScore;
    if (!bestScore || evaluation.overall > bestScore) {
      bestIteration = attempt - 1; // 0-indexed
      bestScore = evaluation.overall;
    }

    console.log(`[Art Director] Attempt ${attempt} scored ${evaluation.overall}/100 (best: ${bestScore})`);

    updatedIterations[updatedIterations.length - 1] = iteration;
    await updateJob(jobId, {
      iterations: updatedIterations,
      best_iteration: bestIteration,
      best_score: bestScore,
    });

    // ── Step 8: Iterate if needed ──
    if (evaluation.overall >= PASS_THRESHOLD) {
      console.log(`[Art Director] PASSED threshold (${evaluation.overall} >= ${PASS_THRESHOLD})`);

      // Save as a learned recipe for future jobs
      if (job.intentAnalysis && iteration.recipe) {
        const keyInsights: string[] = [];
        if (attempt > 1) {
          keyInsights.push(`Required ${attempt} iterations to pass`);
          // Extract insights from iteration history
          for (const iter of updatedIterations) {
            if (iter.evaluation && iter.evaluation.overall < PASS_THRESHOLD) {
              const worst = Object.entries(iter.evaluation.scores).sort(
                ([, a], [, b]) => (a as number) - (b as number)
              )[0];
              if (worst) keyInsights.push(`Early failure: ${worst[0]} scored ${worst[1]}`);
            }
          }
        }
        keyInsights.push(`Model: ${iteration.recipe.model}, CFG: ${iteration.recipe.cfgScale}`);
        keyInsights.push(`LoRA count: ${iteration.recipe.loras.length}`);

        addLearnedRecipe({
          originalPromptIntent: JSON.stringify(job.intentAnalysis),
          intentAnalysis: job.intentAnalysis,
          finalRecipe: iteration.recipe,
          finalScore: evaluation.overall,
          iterationCount: attempt,
          keyInsights,
          timestamp: Date.now(),
        });
      }

      await updateJob(jobId, {
        status: "completed",
        final_image_url: iteration.imageUrl,
      });
      return iteration;
    }

    if (attempt >= MAX_ITERATIONS) {
      console.log(`[Art Director] Max iterations reached. Best score: ${bestScore}`);
      // Use best iteration's image
      const bestIter = updatedIterations[bestIteration ?? 0];
      await updateJob(jobId, {
        status: "completed",
        final_image_url: bestIter?.imageUrl || iteration.imageUrl,
      });
      return iteration;
    }

    // ── Character count regression detection ──
    // Wrong character count is a stochastic SDXL failure, not a prompt problem.
    // Retrying with a new seed (same recipe) is more effective than rewriting the prompt.
    const isCharCountFailure = evaluation.scores.characterCount < 50;
    const otherDimensionsOk =
      evaluation.scores.positionPose >= 60 &&
      evaluation.scores.settingEnvironment >= 60 &&
      evaluation.scores.characterAppearance >= 60;

    // Count consecutive character count failures
    let consecutiveCharCountFailures = 0;
    for (let i = updatedIterations.length - 1; i >= 0; i--) {
      if (updatedIterations[i].evaluation?.scores.characterCount != null &&
          updatedIterations[i].evaluation!.scores.characterCount < 50) {
        consecutiveCharCountFailures++;
      } else {
        break;
      }
    }

    if (isCharCountFailure && otherDimensionsOk && consecutiveCharCountFailures < 3) {
      // Seed-only retry — don't waste an iteration on prompt changes
      console.log(
        `[Art Director] Character count failure (${evaluation.scores.characterCount}/100) — ` +
        `retrying with new seed (attempt ${consecutiveCharCountFailures}/3 before escalation)`
      );

      // Store a minimal "adjustment" that signals seed-only retry
      iteration.recipeAdjustments = JSON.stringify({
        diagnosis: "Character count failure — stochastic SDXL issue, not a prompt problem",
        promptChanges: [],
        loraChanges: [],
        settingChanges: { cfgScale: null, steps: null, sampler: null, dimensions: null },
        newPrompt: null,
        newNegativePrompt: null,
        confidence: 70,
        reasoning: "Wrong character count is random SDXL failure. Same recipe with new seed.",
      });

      updatedIterations[updatedIterations.length - 1] = iteration;
      await updateJob(jobId, { iterations: updatedIterations });

      return iteration;
    }

    if (isCharCountFailure && consecutiveCharCountFailures >= 3) {
      console.log(
        `[Art Director] Character count failed ${consecutiveCharCountFailures}x in a row — escalating to full prompt rewrite`
      );
    }

    // Get iteration feedback from Qwen VL
    console.log(`[Art Director] Step 8: Getting iteration feedback...`);

    const historyDesc = updatedIterations.map((iter) => ({
      attempt: iter.attempt,
      score: iter.evaluation?.overall ?? 0,
      feedback: iter.evaluation?.feedback ?? "no evaluation",
      scores: iter.evaluation?.scores ?? null,
      prompt: iter.recipe?.prompt?.slice(0, 100) ?? "",
    }));

    // Add character count context to the feedback prompt if relevant
    const charCountContext = isCharCountFailure
      ? `\n\nCRITICAL: Character count has failed ${consecutiveCharCountFailures} times in a row. Seed-only retries didn't work. The prompt structure needs a fundamentally different approach to enforce character count — consider different character count tags, splitting the prompt, or a different composition strategy entirely.`
      : "";

    const feedbackPrompt = `SCENE INTENT:
${JSON.stringify(job.intentAnalysis, null, 2)}

CURRENT RECIPE:
${JSON.stringify(recipe, null, 2)}

ATTEMPT HISTORY (${updatedIterations.length} attempts so far):
${JSON.stringify(historyDesc, null, 2)}

LATEST EVALUATION:
${JSON.stringify(evaluation, null, 2)}
${charCountContext}
This is attempt ${attempt} of ${MAX_ITERATIONS}. What specific changes should I make for the next attempt?`;

    const feedbackResponse = await analyzeImage(imageBase64, feedbackPrompt, {
      systemPrompt: ITERATION_FEEDBACK_SYSTEM,
      jsonMode: true,
      maxTokens: 2000,
    });

    iteration.recipeAdjustments = feedbackResponse.content;
    updatedIterations[updatedIterations.length - 1] = iteration;
    await updateJob(jobId, { iterations: updatedIterations });

    return iteration;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed";
    console.error(`[Art Director] Attempt ${attempt} failed:`, err);

    iteration.status = "failed";
    iteration.error = message;
    updatedIterations[updatedIterations.length - 1] = iteration;
    await updateJob(jobId, { iterations: updatedIterations });

    // If all iterations exhausted due to failures, mark job as failed
    if (attempt >= MAX_ITERATIONS) {
      await updateJob(jobId, { status: "failed", error: message });
    }

    return iteration;
  }
}

// ── Approval ──

/**
 * Approve a specific iteration's image as the final result.
 * Stores the image to Supabase and links it to the story_image_prompts record.
 */
export async function approveIteration(
  jobId: string,
  iterationIndex?: number
): Promise<{ imageUrl: string }> {
  const job = await getJob(jobId);

  // Use specified iteration or best iteration
  const index = iterationIndex ?? job.bestIteration ?? 0;
  const iteration = job.iterations[index];

  if (!iteration?.imageUrl) {
    throw new Error(`Iteration ${index} has no image URL`);
  }

  // Download the image and store it in Supabase Storage
  const imageRes = await fetch(iteration.imageUrl);
  if (!imageRes.ok) throw new Error(`Failed to download final image`);
  const imageBuffer = Buffer.from(await imageRes.arrayBuffer());

  const filename = `art-director-${job.promptId}-${Date.now()}.jpeg`;
  const { error: uploadError } = await supabase.storage
    .from("story-images")
    .upload(filename, imageBuffer, {
      contentType: "image/jpeg",
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Failed to upload image: ${uploadError.message}`);
  }

  const { data: urlData } = supabase.storage.from("story-images").getPublicUrl(filename);
  const storedUrl = urlData.publicUrl;

  // Determine SFW/NSFW mode from the image prompt record
  const { data: promptRecord } = await supabase
    .from("story_image_prompts")
    .select("image_type")
    .eq("id", job.promptId)
    .single();

  const imageMode = promptRecord?.image_type === "facebook_sfw" ? "sfw" : "nsfw";

  // Create an image record
  const { data: imageRecord, error: imageError } = await supabase
    .from("images")
    .insert({
      prompt: iteration.recipe?.prompt || "art director generated",
      stored_url: storedUrl,
      mode: imageMode,
      settings: {
        source: "art_director",
        art_director_job_id: jobId,
        iteration: iteration.attempt,
        score: iteration.evaluation?.overall,
        recipe: iteration.recipe,
      } as any,
    })
    .select("id")
    .single();

  if (imageError) throw new Error(`Failed to create image record: ${imageError.message}`);

  // Update the story_image_prompts record — set to "approved" since user explicitly
  // approved in the Art Director modal (no need for a second approval step)
  const { error: promptError } = await supabase
    .from("story_image_prompts")
    .update({
      image_id: imageRecord!.id,
      status: "approved" as any,
    })
    .eq("id", job.promptId);

  if (promptError) {
    console.error(`[Art Director] Failed to update prompt record:`, promptError);
  }

  // Update the art director job
  await updateJob(jobId, {
    status: "completed",
    final_image_url: storedUrl,
    final_image_id: imageRecord!.id,
  });

  console.log(`[Art Director] Approved iteration ${index} for job ${jobId}`);

  return { imageUrl: storedUrl };
}

/**
 * Cancel an art director job.
 */
export async function cancelJob(jobId: string): Promise<void> {
  await updateJob(jobId, { status: "cancelled" });
  console.log(`[Art Director] Cancelled job ${jobId}`);
}
