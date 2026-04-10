import type { CharacterData } from "@no-safe-word/shared";
import Anthropic from '@anthropic-ai/sdk';

// ── Juggernaut Ragnarok Prompt Building ──
// See docs/skills/juggernaut-ragnarok/SKILL.md for prompting reference

export type ContentMode = 'sfw' | 'nsfw';

export interface CharacterPromptData {
  gender: 'male' | 'female';
  ethnicity?: string;
  skinTone?: string;
  hairColor?: string;
  hairStyle?: string;
  eyeColor?: string;
  bodyType?: string;
  age?: string;
  distinguishingFeatures?: string;
}

/** CLIP token limit for SDXL — content beyond this is silently truncated */
const CLIP_TOKEN_LIMIT = 75;

/**
 * Estimate CLIP token count for a prompt string.
 * CLIP's BPE tokenizer averages ~1.3 tokens per word for English text,
 * with commas and punctuation each counting as a token.
 */
export function estimateClipTokens(text: string): number {
  if (!text) return 0;
  // Split on whitespace and commas, count non-empty parts
  const parts = text.split(/[\s,]+/).filter(Boolean);
  // Each comma separator also counts as a token
  const commaCount = (text.match(/,/g) || []).length;
  return Math.ceil(parts.length * 1.3) + commaCount;
}

/**
 * Build quality prefix for Juggernaut Ragnarok prompts.
 *
 * Ragnarok responds well to photography-style quality tokens.
 * Keep it concise — the 75-token CLIP limit means every token matters.
 */
export function buildQualityPrefix(contentMode: ContentMode): string {
  return 'photograph, high resolution, cinematic, skin textures, detailed';
}

/**
 * Build negative prompt for Juggernaut Ragnarok.
 *
 * SFW negative MUST include nudity/NSFW prevention tokens because
 * Ragnarok was trained on NSFW data and defaults toward nudity.
 */
export function buildNegativePrompt(contentMode: ContentMode): string {
  const base = 'bad anatomy, bad hands, extra limbs, extra fingers, mutated hands, watermark, blurry, text, cartoon, illustration, painting, drawing, low quality, worst quality, deformed, disfigured';

  if (contentMode === 'sfw') {
    return `nudity, naked, nsfw, topless, nude, exposed breasts, nipples, ${base}`;
  }

  return base;
}

/**
 * Build character identity description for scene prompts.
 *
 * For characters WITH a deployed LoRA (triggerWord provided): return ONLY the trigger word.
 * The LoRA carries identity — inline physical descriptions would conflict.
 *
 * For characters WITHOUT a LoRA (extras, background figures): return
 * a concise natural language physical description.
 */
export function buildCharacterTags(
  charData: CharacterPromptData,
  opts?: { mode?: ContentMode; triggerWord?: string },
): string {
  if (opts?.triggerWord) {
    return opts.triggerWord;
  }

  const parts: string[] = [];

  const genderWord = charData.gender === 'female' ? 'woman' : 'man';
  if (charData.age && charData.ethnicity) {
    parts.push(`a ${charData.age} year old ${charData.ethnicity} ${genderWord}`);
  } else if (charData.ethnicity) {
    parts.push(`a ${charData.ethnicity} ${genderWord}`);
  } else {
    parts.push(`a ${genderWord}`);
  }

  if (charData.skinTone) parts.push(`${charData.skinTone} skin`);

  if (charData.hairColor && charData.hairStyle) {
    parts.push(`${charData.hairColor} ${charData.hairStyle}`);
  } else if (charData.hairStyle) {
    parts.push(charData.hairStyle);
  }

  // Keep body type concise — strip emphasis weights like (word:1.5) which SDXL CLIP
  // doesn't support, and condense to essential terms to preserve token budget for scene tags.
  if (charData.bodyType) {
    const cleaned = charData.bodyType
      .replace(/\([^)]*:\d+\.?\d*\)/g, '') // strip "(word:1.5)" emphasis
      .replace(/,(\s*,)+/g, ',')           // collapse consecutive commas
      .replace(/\s*,\s*/g, ', ')           // normalize comma spacing
      .replace(/^\s*,\s*|\s*,\s*$/g, '')   // trim leading/trailing commas
      .trim();
    if (cleaned) parts.push(cleaned);
  }

  return parts.join(', ');
}

