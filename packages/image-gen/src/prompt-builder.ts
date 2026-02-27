import type { CharacterData, SceneData } from "@no-safe-word/shared";

/**
 * Detect whether a character needs African facial feature correction.
 * SDXL has a strong bias toward European facial geometry on male subjects —
 * this corrects lip fullness and cheekbone structure for Black/African male characters.
 */
export function needsAfricanFeatureCorrection(character: CharacterData): boolean {
  return (
    character.gender === "male" &&
    /\b(?:Black|African|Zulu|Xhosa|Ndebele|Sotho|Tswana|Venda|Tsonga)\b/i.test(
      character.ethnicity
    )
  );
}

/**
 * Sanitize long bodyType descriptions to prevent SDXL from interpreting
 * multiple muscle-related phrases as "bodybuilder."
 *
 * Strategy: if the bodyType contains commas (multi-phrase narrative description),
 * extract just the core build keyword(s) and drop body-part-specific details
 * like "broad shoulders, strong hands" that push the model toward exaggeration.
 */
/** Strip full-body framing cues that conflict with head-and-shoulders portrait framing */
function stripFullBodyCues(text: string): string {
  return text.replace(/\b(?:full[- ]?body|full[- ]?length|from head to toe)\b/gi, "").replace(/\s{2,}/g, " ").trim();
}

function sanitizeBodyType(raw: string): string {
  // Short/simple descriptions — pass through as-is
  if (!raw.includes(",")) return raw;

  // Known core build keywords to preserve (first match wins)
  const buildKeywords = [
    "slim", "slender", "petite", "lean", "thin",
    "athletic", "toned", "fit", "gym-fit",
    "muscular", "naturally muscular", "well-built",
    "curvy", "curvaceous", "voluptuous", "full-figured",
    "stocky", "heavyset", "broad",
    "average", "medium",
    "tall", "short",
  ];

  const lower = raw.toLowerCase();

  // Collect all matching build keywords
  const matched: string[] = [];
  for (const kw of buildKeywords) {
    if (lower.includes(kw)) {
      // Avoid adding both "muscular" and "naturally muscular"
      if (kw === "muscular" && matched.some((m) => m.includes("muscular"))) continue;
      if (kw === "broad" && matched.some((m) => m.includes("built"))) continue;
      matched.push(kw);
    }
  }

  if (matched.length > 0) {
    // Cap at 3 descriptors to keep it concise
    return matched.slice(0, 3).join(", ");
  }

  // Fallback: take just the first comma-separated phrase
  return raw.split(",")[0].trim();
}

