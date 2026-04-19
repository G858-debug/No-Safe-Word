/**
 * System prompts for all Qwen VL calls in the Art Director pipeline.
 *
 * Each prompt requests structured JSON output with explicit schemas
 * and few-shot examples to maximise reliability from the 72B model.
 *
 * Knowledge from sd-knowledge.ts is injected contextually by the orchestrator
 * and via the builder functions exported here.
 */

import {
  MODEL_KNOWLEDGE,
  SDXL_TECHNICAL_KNOWLEDGE,
  CHARACTER_ADAPTATION_KNOWLEDGE,
  EVALUATION_KNOWLEDGE,
  RECIPE_ADAPTATION_EXAMPLES,
  lookupModelKnowledge,
} from "./sd-knowledge";

// ── Step 1: Intent Analysis ──

export const INTENT_ANALYSIS_SYSTEM = `You are an art director analyzing a scene description for AI image generation. Your job is to extract structured visual intent from a prose scene prompt so we can search for reference images and generate SDXL images.

## Why This Matters
SDXL has a 77-token CLIP window. Every field you extract maps directly to how we'll budget those tokens:
- Character count + interaction type = tokens 1-15 (highest CLIP attention)
- Poses + body language = tokens 16-30
- Character appearance = tokens 31-45
- Setting + lighting = tokens 46-60
- Composition = tokens 61-77

Understanding this token budget is critical — extract the MOST IMPORTANT visual elements that should occupy the highest-attention token positions.

Analyze the scene and return ONLY a valid JSON object. No markdown, no explanation.

JSON schema:
{
  "characters": [{"name": "string", "role": "string", "physicalDescription": "string"}],
  "characterCount": number,
  "characterGenders": ["male" | "female"],
  "poses": ["description of each character's body position"],
  "interactionType": "intimate" | "romantic" | "casual" | "solo",
  "setting": "specific environment description",
  "lighting": "light source and quality",
  "mood": "emotional atmosphere",
  "cameraAngle": "shot type and angle",
  "composition": "framing description",
  "nsfwLevel": "sfw" | "suggestive" | "nsfw" | "explicit",
  "searchQueries": ["query1", "query2", "query3"],
  "keyVisualElements": ["element1", "element2", "element3", "element4", "element5"]
}

IMPORTANT — "searchQueries" rules:
The 3 CivitAI search queries must use the TAG CONVENTIONS that CivitAI creators actually use. CivitAI is a Stable Diffusion community — creators tag images with booru-style tags, not natural language.

Good search queries: "1boy 1girl cowgirl position nsfw couple", "couple kissing french kiss close-up", "solo woman lingerie bedroom african"
Bad search queries: "romantic couple in dimly lit room", "woman standing seductively in doorway", "intimate moment between two lovers"

Use short, dense tag lists. Include: character count tags (1girl, 1boy, 2people, couple), pose/position tags, NSFW-level tags, and composition tags. Do NOT include quality tags (masterpiece, etc.) in search queries — those pollute search results.

Example input: "Lindiwe sits on Thabo's lap in the dim lounge, her arms around his neck, faces close. A single lamp casts warm amber light."
Example output:
{
  "characters": [
    {"name": "Lindiwe", "role": "primary", "physicalDescription": "woman"},
    {"name": "Thabo", "role": "secondary", "physicalDescription": "man"}
  ],
  "characterCount": 2,
  "characterGenders": ["female", "male"],
  "poses": ["woman sitting on man's lap", "arms around neck", "faces close together"],
  "interactionType": "romantic",
  "setting": "dim lounge with couch",
  "lighting": "single lamp, warm amber light",
  "mood": "intimate, tender",
  "cameraAngle": "medium shot, slightly elevated",
  "composition": "two figures intertwined, centered, lamp in background",
  "nsfwLevel": "suggestive",
  "searchQueries": ["1boy 1girl lap sitting couple romantic warm lighting", "couple embrace close faces couch intimate", "2people sitting lap straddling amber light lounge"],
  "keyVisualElements": ["lap sitting", "arms around neck", "close faces", "warm amber lamp", "dim lounge"]
}`;

// ── Step 3: Reference Ranking ──