/**
 * Assemble the full positive prompt for Juggernaut Ragnarok.
 *
 * Component order matters — earlier tokens get more weight.
 * Enforces the 75-token CLIP limit by truncating scene tags if needed.
 */
export function buildPositivePrompt(opts: {
  qualityPrefix: string;
  characterTags: string;
  secondaryCharacterTags?: string;
  sceneTags: string;
  triggerWords: string[];
  mode: ContentMode;
}): string {
  const parts: string[] = [opts.qualityPrefix];

  // LoRA trigger words must appear early for strong activation
  for (const trigger of opts.triggerWords) {
    parts.push(trigger);
  }

  // Character identity — skip if it's already covered by a trigger word
  const charTagIsJustTrigger = opts.triggerWords.includes(opts.characterTags);
  if (!charTagIsJustTrigger) {
    parts.push(opts.characterTags);
  }
  if (opts.secondaryCharacterTags) {
    const secIsJustTrigger = opts.triggerWords.includes(opts.secondaryCharacterTags);
    if (!secIsJustTrigger) {
      parts.push(opts.secondaryCharacterTags);
    }
  }

  // Calculate remaining token budget for scene tags
  const prefixText = parts.filter(Boolean).join(', ');
  const prefixTokens = estimateClipTokens(prefixText);
  const sceneTokenBudget = CLIP_TOKEN_LIMIT - prefixTokens - 2; // 2 token safety margin

  // Truncate scene tags to fit within budget
  let sceneTags = opts.sceneTags;
  const sceneTokens = estimateClipTokens(sceneTags);
  if (sceneTokens > sceneTokenBudget && sceneTokenBudget > 0) {
    const tagList = sceneTags.split(',').map(t => t.trim()).filter(Boolean);
    const truncated: string[] = [];
    let runningTokens = 0;
    for (const tag of tagList) {
      const tagTokens = estimateClipTokens(tag) + 1; // +1 for the comma separator
      if (runningTokens + tagTokens > sceneTokenBudget) break;
      truncated.push(tag);
      runningTokens += tagTokens;
    }
    sceneTags = truncated.join(', ');
    console.warn(
      `[PromptBuilder] Scene tags truncated from ~${sceneTokens} to ~${runningTokens} tokens ` +
      `(budget: ${sceneTokenBudget}, prefix used: ${prefixTokens}). ` +
      `Dropped: ${tagList.length - truncated.length} tags`,
    );
  }

  parts.push(sceneTags);

  return parts.filter(Boolean).join(', ');
}

/**
 * Convert a prose scene prompt to Ragnarok-optimized format using Claude.
 *
 * SFW: natural language with explicit clothing descriptions
 * NSFW: natural language scene + Booru tags for anatomical precision
 *
 * Returns the original prompt if conversion fails.
 *
 * @param tokenBudget - Maximum tokens for the scene portion (default 60).
 *   The caller should subtract prefix/trigger/identity tokens from the 75-token CLIP limit.
 */