export function buildPrompt(
  character: CharacterData,
  scene: SceneData
): string {
  const parts: string[] = [];
  const isAfricanMale = needsAfricanFeatureCorrection(character);

  // Portrait framing tags go FIRST so CLIP gives them maximum weight
  const isPortrait = scene.mood === "professional portrait";
  if (isPortrait) {
    parts.push("masterpiece, best quality, highly detailed");
    parts.push("(close-up head and shoulders portrait:1.4), (face in focus:1.3), (detailed facial features:1.2)");
    parts.push("(smooth clear skin:1.2), (natural skin:1.1), (matte skin:1.1)");
  } else {
    parts.push("masterpiece, best quality, highly detailed, (smooth clear skin:1.2), (natural skin:1.1), (matte skin:1.1)");
  }

  if (character.age) parts.push(character.age);
  if (character.gender) parts.push(character.gender);

  if (character.ethnicity) {
    if (isAfricanMale) {
      // Replace generic "Black South African" with SDXL-friendly terms
      // "African" + specific ethnic group works better than "Black" which
      // CLIP treats as a color adjective
      parts.push("(African male:1.3)");
      // Keep the original ethnicity minus the ambiguous "Black" prefix
      const specificEthnicity = character.ethnicity
        .replace(/^Black\s+/i, "")
        .trim();
      if (specificEthnicity && specificEthnicity.toLowerCase() !== "african") {
        parts.push(specificEthnicity);
      }
    } else {
      parts.push(character.ethnicity);
    }
  }

  if (character.bodyType) {
    // Sanitize long bodyType descriptions: SDXL interprets multiple muscle-related
    // phrases (e.g. "broad muscular shoulders, strong hands, naturally muscular
    // from physical work") as "bodybuilder". Extract only the core build descriptor.
    // Also strip "full body" framing cues that conflict with portrait framing.
    const sanitized = stripFullBodyCues(sanitizeBodyType(character.bodyType));
    if (sanitized) {
      parts.push(/\bbody\b|build\b|figure\b|frame\b|physique\b/i.test(sanitized)
        ? sanitized
        : `${sanitized} body`);
    }
  }
  if (character.hairColor && character.hairStyle) {
    const needsSuffix = !/\bhair\b/i.test(character.hairStyle);
    parts.push(`${character.hairColor} ${character.hairStyle}${needsSuffix ? " hair" : ""}`);
  } else if (character.hairColor) {
    parts.push(`${character.hairColor} hair`);
  } else if (character.hairStyle) {
    parts.push(/\bhair\b/i.test(character.hairStyle) ? character.hairStyle : `${character.hairStyle} hair`);
  }
  if (character.eyeColor) parts.push(`${character.eyeColor} eyes`);

  if (character.skinTone) {
    parts.push(`${character.skinTone} skin`);
  }

  // Positive African facial feature cues for male characters.
  // Instead of only pushing European features to the negative prompt,
  // actively guide the model toward correct facial geometry.
  if (isAfricanMale) {
    parts.push("full lips, strong jawline");
  }

  if (character.expression) {
    parts.push(/\bexpression\b|smile\b|smiling\b|grin\b|gaze\b|look\b|frown\b/i.test(character.expression)
      ? character.expression
      : `${character.expression} expression`);
  }
  if (character.clothing) parts.push(`wearing ${character.clothing}`);
  if (character.pose) parts.push(character.pose);
  if (character.distinguishingFeatures)
    parts.push(character.distinguishingFeatures);

  // Female characters always wear heels in full-body shots
  if (scene.mood === "fashion photography" && character.gender !== "male") {
    parts.push("wearing high heels");
  }

  if (scene.setting) parts.push(scene.setting);
  if (scene.lighting) parts.push(`${scene.lighting} lighting`);
  if (scene.mood) parts.push(`${scene.mood} mood`);

  const modeDescription =
    scene.mode === "nsfw" ? scene.nsfwDescription : scene.sfwDescription;
  if (modeDescription) parts.push(modeDescription);

  if (scene.additionalTags.length > 0) parts.push(...scene.additionalTags);

  return parts.filter(Boolean).join(", ");
}

/**
 * Extract just the character-description tags from a full portrait prompt.
 * Strips the quality prefix, portrait-scene suffix, clothing field, and
 * deduplicates phrases so the result contains only clean appearance tags.
 *
 * Options:
 *  - stripClothing: remove "wearing ..." phrases (default true for story images
 *    where scene prompts specify scene-specific clothing)
 */
