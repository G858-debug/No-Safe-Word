import Anthropic from "@anthropic-ai/sdk";
import type { CharacterData } from "@no-safe-word/shared";

const anthropic = new Anthropic();

// In-memory cache: `${ethnicity}:${skinTone}` → resolved ethnicity label
const ethnicityCache = new Map<string, string>();

/**
 * AI-classify whether a character's ethnicity indicates Black/African descent,
 * and if so return "African American" as the prompt-friendly label.
 *
 * Applies to ALL genders — SDXL and Flux both produce better photorealistic
 * Black skin when prompted with "African American" rather than country-specific
 * or continent-specific ethnicity labels.
 * The result is cached by (ethnicity, skinTone) to avoid repeat calls.
 */
export async function resolvePromptEthnicity(
  ethnicity: string,
  gender: string,
  skinTone: string,
): Promise<string> {
  if (!ethnicity) return ethnicity;

  const cacheKey = `${ethnicity}:${skinTone}`;
  if (ethnicityCache.has(cacheKey)) return ethnicityCache.get(cacheKey)!;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 5,
      system: "You are a classifier. Answer only with the single word YES or NO. No explanation, no punctuation, nothing else.",
      messages: [
        {
          role: "user",
          content: `Is this person Black or of African descent? Ethnicity: ${ethnicity}. Skin tone: ${skinTone}. Answer YES or NO.`,
        },
      ],
    });

    const answer = (response.content[0] as { type: string; text: string }).text.trim().toUpperCase();
    const resolved = answer === "YES" ? "African American" : ethnicity;

    if (resolved !== ethnicity) {
      console.log(`[Identity] Ethnicity normalized for prompt: "${ethnicity}" (${gender}) → "African American"`);
    }

    ethnicityCache.set(cacheKey, resolved);
    return resolved;
  } catch (err) {
    console.warn(`[Identity] Ethnicity classification failed for "${ethnicity}" — using original:`, err);
    ethnicityCache.set(cacheKey, ethnicity);
    return ethnicity;
  }
}

/**
 * Build a natural-language identity prefix for Kontext/Flux prompts.
 *
 * Flux's T5 text encoder processes natural language prose far better than
 * comma-separated tag lists. This function outputs flowing descriptive
 * sentences that anchor the model on ethnicity, build, and hair details
 * the reference image alone can't guarantee.
 *
 * Clothing is intentionally omitted — the scene prompt controls wardrobe.
 *
 * Returns a multi-sentence prose string ending with a newline.
 */
