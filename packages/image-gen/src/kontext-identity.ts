import type { CharacterData } from "@no-safe-word/shared";

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
export function buildKontextIdentityPrefix(charData: CharacterData): string {
  const sentences: string[] = [];

  // ── 1. Core identity sentence: "A 26-year-old African woman with ..." ──
  const gender =
    charData.gender === "female" ? "woman" :
    charData.gender === "male" ? "man" : "person";

  let core = "";
  if (charData.age && charData.ethnicity) {
    core = `A ${charData.age}-year-old ${charData.ethnicity} ${gender}`;
  } else if (charData.age) {
    core = `A ${charData.age}-year-old ${gender}`;
  } else if (charData.ethnicity) {
    core = `${article(charData.ethnicity)} ${charData.ethnicity} ${gender}`;
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
  if (charData.distinguishingFeatures) details.push(charData.distinguishingFeatures);

  if (details.length > 0) {
    core += ` with ${joinWithAnd(details)}`;
  }
  sentences.push(core + ".");

  // ── 2. Body sentence: "She has a curvaceous figure with ..." ──
  const isFemale = charData.gender === "female";
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

  // ── 3. Beauty/skin sentence for female characters ──
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