export function extractCharacterTags(
  portraitPrompt: string,
  options: { stripClothing?: boolean } = {}
): string {
  const { stripClothing = true } = options;
  let result = portraitPrompt;

  // Strip quality prefix and portrait framing tags
  result = result.replace(
    /^masterpiece,\s*best quality,\s*highly detailed,\s*/i,
    ""
  );
  result = result.replace(
    /\(close-up head and shoulders portrait[^)]*\),?\s*\(face in focus[^)]*\),?\s*\(detailed facial features[^)]*\),?\s*/i,
    ""
  );
  // Strip skin quality tags (not character appearance)
  result = result.replace(
    /\(smooth clear skin[^)]*\),?\s*\(natural skin[^)]*\),?\s*\(matte skin[^)]*\),?\s*/i,
    ""
  );

  // Strip portrait-scene suffix (everything from portrait photography/studio portrait onwards)
  result = result.replace(
    /,\s*(?:\(professional portrait photography[^)]*\)|studio portrait),\s*(?:soft diffused studio lighting|studio lighting|clean neutral background).*/i,
    ""
  );

  // Split into individual tags for filtering and deduplication
  const tags = result.split(",").map((s) => s.trim()).filter(Boolean);

  // Physical-feature keywords that signal the END of a clothing run.
  // Body shape descriptors (breasts, hips, waist, curvy, etc.) must be preserved
  // so that figure information survives clothing stripping.
  const appearancePattern =
    /\b(?:eyes|skin|shoulders|hands|face|cheekbone|jawline|smile|dimple|freckle|scar|tattoo|beard|stubble|goatee|muscular|athletic|slim|petite|slender|build|frame|figure|physique|confidence|presence|breasts|bust|hips|waist|thighs|curvy|curvaceous|voluptuous|full[- ]figured)\b/i;

  const filtered: string[] = [];
  let inClothingRun = false;

  for (const tag of tags) {
    // Detect start of clothing run: "wearing ..."
    if (stripClothing && /^wearing\s/i.test(tag)) {
      inClothingRun = true;
      continue;
    }

    // If we're in a clothing run, check if this tag is still clothing
    // (no appearance keywords) or if we've hit a real appearance tag
    if (inClothingRun) {
      if (appearancePattern.test(tag)) {
        inClothingRun = false;
        // fall through to add this tag
      } else {
        // Still clothing — skip (handles "work boots", "jeans and plain t-shirt", etc.)
        continue;
      }
    }

    // Fix double-word suffixes from existing approved_prompts:
    // "short natural hair hair" → "short natural hair"
    // "naturally muscular from physical work body" stays (already has "body" only once)
    let cleaned = tag
      .replace(/\b(hair)\s+\1\b/gi, "$1")
      .replace(/\b(body)\s+\1\b/gi, "$1")
      .replace(/\b(expression)\s+\1\b/gi, "$1")
      .replace(/\b(skin)\s+\1\b/gi, "$1");

    filtered.push(cleaned);
  }

  // Deduplicate exact matches (case-insensitive), preserving order
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const part of filtered) {
    const key = part.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(part);
    }
  }

  return unique.join(", ");
}

/**
 * Strip inline parenthetical character descriptions from a scene prompt.
 * These are blocks like "(24, oval face, high cheekbones, neat braids in low bun, slim curvaceous figure)"
 * that duplicate appearance info already captured in the approved character tags.
 * Preserves SD emphasis parens like (tag:1.3) which are short single-item groups.
 */
export function stripInlineCharacterDescriptions(scenePrompt: string): string {
  let result = scenePrompt;

  // Remove parenthetical blocks starting with an age number followed by
  // comma-separated physical descriptors (the dominant pattern from story generation)
  result = result.replace(/\(\s*\d{1,3}\s*,[^)]{10,}\)/g, "");

  // Remove parenthetical blocks containing multiple comma-separated physical descriptors
  // even without a leading age number (e.g. "(round face, warm smile, full figure)")
  result = result.replace(/\([^)]*(?:,\s*[^)]*){2,}\)/g, (match) => {
    const physicalTerms =
      /\b(?:face|cheekbone|jawline|hair|braid|bun|ponytail|figure|body|skin|complexion|build|frame|curvaceous|muscular|athletic|slim|petite|slender|toned|oval|round|square|freckles|dimples|stubble|beard|goatee)\b/i;
    return physicalTerms.test(match) ? "" : match;
  });

  // Remove leading character intro phrases like:
  // "A stunning young Black South African woman"
  // "A muscular young Black South African man"
  // "A beautiful Black South African couple"
  result = result.replace(
    /\b[Aa]n?\s+(?:\w+\s+){0,3}(?:Black\s+)?(?:South\s+)?African\s+(?:woman|man|couple|lady|girl|guy)\b/g,
    ""
  );

  // Also strip "Her friend" / "His friend" intro patterns before parenthetical blocks
  // (the parenthetical itself is already removed above)
  result = result.replace(/\b(?:Her|His)\s+friend\b/gi, "");

  // Clean up artifacts left after removals
  result = result
    .replace(/,(\s*,)+/g, ",")           // collapse multiple commas
    .replace(/\.\s*,/g, ".")             // "Night scene. ," → "Night scene."
    .replace(/^\s*[.,]\s*/, "")          // leading comma/period
    .replace(/\s*,\s*$/, "")             // trailing comma
    .replace(/\s{2,}/g, " ")            // collapse whitespace
    .trim();

  return result;
}

/**
 * Add emphasis weight to gaze/eye direction instructions in a scene prompt.
 * These are critical for character consistency and need extra weight to
 * override the model's tendencies.
 */