export async function convertProseToPrompt(
  prosePrompt: string,
  opts: { nsfw: boolean; tokenBudget?: number },
): Promise<string> {
  const trimmed = prosePrompt.trim();
  if (!trimmed) return trimmed;

  const budget = opts.tokenBudget ?? 60;

  const systemPrompt = opts.nsfw
    ? `You convert scene descriptions into image generation prompts for a photorealistic SDXL model.
Output concise comma-separated tags under ${budget} tokens. Use natural language for the scene, booru-style tags for anatomical positioning.

PRIORITY ORDER (most important first):
1. SETTING — preserve the EXACT location, venue, and environment described (e.g., "mechanic workshop", "shebeen bathroom", "township bedroom"). Never generalize.
2. KEY PROPS — include specific objects mentioned (e.g., "Toyota car", "beer bottles", "workbench", "corrugated iron wall")
3. POSE & BODY POSITIONING — specific action, hand placement, body contact, who is where
4. LIGHTING — name the specific light source (e.g., "single work lamp", "neon beer signs", "moonlight through curtains"), not generic "dramatic lighting"
5. COMPOSITION — shot type and camera angle as described
6. EXPRESSION — facial expression and gaze direction

For explicit content: be anatomically specific — specify positions, hand placement, who is where.
Do NOT include: quality tags, character identity (hair, skin, body — handled by LoRA), character count tags (1girl/1boy).
Output ONLY the prompt tags, nothing else.`
    : `You convert scene descriptions into image generation prompts for a photorealistic SDXL model.
Output concise comma-separated tags under ${budget} tokens. Use natural language.

PRIORITY ORDER (most important first):
1. CLOTHING — CRITICAL: Always include specific clothing descriptions. The model defaults toward nudity without them. Use exact clothing from the description (e.g., "grease-stained overalls", "fitted blazer and tailored trousers", "nurse's uniform under open jacket").
2. SETTING — preserve the EXACT location described (e.g., "mechanic workshop in Middelburg", "township shebeen interior", "dusty construction lot"). Never generalize.
3. KEY PROPS — include specific objects mentioned (e.g., "tools on workbench", "beer bottle", "phone screen illuminating face")
4. POSE & ACTION — specific action being performed, hand positions, body positioning
5. LIGHTING — name the specific light source (e.g., "golden hour light through bay door", "neon beer signs", "single streetlight"), not generic terms
6. COMPOSITION — shot type and camera angle as described
7. EXPRESSION — facial expression and gaze direction

Do NOT include: quality tags, character identity (hair, skin, body — handled by LoRA), nudity or explicit content, character count tags (1girl/1boy).
Output ONLY the prompt tags, nothing else.`;

  try {
    const anthropic = new Anthropic();
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: trimmed }],
    });

    const tags = message.content[0].type === 'text' ? message.content[0].text.trim() : trimmed;
    return tags;
  } catch (err) {
    console.error('[PromptBuilder] Prose conversion failed, using original:', err);
    return trimmed;
  }
}

/**
 * Get dimensions for generation based on orientation and character count.
 */
export function getDimensions(
  orientation: 'portrait' | 'landscape' | 'square',
  hasDualCharacters: boolean,
): { width: number; height: number } {
  if (hasDualCharacters) {
    return { width: 1216, height: 832 };
  }

  switch (orientation) {
    case 'portrait':
      return { width: 832, height: 1216 };
    case 'landscape':
      return { width: 1216, height: 832 };
    case 'square':
      return { width: 1024, height: 1024 };
  }
}

/**
 * Get identity-related phrases to strip from training captions.
 *
 * The trigger word should carry identity — these phrases are stripped
 * so the model learns them from images, not text.
 */
export function getIdentityPhrasesToRemove(characterData: {
  hairColor: string;
  hairStyle: string;
  eyeColor: string;
  skinTone: string;
  bodyType: string;
  ethnicity: string;
}): string[] {
  const phrases: string[] = [];

  if (characterData.hairColor) {
    phrases.push(`${characterData.hairColor} hair`, characterData.hairColor);
  }
  if (characterData.hairStyle) phrases.push(characterData.hairStyle);
  if (characterData.eyeColor) phrases.push(`${characterData.eyeColor} eyes`);
  if (characterData.skinTone) {
    phrases.push(`${characterData.skinTone} skin`, characterData.skinTone);
  }
  if (characterData.bodyType) {
    phrases.push(characterData.bodyType);
    const bodyParts = characterData.bodyType.split(',').map(s => s.trim());
    phrases.push(...bodyParts);
  }
  if (characterData.ethnicity) {
    phrases.push(characterData.ethnicity, characterData.ethnicity.toLowerCase());
  }

  // Common identity phrases that should be learned from images
  phrases.push(
    'dark skin', 'dark-skinned', 'light skin', 'light-skinned',
    'medium-brown skin', 'brown skin',
    'curvy', 'curvaceous', 'voluptuous', 'slim', 'athletic', 'muscular',
    'african', 'black', 'south african',
  );

  return phrases.filter(Boolean);
}

// ── Generic Utilities (existing) ──

/** Generate a default body description for a character based on gender and body type. */
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
