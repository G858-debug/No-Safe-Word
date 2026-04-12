/**
 * In-memory store for successful Art Director recipes.
 *
 * After a generation scores >= 90, we store the final recipe + insights
 * so future jobs with similar intent can use them as few-shot examples.
 *
 * This resets on server restart. Persistence to Supabase is a future task.
 */

import type { ParsedRecipe, IntentAnalysis } from "./types";

// ── Types ──

export interface LearnedRecipe {
  originalPromptIntent: string;
  intentAnalysis: IntentAnalysis;
  finalRecipe: ParsedRecipe;
  finalScore: number;
  iterationCount: number;
  keyInsights: string[];
  timestamp: number;
}

// ── Store ──

const learnedRecipes: LearnedRecipe[] = [];

// ── Public API ──

export function addLearnedRecipe(recipe: LearnedRecipe): void {
  learnedRecipes.push(recipe);
  console.log(
    `[Art Director] Saved learned recipe (${learnedRecipes.length} total): score=${recipe.finalScore}, iterations=${recipe.iterationCount}`
  );
}

/**
 * Find previously successful recipes with similar intent.
 * Uses keyword overlap between intent fields for basic matching.
 */
export function findSimilarLearnedRecipes(
  intent: IntentAnalysis,
  limit: number = 3
): LearnedRecipe[] {
  if (learnedRecipes.length === 0) return [];

  // Build keyword set from the current intent
  const intentKeywords = extractKeywords(intent);

  // Score each learned recipe by keyword overlap
  const scored = learnedRecipes.map((recipe) => {
    const recipeKeywords = extractKeywords(recipe.intentAnalysis);
    let overlap = 0;
    intentKeywords.forEach((kw) => {
      if (recipeKeywords.has(kw)) overlap++;
    });
    // Normalize by the smaller set size to avoid bias toward longer intents
    const minSize = Math.min(intentKeywords.size, recipeKeywords.size);
    const score = minSize > 0 ? overlap / minSize : 0;
    return { recipe, score };
  });

  return scored
    .filter((s) => s.score > 0.2) // At least 20% keyword overlap
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.recipe);
}

export function getLearnedRecipeCount(): number {
  return learnedRecipes.length;
}

// ── Internals ──

function extractKeywords(intent: IntentAnalysis): Set<string> {
  const words = new Set<string>();

  // Interaction type is high signal
  words.add(intent.interactionType);
  words.add(intent.nsfwLevel);

  // Poses
  for (const pose of intent.poses) {
    for (const w of tokenize(pose)) words.add(w);
  }

  // Setting, lighting, mood
  for (const w of tokenize(intent.setting)) words.add(w);
  for (const w of tokenize(intent.lighting)) words.add(w);
  for (const w of tokenize(intent.mood)) words.add(w);

  // Key visual elements
  for (const el of intent.keyVisualElements) {
    for (const w of tokenize(el)) words.add(w);
  }

  // Character count as a feature
  words.add(`count_${intent.characterCount}`);

  // Camera angle
  for (const w of tokenize(intent.cameraAngle)) words.add(w);

  return words;
}

/** Lowercase, split on spaces/punctuation, drop short words */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,;.!?/()]+/)
    .filter((w) => w.length >= 3);
}

/**
 * Format learned recipes as prompt context for Qwen VL.
 */
export function formatLearnedRecipesForPrompt(
  recipes: LearnedRecipe[]
): string {
  if (recipes.length === 0) return "";

  const entries = recipes.map((r, i) => {
    const insights = r.keyInsights.map((ins) => `  - ${ins}`).join("\n");
    return `### Past Success ${i + 1} (Score: ${r.finalScore}/100, ${r.iterationCount} iterations)
Intent: ${r.originalPromptIntent}
Interaction: ${r.intentAnalysis.interactionType}, Characters: ${r.intentAnalysis.characterCount}
Final Prompt: ${r.finalRecipe.prompt}
Model: ${r.finalRecipe.model}
CFG: ${r.finalRecipe.cfgScale}, Steps: ${r.finalRecipe.steps}, Sampler: ${r.finalRecipe.sampler}
LoRAs: ${r.finalRecipe.loras.map((l) => `${l.name}@${l.weight}`).join(", ") || "none"}
Key Insights:
${insights}`;
  });

  return `
## Previously Successful Recipes (from this session)
These are recipes that scored 90+ for similar scenes. Use them as additional reference for what works.

${entries.join("\n\n")}
`;
}