export function weightGazeDirections(scenePrompt: string): string {
  let result = scenePrompt;

  // Already-weighted gaze instructions (contains :1.N) — skip
  // Only process unweighted gaze patterns

  // "looking directly at camera/viewer" → "(looking directly at camera:1.4)"
  // This is the single most impactful element for engaging images — weight aggressively
  result = result.replace(
    /(?<!\()looking\s+directly\s+at\s+(?:camera|viewer|the\s+camera|the\s+viewer)(?![\w:]*\))/gi,
    "(looking directly at camera:1.4)"
  );

  // "eye contact" → "(eye contact:1.3)"
  result = result.replace(
    /(?<!\()eye\s+contact(?![\w:]*\))/gi,
    "(eye contact:1.3)"
  );

  // "eyes closed" → "(eyes closed:1.3)"
  result = result.replace(
    /(?<!\()eyes\s+closed(?![\w:]*\))/gi,
    "(eyes closed:1.3)"
  );

  // "looking at him/her/the other person/them" → "(looking at the other person:1.2)"
  result = result.replace(
    /(?<!\()looking\s+at\s+(?:him|her|them|the\s+other\s+person)(?![\w:]*\))/gi,
    "(looking at the other person:1.2)"
  );

  // "looking down" → "(looking down:1.2)"
  result = result.replace(
    /(?<!\()looking\s+down(?![\w:]*\))/gi,
    "(looking down:1.2)"
  );

  // "looking over shoulder" → "(looking over shoulder:1.2)"
  result = result.replace(
    /(?<!\()looking\s+over\s+(?:her\s+|his\s+)?shoulder(?![\w:]*\))/gi,
    "(looking over shoulder:1.2)"
  );

  // "eyes open, staring at ceiling" or "staring at ceiling" → weighted
  result = result.replace(
    /(?<!\()(?:eyes\s+open,\s*)?staring\s+at\s+(?:the\s+)?ceiling(?![\w:]*\))/gi,
    "(eyes open, staring at ceiling:1.2)"
  );

  // "looking up" → "(looking up:1.2)"
  result = result.replace(
    /(?<!\()looking\s+up(?![\w:]*\))/gi,
    "(looking up:1.2)"
  );

  // "looking away" → "(looking away:1.2)"
  result = result.replace(
    /(?<!\()looking\s+away(?![\w:]*\))/gi,
    "(looking away:1.2)"
  );

  return result;
}

/**
 * Helper: wrap a matched phrase in SD emphasis syntax, skipping if already wrapped.
 * Returns the replacement string for use inside .replace() callbacks.
 */
function wrapEmphasis(match: string, weight: string): string {
  return `(${match}:${weight})`;
}

/**
 * Emphasize commonly-ignored scene details (clothing, accessories, poses,
 * multi-person cues) so the model actually renders them.
 *
 * Only wraps phrases that are NOT already inside SD emphasis parens.
 * The negative-lookbehind `(?<!\()` and negative-lookahead `(?![\w:]*\))`
 * pattern from weightGazeDirections is reused here.
 */
