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
    parts.push("(skin pores:1.1), (natural skin texture:1.2), (matte skin:1.1)");
  } else {
    parts.push("masterpiece, best quality, highly detailed, (skin pores:1.1), (natural skin texture:1.2), (matte skin:1.1)");
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

  // Strip portrait-scene suffix (everything from portrait photography/studio portrait onwards)
  result = result.replace(
    /,\s*(?:\(professional portrait photography[^)]*\)|studio portrait),\s*(?:soft diffused studio lighting|studio lighting|clean neutral background).*/i,
    ""
  );

  // Split into individual tags for filtering and deduplication
  const tags = result.split(",").map((s) => s.trim()).filter(Boolean);

  // Physical-feature keywords that signal the END of a clothing run
  const appearancePattern =
    /\b(?:eyes|skin|shoulders|hands|face|cheekbone|jawline|smile|dimple|freckle|scar|tattoo|beard|stubble|goatee|muscular|athletic|slim|petite|slender|build|frame|figure|physique|confidence|presence)\b/i;

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

  // "looking directly at camera/viewer" → "(looking directly at camera:1.3)"
  result = result.replace(
    /(?<!\()looking\s+directly\s+at\s+(?:camera|viewer|the\s+camera|the\s+viewer)(?![\w:]*\))/gi,
    "(looking directly at camera:1.3)"
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
 * Replace the age in extracted character tags with the correct age from character data.
 * The age is typically the first token, e.g. "35, male, athletic body, ..." → "26, male, ...".
 */
export function replaceTagsAge(tags: string, correctAge: string): string {
  if (!correctAge) return tags;
  // Match a leading number optionally followed by "years old" / "year old"
  return tags.replace(/^\d{1,3}(\s*years?\s*old)?/, correctAge);
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
  mode: "sfw" | "nsfw"
): string {
  const cleanedScene = weightGazeDirections(
    stripInlineCharacterDescriptions(scenePrompt)
  );

  const prefix = '(masterpiece, best quality:1.2), highly detailed, (photorealistic:1.3), (sharp focus:1.1)';
  const modeTag = mode === 'nsfw' ? 'professional erotic photography' : 'professional photography';
  const suffix = mode === 'nsfw'
    ? '(cinematic lighting:1.1), (intimate atmosphere:1.1), film grain, shallow depth of field, 8k uhd, dslr'
    : '(cinematic lighting:1.1), film grain, shallow depth of field, 8k uhd, dslr';

  // No linked characters — atmospheric/environmental shot
  if (!primaryCharacterTags) {
    return `${prefix}, ${modeTag}, ${cleanedScene}, ${suffix}`;
  }

  // Single character
  if (!secondaryCharacterTags) {
    return `${prefix}, ${modeTag}, ${primaryCharacterTags}, ${cleanedScene}, ${suffix}`;
  }

  // Two characters
  return `${prefix}, ${modeTag}, ${primaryCharacterTags}, second person: ${secondaryCharacterTags}, ${cleanedScene}, ${suffix}`;
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
    "(deformed, distorted, disfigured:1.3), poorly drawn, bad anatomy, wrong anatomy, extra limb, missing limb, floating limbs, mutated hands, extra fingers, missing fingers, (blurry:1.2), bad quality, watermark, text, signature, (cross-eyed:1.3), (strabismus:1.3), asymmetric eyes, different eye directions, (extra people:1.2), extra face, clone face, (3d render, cgi, illustration, cartoon, anime, painting, drawing:1.3), (bad teeth, deformed teeth:1.1)";

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