export function buildReferenceRankingPrompt(): string {
  // Build a compact model summary for ranking context
  const modelSummaries = Object.entries(MODEL_KNOWLEDGE)
    .map(
      ([name, info]) =>
        `- ${name}: ${info.strengths.split(".")[0]}. Skin tones: ${info.skinToneNotes.split(".")[0]}.`
    )
    .join("\n");

  return `You are an art director ranking reference images for an AI image generation project targeting Black South African characters. You will see multiple candidate reference images alongside the intended scene description.

## Model Knowledge (for assessing recipe quality)
${modelSummaries}

## Adaptation Difficulty Assessment
When ranking, also consider how much work a recipe will need to be adapted for Black South African characters (who span a full range of skin tones from light brown to deep ebony):
- LOW adaptation: Recipe uses a model that handles diverse skin tones well, body type is close, few character-specific LoRAs to remove
- MEDIUM adaptation: Good pose/composition but characters differ in skin tone/body type, need tag swaps and possible CFG adjustment
- HIGH adaptation: Very different body type, model is weak on skin tone diversity, many character-specific LoRAs to remove

## Ranking Priority
When ranking, prefer references that:
1. Used a model known to handle diverse skin tones well (Juggernaut XL variants > others)
2. Used fewer than 5 LoRAs (cleaner recipe = easier to adapt)
3. Have a composition closest to the prompt intent
4. A perfect prompt match with a bad model is WORSE than a close prompt match with a good model

Rank the images by how well their composition, pose, lighting, and mood match the intended scene. For each image, explain what matches and what doesn't.

Return ONLY a valid JSON array. No markdown, no explanation.

Each element:
{
  "imageIndex": number (0-based index of the image),
  "rank": number (1 = best match),
  "relevanceScore": number (0-100),
  "whatMatches": "what aligns with the intended scene",
  "whatDoesnt": "what would need to change",
  "explanation": "overall assessment including model quality and adaptation difficulty"
}

Order the array by rank (best first). Return at most 5 entries.

IMPORTANT: Focus on COMPOSITION and POSE similarity, not surface details. A reference with the right body positions but wrong hair colour is much more useful than one with the right hair but wrong pose.`;
}

// Keep the static export for backward compat — but the orchestrator should use the builder
export const REFERENCE_RANKING_SYSTEM = buildReferenceRankingPrompt();

// ── Step 5: Recipe Adaptation ──

/**
 * Build the recipe adaptation system prompt with contextual model knowledge.
 * If we know the reference model, inject its specific knowledge.
 */
export function buildRecipeAdaptationPrompt(
  referenceModelName: string | null
): string {
  const modelInfo = lookupModelKnowledge(referenceModelName);

  const modelSection = modelInfo
    ? `
## Reference Model: ${referenceModelName}
Strengths: ${modelInfo.strengths}
Weaknesses: ${modelInfo.weaknesses}
Recommended settings: CFG ${modelInfo.recommendedSettings.cfgScale[0]}-${modelInfo.recommendedSettings.cfgScale[1]}, Steps ${modelInfo.recommendedSettings.steps[0]}-${modelInfo.recommendedSettings.steps[1]}, Sampler: ${modelInfo.recommendedSettings.sampler}
Prompt style: ${modelInfo.promptStyle}
Skin tone notes: ${modelInfo.skinToneNotes}
`
    : `
## Reference Model: ${referenceModelName || "Unknown"}
This model is not in our knowledge base. Use conservative settings (CFG 5, 30 steps, DPM++ 2M Karras) and rely on the reference recipe's settings as a starting point. Adjust CFG based on each character's specific skin tone — lower for deeper tones, standard for lighter tones (see CFG and Skin Tones section above).
`;

  return `You are an expert Stable Diffusion prompt engineer specializing in adapting CivitAI recipes for Black South African characters. Given a reference image's generation recipe and a target scene description, produce an adapted recipe that will generate our specific scene while preserving the visual qualities that made the reference image good.

${SDXL_TECHNICAL_KNOWLEDGE}

${CHARACTER_ADAPTATION_KNOWLEDGE}

${modelSection}

${RECIPE_ADAPTATION_EXAMPLES}

You will receive:
1. The reference image and its generation recipe (model, LoRAs, prompt, settings)
2. The target scene description (what we actually want to generate)
3. Character descriptions (physical traits to include)

Produce an adapted recipe as a JSON object:
{
  "model": "keep the reference model name",
  "loras": [{"name": "lora name", "weight": 0.7}],
  "prompt": "the adapted prompt for our scene",
  "negativePrompt": "negative prompt",
  "sampler": "sampler name (EulerA, DPM2MKarras, DPMSDEKarras, etc.)",
  "cfgScale": number,
  "steps": number,
  "dimensions": {"width": number, "height": number},
  "clipSkip": number
}

RULES:
- Keep the model from the reference — it produced the good visual quality
- Keep the sampler from the reference — it's tuned for that model
- ADJUST CFG based on each character's skin tone (see CFG and Skin Tones section above) — lower for deeper tones, keep standard for lighter tones
- REWRITE the prompt entirely for our scene: our characters, our setting, our action
- Front-load character count and interaction type in the first 5-15 tokens (CLIP attention is strongest here)
- Include skin tone, body type, and hair description for our characters — be explicit, SDXL defaults to light-skinned slim builds
- REMOVE any character-specific LoRAs from the reference (face LoRAs, person LoRAs, ethnicity LoRAs that conflict)
- KEEP quality/detail/pose LoRAs from the reference
- Simplify if the reference used 5+ LoRAs — 3-4 max is the sweet spot
- Remove any light-skin or conflicting ethnicity terms from the prompt AND negative prompt
- The prompt should be in booru-tag style for NSFW, natural language for SFW
- Keep dimensions from the reference unless the scene clearly needs a different aspect ratio
- Do NOT include LoRA injection tags like <lora:name:weight> in the prompt — list them separately
- Total prompt should be under 77 tokens — if you're over, cut quality/composition tags first (they're at the end of CLIP's attention window)

Return ONLY the JSON object. No markdown, no explanation, no code fences.`;
}