export function emphasizeSceneDetails(scenePrompt: string): string {
  let result = scenePrompt;

  // --- Two-person reinforcement (most critical — models often drop the second person) ---
  result = result.replace(
    /(?<!\()(?:two people|two persons|couple|man and woman|woman and man)(?![\w:]*\))/gi,
    (m) => `(${m}, two people in frame:1.3)`
  );

  // --- Clothing items — wrap specific garments at 1.25 ---
  // Match multi-word clothing phrases (e.g. "off-shoulder top", "white t-shirt")
  // Pattern: optional color/adjective + garment noun
  const clothingPattern = new RegExp(
    '(?<!\\()' +
    '(?:' +
      // Specific multi-word garments
      '(?:off[- ]shoulder|crop|halter|button[- ]down|low[- ]cut|v[- ]neck)\\s+(?:top|shirt|blouse|dress)' +
      '|' +
      // Color/adjective + garment (adj required for ambiguous words like "top", "shirt", "vest")
      '(?:(?:white|black|red|blue|green|pink|gold|silver|sheer|silk|lace|leather|denim|fitted|tight|mini|maxi|long|short|sleeveless|cropped|unbuttoned|unzipped)\\s+)' +
      '(?:top|shirt|vest|camisole|t-shirt|tee|tank top|blouse|blazer|jacket|overalls|dress|skirt|jeans|shorts|pants|trousers|lingerie|bodysuit|corset|robe|kimono|sundress|gown|heels|high heels|stilettos|boots|sneakers|sandals|stockings|thigh[- ]highs)' +
      '|' +
      // Unambiguous garment nouns (safe without adjective)
      '(?:t-shirt|tank top|blouse|blazer|overalls|lingerie|bodysuit|corset|kimono|sundress|gown|stilettos|stockings|thigh[- ]highs|camisole|high heels)' +
    ')' +
    '(?![\\w:]*\\))',
    'gi'
  );
  result = result.replace(clothingPattern, (m) => wrapEmphasis(m, '1.25'));

  // --- Clothing + exposure phrases — "showing cleavage", "revealing neckline" at 1.25 ---
  const clothingExposurePattern = new RegExp(
    '(?<!\\()' +
    '(?:' +
      'showing\\s+(?:tasteful\\s+)?cleavage' +
      '|revealing\\s+(?:neckline|outfit|cleavage)' +
      '|(?:unzipped|unbuttoned)\\s+(?:to\\s+(?:the\\s+)?waist|halfway)' +
    ')' +
    '(?![\\w:]*\\))',
    'gi'
  );
  result = result.replace(clothingExposurePattern, (m) => wrapEmphasis(m, '1.25'));

  // --- Accessories at 1.15 ---
  const accessoryPattern = new RegExp(
    '(?<!\\()' +
    '(?:' +
      '(?:(?:gold|silver|diamond|pearl|beaded|leather|delicate|chunky|thin|thick)\\s+)?' +
      '(?:earrings|necklace|bracelet|anklet|watch|ring|choker|pendant|chain|sunglasses|glasses|hat|headband|hair clip|nose ring|belly ring)' +
    ')' +
    '(?![\\w:]*\\))',
    'gi'
  );
  result = result.replace(accessoryPattern, (m) => wrapEmphasis(m, '1.15'));

  // --- Specific actions/poses at 1.2 ---
  const actionPattern = new RegExp(
    '(?<!\\()' +
    '(?:' +
      'biting (?:her |his )?(?:lower )?lip' +
      '|hands? on (?:her |his )?hips?' +
      '|hand on (?:her |his )?(?:chest|chin|neck|thigh|knee|waist)' +
      '|leaning (?:against|on|forward|back)' +
      '|arms? crossed' +
      '|hand(?:s)? running through (?:her |his )?hair' +
      '|touching (?:her |his )?(?:face|neck|hair|shoulder|lip)' +
      '|finger(?:s)? (?:on|to|touching) (?:her |his )?lips?' +
      '|straddling' +
      '|sitting on (?:his )?lap' +
      '|legs? crossed' +
      '|hand(?:s)? behind (?:her |his )?(?:head|back|neck)' +
    ')' +
    '(?![\\w:]*\\))',
    'gi'
  );
  result = result.replace(actionPattern, (m) => wrapEmphasis(m, '1.2'));

  return result;
}

/**
 * Replace the age in extracted character tags with the correct age from character data.
 * The age is typically the first token, e.g. "35, male, athletic body, ..." → "26, male, ...".
 */
export function replaceTagsAge(tags: string, correctAge: string): string {
  if (!correctAge) return tags;
  // Match a leading number optionally followed by "years old" / "year old"
  return tags.replace(/^\d{1,3}(\s*years?\s*old)?/, correctAge);
}

/**
 * Detect whether character tags describe a female character.
 * Only returns true when there's a POSITIVE female indicator in the tags.
 * Never infers gender from absence — a male character whose tags lack
 * explicit "male" must NOT receive female body enhancement.
 */
function isFemaleCharacter(tags: string): boolean {
  const lower = tags.toLowerCase();
  // Explicit male indicators → definitely not female
  if (/\b(?:male|man|boy|guy|gentleman)\b/.test(lower)) return false;
  // Explicit female indicators → yes
  if (/\b(?:female|woman|girl|lady)\b/.test(lower)) return true;
  // Ambiguous — do NOT default to female. Body enhancement on a male
  // character produces terrible results. Better to skip enhancement
  // than to wrongly apply it.
  return false;
}

