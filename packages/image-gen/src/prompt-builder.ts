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
 *
 * Preserves descriptions of non-character people — "Her friend",
 * "older woman", "the waiter" — because those inline descriptions are the ONLY source
 * of appearance info for non-character people in the scene.
 */
function stripInlineCharacterDescriptions(scenePrompt: string): string {
  let result = scenePrompt;

  // Remove parenthetical blocks starting with an age number followed by
  // comma-separated physical descriptors
  result = result.replace(/(\S+\s+)?\(\s*\d{1,3}\s*,[^)]{10,}\)/g, (match, preceding) => {
    if (preceding && /\b(?:friend|waiter|waitress|stranger|person|figure|woman|man|lady|guy|girl|boy|mother|father|sister|brother|aunt|uncle|boss|colleague|bartender|driver|guard|nurse|doctor|chef|vendor|passerby)\s*$/i.test(preceding)) {
      return match;
    }
    return preceding || '';
  });

  // Remove parenthetical blocks containing multiple comma-separated physical descriptors
  result = result.replace(/(\S+\s+)?\([^)]*(?:,\s*[^)]*){2,}\)/g, (match, preceding) => {
    const physicalTerms =
      /\b(?:face|cheekbone|jawline|hair|braid|bun|ponytail|figure|body|skin|complexion|build|frame|curvaceous|muscular|athletic|slim|petite|slender|toned|oval|round|square|freckles|dimples|stubble|beard|goatee)\b/i;

    if (!physicalTerms.test(match)) return match;

    if (preceding && /\b(?:friend|waiter|waitress|stranger|person|figure|woman|man|lady|guy|girl|boy|mother|father|sister|brother|aunt|uncle|boss|colleague|bartender|driver|guard|nurse|doctor|chef|vendor|passerby)\s*$/i.test(preceding)) {
      return match;
    }

    return preceding || '';
  });

  // Remove leading character intro phrases like "A stunning young Black South African woman"
  result = result.replace(
    /\b[Aa]n?\s+(?:\w+\s+){0,3}(?:Black\s+)?(?:South\s+)?African\s+(?:woman|man|couple|lady|girl|guy)\b/g,
    ""
  );

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
 * Clean a scene prompt imported from a story JSON.
 *
 * Strips inline character descriptions, quality prefixes/suffixes, and other
 * boilerplate that conflicts with the Kontext prompt builder's own character-tag
 * injection.
 */
export function cleanScenePrompt(prompt: string): string {
  // Start with existing inline-description stripping (parentheticals + African intros)
  let result = stripInlineCharacterDescriptions(prompt);

  // Remove broader character intro phrases
  result = result.replace(
    /\b[Aa]n?\s+(?:[\w-]+\s+){0,5}(?:woman|man|couple|lady|girl|guy|gentleman)\b(?:\s*,)?/g,
    (match) => {
      const introTerms =
        /\b(?:stunning|beautiful|gorgeous|handsome|attractive|striking|elegant|well-dressed|muscular|athletic|curvaceous|curvy|petite|slender|young|Black|White|Asian|Indian|African|Nigerian|Kenyan|Ethiopian|Caribbean|Latino|Latina|Hispanic|Brazilian|European|American|Middle[\s-]?Eastern|Arab|South[\s-]?African|Mixed[\s-]?race|Biracial)\b/i;
      return introTerms.test(match) ? "" : match;
    }
  );

  // Remove trailing quality suffix tags
  result = result.replace(/[,.\s]*\b[Pp]hotorealistic\.?\s*$/g, "");
  result = result.replace(/[,.\s]*\b(?:8k\s*uhd|dslr|film\s*grain|shallow\s*depth\s*of\s*field)\b[,.\s]*/gi, ", ");

  // Remove leading quality prefix tags
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