export async function buildKontextIdentityPrefix(
  charData: CharacterData,
  opts?: { bodyPromptOverride?: string },
): Promise<string> {
  const sentences: string[] = [];

  // ── 1. Core identity sentence: "A 26-year-old African woman with ..." ──
  const gender =
    charData.gender === "female" ? "woman" :
    charData.gender === "male" ? "man" : "person";

  const resolvedEthnicity = await resolvePromptEthnicity(
    charData.ethnicity,
    charData.gender,
    charData.skinTone,
  );

  let core = "";
  if (charData.age && resolvedEthnicity) {
    core = `A ${charData.age}-year-old ${resolvedEthnicity} ${gender}`;
  } else if (charData.age) {
    core = `A ${charData.age}-year-old ${gender}`;
  } else if (resolvedEthnicity) {
    core = `${article(resolvedEthnicity)} ${resolvedEthnicity} ${gender}`;
  } else {
    core = `A ${gender}`;
  }

  // Append facial/hair details as "with X, Y, and Z"
  const details: string[] = [];
  if (charData.hairColor || charData.hairStyle) {
    const hair = [charData.hairColor, charData.hairStyle].filter(Boolean).join(" ");
    // Ensure it ends with "hair" if the style doesn't already contain it
    details.push(/\bhair\b/i.test(hair) ? hair : `${hair} hair`);
  }
  if (charData.eyeColor) details.push(`${charData.eyeColor} eyes`);
  if (charData.skinTone) details.push(`${charData.skinTone} skin`);

  if (details.length > 0) {
    core += ` with ${joinWithAnd(details)}`;
  }
  sentences.push(core + ".");

  // ── 2. Distinguishing features sentence ──
  // These are the most character-specific traits. A dedicated sentence gives
  // T5 a clear semantic boundary, ensuring the model treats them as primary
  // rather than as an afterthought appended to a long comma list.
  if (charData.distinguishingFeatures) {
    const pronoun2 = charData.gender === "female" ? "She" :
                     charData.gender === "male" ? "He" : "They";
    const verb2 = pronoun2 === "They" ? "have" : "has";
    sentences.push(`${pronoun2} ${verb2} ${charData.distinguishingFeatures}.`);
  }

  // ── 3. Body sentence: "She has a curvaceous figure with ..." ──
  const isFemale = charData.gender === "female";

  if (opts?.bodyPromptOverride) {
    // V3 pipeline: use the approved body prompt text directly
    sentences.push(opts.bodyPromptOverride);
  } else {
    const bt = (charData.bodyType || "").toLowerCase();
    if (bt) {
      const pronoun = isFemale ? "She" :
                      charData.gender === "male" ? "He" : "They";
      const verb = pronoun === "They" ? "have" : "has";

      // Extract the core build descriptor and any supplemental body details
      const bodyDetails: string[] = [];

      // Start with the raw bodyType as the base
      bodyDetails.push(charData.bodyType);

      // For female characters, ensure body LoRAs get text reinforcement.
      // If bodyType mentions curvy/curvaceous but lacks specifics, add them.
      if (isFemale) {
        const hasCurvyBase = /curv|voluptuous|hourglass|full[- ]figured/i.test(bt);
        if (hasCurvyBase && !/\bbreasts?\b/i.test(bt)) {
          bodyDetails.push("full breasts");
        }
        if (hasCurvyBase && !/\bhips?\b/i.test(bt)) {
          bodyDetails.push("wide hips");
        }
        if (hasCurvyBase && !/\bwaist\b/i.test(bt)) {
          bodyDetails.push("a slim waist");
        }
      }

      // Add supplemental descriptors if not already present (any gender)
      if (/large breasts|full breasts|big breasts|busty/i.test(bt) && !/large breasts/i.test(bt) && !/full breasts/i.test(bt)) {
        bodyDetails.push("large breasts");
      }
      if (/large butt|big ass|round hips|full hips/i.test(bt) && !/full round ass/i.test(bt)) {
        bodyDetails.push("a full round ass and wide hips");
      }
      if (/slim waist|defined waist/i.test(bt) && !/slim waist/i.test(bt)) {
        bodyDetails.push("a slim waist");
      }

      if (bodyDetails.length === 1) {
        sentences.push(`${pronoun} ${verb} a ${bodyDetails[0]} build.`);
      } else {
        const [base, ...rest] = bodyDetails;
        sentences.push(`${pronoun} ${verb} a ${base} build with ${joinWithAnd(rest)}.`);
      }
    }
  }

  // ── 4. Beauty/skin sentence for female characters ──
  // Reinforces attractiveness since Flux has no negative prompt to prevent
  // unflattering rendering and no emphasis weights for beauty tags.
  if (isFemale) {
    sentences.push("She has beautiful features and smooth, glowing skin.");
  }

  if (sentences.length === 0) return "";
  return sentences.join(" ") + "\n";
}

/** Join items with commas and "and" before the last: ["a", "b", "c"] → "a, b, and c" */
function joinWithAnd(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** Return "A" or "An" depending on the first letter of the word */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "An" : "A";
}

/**
 * Generate a default body prompt from structured character data.
 *
 * Used by V3 pipeline (flux_pulid) to auto-populate the body_prompt
 * column on story import. The user can edit before approving.
 *
 * Female emphasis order: ass/hips/thighs FIRST, then breasts, then waist.
 */
export function generateDefaultBodyPrompt(charData: CharacterData): string {
  const gender = charData.gender?.toLowerCase();

  if (gender === "female") {
    const skinTone = charData.skinTone || "dark";
    const bodyBase = charData.bodyType || "curvaceous";

    return (
      `She has a ${bodyBase} figure with a very large, round ass, ` +
      `wide hips, thick thighs, large natural breasts, and a narrow defined waist. ` +
      `Her body is full-figured with smooth, glowing ${skinTone} skin.`
    );
  }

  if (gender === "male") {
    const bodyBase = charData.bodyType || "athletic";
    const skinTone = charData.skinTone || "dark";
    return `He has a ${bodyBase} build with broad shoulders and a strong frame. ${skinTone} skin.`;
  }

  return charData.bodyType || "";
}