/**
 * Inject attractiveness and figure enhancement tags for female characters.
 * Placed after character tags and before the scene description so CLIP
 * treats them as character-level attributes rather than scene-level.
 *
 * Skipped when the scene prompt deliberately specifies loose/baggy clothing,
 * which signals a creative choice that shouldn't be overridden.
 */
function injectFemaleEnhancement(scenePrompt: string, mode: 'sfw' | 'nsfw'): string {
  // Respect deliberate creative choices for loose clothing
  if (/\b(?:baggy|loose|oversized)\b/i.test(scenePrompt)) return '';

  const bodyWeight = mode === 'nsfw' ? '1.25' : '1.15';

  const parts = [
    '(beautiful face, perfect makeup, full lips, alluring eyes:1.2)',
    `(curvaceous figure, hourglass body, large breasts, wide hips, slim waist, thick thighs:${bodyWeight})`,
    '(form-fitting clothing, showing cleavage, dressed up, glamorous:1.1)',
  ];

  return parts.join(', ');
}

/**
 * Build the final prompt for a story image.
 *
 * Supports single-character and dual-character scenes. Character tags
 * (ground truth for appearance from approved portraits) are placed first,
 * then the scene prompt with inline character descriptions stripped and
 * gaze directions emphasized.
 *
 * For prompts with NO linked characters (atmospheric/environmental shots),
 * the scene prompt is used as-is with quality prefix/suffix.
 */
export function buildStoryImagePrompt(
  primaryCharacterTags: string | null,
  secondaryCharacterTags: string | null,
  scenePrompt: string,
  mode: "sfw" | "nsfw",
  triggerWords?: string[]
): string {
  const cleanedScene = emphasizeSceneDetails(
    weightGazeDirections(
      stripInlineCharacterDescriptions(scenePrompt)
    )
  );

  const prefix = '(masterpiece, best quality:1.2), highly detailed, (photorealistic:1.3), (sharp focus:1.1)';
  const modeTag = mode === 'nsfw' ? 'professional erotic photography' : 'professional photography';
  const suffix = mode === 'nsfw'
    ? '(cinematic lighting:1.1), (intimate atmosphere:1.1), film grain, shallow depth of field, 8k uhd, dslr'
    : '(cinematic lighting:1.1), film grain, shallow depth of field, 8k uhd, dslr';

  // Deduplicate trigger words (e.g. both characters use "tok")
  const uniqueTriggers = triggerWords?.length
    ? triggerWords.filter((w, i) => triggerWords.indexOf(w) === i).join(', ')
    : '';

  // No linked characters — atmospheric/environmental shot
  if (!primaryCharacterTags) {
    return `${prefix}, ${modeTag}, ${cleanedScene}, ${suffix}`;
  }

  // Female enhancement: inject attractiveness tags after character tags
  const primaryEnhancement = isFemaleCharacter(primaryCharacterTags)
    ? injectFemaleEnhancement(scenePrompt, mode)
    : '';
  const secondaryEnhancement = secondaryCharacterTags && isFemaleCharacter(secondaryCharacterTags)
    ? injectFemaleEnhancement(scenePrompt, mode)
    : '';

  // Trigger word prefix (placed before character tags so CLIP associates them)
  const twPrefix = uniqueTriggers ? `${uniqueTriggers}, ` : '';

  // SFW clothing reinforcement: positive signal to keep clothes ON.
  // Placed right before the scene description so it's spatially close to
  // scene-specific clothing instructions, reinforcing them.
  const sfwClothing = mode === 'sfw' ? '(wearing clothes, fully dressed, clothed:1.3), ' : '';

  // Single character
  if (!secondaryCharacterTags) {
    const charBlock = primaryEnhancement
      ? `${primaryCharacterTags}, ${primaryEnhancement}`
      : primaryCharacterTags;
    return `${prefix}, ${modeTag}, ${twPrefix}${charBlock}, ${sfwClothing}${cleanedScene}, ${suffix}`;
  }

  // Two characters
  const primaryBlock = primaryEnhancement
    ? `${primaryCharacterTags}, ${primaryEnhancement}`
    : primaryCharacterTags;
  const secondaryBlock = secondaryEnhancement
    ? `${secondaryCharacterTags}, ${secondaryEnhancement}`
    : secondaryCharacterTags;
  return `${prefix}, ${modeTag}, ${twPrefix}${primaryBlock}, second person: ${secondaryBlock}, ${sfwClothing}${cleanedScene}, ${suffix}`;
}