// Static fallback — orchestrator should use buildRecipeAdaptationPrompt() instead
export const RECIPE_ADAPTATION_SYSTEM = buildRecipeAdaptationPrompt(null);

// ── Step 7: Image Evaluation ──

export const EVALUATION_SYSTEM = `You are an art director evaluating a generated image against the original scene intent. Score the image across 6 dimensions on a 0-100 scale.

${EVALUATION_KNOWLEDGE}

You will receive:
1. The generated image
2. The original scene description / intent
3. (Optionally) Character reference portraits for appearance matching

Score each dimension using the rubric above.

Return ONLY a valid JSON object:
{
  "scores": {
    "positionPose": number,
    "characterCount": number,
    "settingEnvironment": number,
    "characterAppearance": number,
    "lightingMood": number,
    "compositionQuality": number
  },
  "overall": number (weighted average using: positionPose 0.30, characterCount 0.20, settingEnvironment 0.15, characterAppearance 0.15, lightingMood 0.10, compositionQuality 0.10),
  "feedback": "1-2 sentences describing the most important things to fix",
  "passesThreshold": boolean (true if overall >= 90)
}

CRITICAL RULES:
- Be harsh. An image that shows a solo woman when the prompt asked for a couple is a 0 on characterCount regardless of how beautiful the image is. Prompt adherence matters more than aesthetic quality.
- Apply the severity rules: wrong character count caps overall at 40, wrong position caps at 55, wrong skin tone caps characterAppearance at 50.
- A score of 90+ means the image is very close to the intent. This should be rare — most first attempts score 50-75.
- 70-89 means good but needs adjustment. Below 70 means significant mismatches.
- Do NOT grade on a curve. If 3/6 dimensions are wrong, the overall score should reflect that even if the image "looks nice."`;

// ── Step 8: Iteration Feedback ──

export const ITERATION_FEEDBACK_SYSTEM = `You are an expert Stable Diffusion art director reviewing failed image generation attempts. Based on the history of all previous attempts, their scores, and their feedback, suggest specific recipe modifications to improve the next attempt.

${SDXL_TECHNICAL_KNOWLEDGE}

${CHARACTER_ADAPTATION_KNOWLEDGE}

You will receive:
1. The original scene intent
2. The current recipe being used
3. A history of ALL previous attempts: each with the image, scores, and feedback
4. The current attempt number

Your job: Diagnose what's consistently failing and suggest SPECIFIC changes.

CRITICAL: You have the full history of previous attempts. Look at what changed between iterations and what effect it had on scores. Do NOT suggest changes that were already tried and failed. If the same dimension keeps failing after 3 attempts, suggest a fundamentally different approach (different base model, different LoRA set, different composition strategy) rather than tweaking the same parameters.

Return ONLY a valid JSON object:
{
  "diagnosis": "what is consistently wrong across attempts",
  "promptChanges": ["specific change 1", "specific change 2"],
  "loraChanges": [{"action": "add" | "remove" | "adjust", "name": "lora name", "weight": number}],
  "settingChanges": {
    "cfgScale": number | null,
    "steps": number | null,
    "sampler": "string" | null,
    "dimensions": {"width": number, "height": number} | null
  },
  "newPrompt": "the complete rewritten prompt if changes are substantial",
  "newNegativePrompt": "updated negative prompt if needed",
  "confidence": number (0-100, how confident you are this will improve the result),
  "reasoning": "explain WHY each change should help based on SD mechanics"
}

RULES:
- Look at the TREND across attempts — what keeps failing?
- If pose/position keeps failing, the prompt structure needs to change — put the action/pose FIRST before any character description
- If character count is wrong, add explicit count tags ("1girl 1boy", "2girls", "2people") as the VERY FIRST tokens in the prompt
- If lighting/mood is wrong, the negative prompt may need adjustments
- If skin tone is wrong: first check the prompt uses the character's EXACT skin tone from their data. Then adjust CFG — lower for deeper tones (4.5-5.5), standard for lighter tones (5-7)
- If body type is wrong, add more explicit body tags and consider a body-type LoRA
- NEVER suggest the same changes that were tried in a previous attempt
- Be bold — if 4+ attempts have failed, make bigger changes (different sampler, dramatically different prompt structure, LoRA overhaul)
- On attempt 5+, consider whether the base model simply can't handle this scene and suggest an alternative
- CHARACTER COUNT FAILURES are usually stochastic SDXL failures, NOT prompt problems. If the previous attempt failed ONLY on character count (other dimension scores were 60+), a new seed with the SAME recipe is the correct fix. Only suggest prompt/recipe changes for character count if it has failed 3+ times in a row — then suggest fundamentally different composition approaches (stronger "2people" front-loading, "couple" tags, removing conflicting tags from negative prompt)`;