/**
 * Clean a scene prompt imported from a story JSON.
 *
 * Story JSONs written in the old narrative style contain inline character
 * descriptions and other boilerplate that conflicts with the prompt builder's
 * own character-tag injection. This function strips those patterns at import
 * time so saved prompts contain only scene-specific content.
 *
 * Best-effort — handles the most common patterns from our prompt style.
 */
export function cleanScenePrompt(prompt: string): string {
  // Start with existing inline-description stripping (parentheticals + African intros)
  let result = stripInlineCharacterDescriptions(prompt);

  // Remove broader character intro phrases:
  // "A stunning young Black South African woman," "A muscular man,"
  // "A well-dressed young couple," etc.
  // Only removes when the phrase contains a character-intro adjective or ethnicity term.
  result = result.replace(
    /\b[Aa]n?\s+(?:[\w-]+\s+){0,5}(?:woman|man|couple|lady|girl|guy|gentleman)\b(?:\s*,)?/g,
    (match) => {
      const introTerms =
        /\b(?:stunning|beautiful|gorgeous|handsome|attractive|striking|elegant|well-dressed|muscular|athletic|curvaceous|curvy|petite|slender|young|Black|White|Asian|Indian|African|Nigerian|Kenyan|Ethiopian|Caribbean|Latino|Latina|Hispanic|Brazilian|European|American|Middle[\s-]?Eastern|Arab|South[\s-]?African|Mixed[\s-]?race|Biracial)\b/i;
      return introTerms.test(match) ? "" : match;
    }
  );

  // Remove trailing quality suffix tags (added by prompt builder)
  result = result.replace(/[,.\s]*\b[Pp]hotorealistic\.?\s*$/g, "");
  result = result.replace(/[,.\s]*\b(?:8k\s*uhd|dslr|film\s*grain|shallow\s*depth\s*of\s*field)\b[,.\s]*/gi, ", ");

  // Remove leading quality prefix tags (added by prompt builder)
  result = result.replace(/^\s*[Pp]hotorealistic[.,]\s*/g, "");
  result = result.replace(/^\s*\(masterpiece[^)]*\)\s*,?\s*/i, "");
  result = result.replace(/^\s*(?:highly\s+detailed|professional\s+(?:erotic\s+)?photography)\s*,?\s*/gi, "");

  // Clean up artifacts: double commas, leading/trailing commas, double spaces
  result = result
    .replace(/,(\s*,)+/g, ",")
    .replace(/^\s*,\s*/, "")
    .replace(/\s*,\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return result;
}

export function buildNegativePrompt(
  scene: SceneData,
  characterHints?: { africanFeatureCorrection?: boolean }
): string {
  const base =
    "(deformed, distorted, disfigured:1.3), poorly drawn, bad anatomy, wrong anatomy, extra limb, missing limb, floating limbs, mutated hands, extra fingers, missing fingers, (blurry:1.2), bad quality, watermark, text, signature, (cross-eyed:1.3), (strabismus:1.3), asymmetric eyes, different eye directions, (extra people:1.2), extra face, clone face, (3d render, cgi, illustration, cartoon, anime, painting, drawing:1.3), (bad teeth, deformed teeth:1.1), (skin blemishes:1.3), (acne:1.3), (skin spots:1.2), (pimples:1.3), (moles:1.2), (freckles:1.1), (skin imperfections:1.2)";

  let result = base;

  if (scene.mode === "sfw") {
    result += ", (nsfw:1.5), (nude:1.5), (naked:1.5), (topless:1.5), (nipples:1.5), (breast:1.3), explicit, exposed skin";
  }

  // Reinforce head-and-shoulders framing for portrait scenes
  if (scene.mood === "professional portrait") {
    result += ", (full body:1.4), (full length:1.4), (wide shot:1.3), (legs:1.2), (feet:1.2)";
    // Enforce uniform studio background
    result += ", (outdoor:1.3), (nature:1.2), (city:1.2), (room:1.2), (textured background:1.2), (patterned background:1.2), (colorful background:1.2)";
  }

  // Counter SDXL's default European facial geometry for African characters
  if (characterHints?.africanFeatureCorrection) {
    result += ", European facial features, caucasian features";
  }

  return result;
}
