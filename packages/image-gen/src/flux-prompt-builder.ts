/**
 * Flux-native prompt builder.
 *
 * Assembles natural-language prompts optimised for Flux's T5 text encoder.
 * Eliminates the need for the LLM rewriter in the common case where the
 * identity prefix is already prose (from buildKontextIdentityPrefix) and
 * scene prompts don't contain heavy SDXL formatting.
 *
 * Also provides a deterministic SDXL syntax stripper that can pre-clean
 * prompts before the optional LLM rewriter, making it cheaper and more reliable.
 */

// ── SDXL quality tags to strip (case-insensitive) ──
const SDXL_QUALITY_TAGS = [
  'masterpiece', 'best quality', 'ultra detailed', 'highly detailed',
  'photorealistic', 'RAW photo', '8k', '8k uhd', '4k', 'dslr',
  'film grain', 'sharp focus', 'intricate details', 'professional photography',
  'professional erotic photography', 'cinematic lighting', 'intimate atmosphere',
];

// Build a regex that matches any of the quality tags as whole phrases,
// optionally wrapped in SDXL emphasis syntax like (tag:1.3)
const qualityTagPattern = new RegExp(
  '\\(?(' +
  SDXL_QUALITY_TAGS.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') +
  ')(?::[0-9.]+)?\\)?' +
  '[,\\s]*',
  'gi',
);

/**
 * Strip SDXL emphasis weight syntax: (tag:1.3) → tag
 * Handles nested parens and multiple weights.
 */
export function stripEmphasisWeights(prompt: string): string {
  // Match (content:weight) where weight is a decimal number
  // Repeat until no more matches (handles nested cases)
  let result = prompt;
  let prev = '';
  while (result !== prev) {
    prev = result;
    result = result.replace(/\(([^()]+):(\d+\.?\d*)\)/g, '$1');
  }
  return result;
}

/**
 * Strip SDXL quality tags (masterpiece, best quality, 8k uhd, etc.)
 */
export function stripQualityTags(prompt: string): string {
  return prompt.replace(qualityTagPattern, '').trim();
}

/**
 * Deterministic SDXL syntax cleanup for Flux prompts.
 *
 * Strips emphasis weights, quality tags, and cleans up artifacts.
 * This is fast, free, and deterministic — no LLM call needed.
 * Run this before the optional LLM rewriter to reduce its workload,
 * or use it standalone when the prompt is already mostly natural language.
 */
export function stripSdxlSyntax(prompt: string): string {
  let result = prompt;

  // 1. Strip emphasis weights: (tag:1.3) → tag
  result = stripEmphasisWeights(result);

  // 2. Strip quality tags
  result = stripQualityTags(result);

  // 3. Strip SFW clothing enforcement tag
  result = result.replace(/\bwearing clothes\b[,\s]*/gi, '');

  // 4. Clean up artifacts
  result = result
    .replace(/,(\s*,)+/g, ',')        // collapse multiple commas
    .replace(/^\s*[,.\s]+/, '')        // leading punctuation
    .replace(/[,.\s]+\s*$/, '')        // trailing punctuation
    .replace(/\s{2,}/g, ' ')          // collapse whitespace
    .trim();

  return result;
}

/**
 * Detect whether a prompt contains significant SDXL formatting that
 * would benefit from LLM rewriting beyond what stripSdxlSyntax handles.
 *
 * Returns true if the prompt has heavy tag-list formatting (many commas,
 * short fragments) that would read better as natural language.
 */
export function hasHeavySdxlFormatting(prompt: string): boolean {
  // Count comma-separated segments
  const segments = prompt.split(',').map(s => s.trim()).filter(Boolean);
  if (segments.length < 5) return false;

  // If most segments are short (< 6 words), it's tag-list style
  const shortSegments = segments.filter(s => s.split(/\s+/).length < 6);
  return shortSegments.length / segments.length > 0.6;
}

// ── Sensuality Enhancement ──

/**
 * Inject female attractiveness enhancement as natural-language prose.
 *
 * Flux equivalent of SDXL's `injectFemaleEnhancement()` — since Flux has no
 * emphasis weights and no negative prompts, all attractiveness enforcement
 * must come from vivid positive prose that T5 can understand.
 *
 * Appends beauty/body sentences to the identity prefix so T5 processes
 * them as part of the character description block.
 *
 * @param identityPrefix - The prose identity prefix (from buildKontextIdentityPrefix)
 * @param mode - 'sfw' or 'nsfw'
 * @param scenePrompt - Raw scene prompt (checked for creative overrides)
 * @returns Enhanced identity prefix with beauty/body prose appended
 */
export function injectFluxFemaleEnhancement(
  identityPrefix: string,
  mode: 'sfw' | 'nsfw',
  scenePrompt: string,
): string {
  // Respect deliberate creative choices for loose clothing
  if (/\b(?:baggy|loose|oversized)\b/i.test(scenePrompt)) return identityPrefix;

  if (mode === 'sfw') {
    return identityPrefix.trimEnd() +
      ' She is strikingly beautiful with flawless skin, perfect makeup, and a confident alluring presence.\n';
  }

  // NSFW: full body + beauty enhancement
  return identityPrefix.trimEnd() +
    ' She is stunningly beautiful with flawless glowing skin, perfect makeup, and a seductive alluring presence.' +
    ' Her voluptuous body is accentuated — full round breasts, slim waist, wide hips, thick thighs, and smooth skin that catches the light.\n';
}

/**
 * Enhance gaze/expression descriptions with evocative prose for Flux.
 *
 * SDXL uses emphasis weights (1.4 for direct camera gaze). Flux's T5 encoder
 * responds to specificity and descriptive detail instead. This function
 * enriches bare gaze instructions with sensual prose that T5 prioritises.
 */
export function injectFluxGazeEmphasis(prompt: string): string {
  let result = prompt;

  // Direct camera gaze — the most powerful sensuality device
  result = result.replace(
    /looking directly (?:at|into) the camera/gi,
    'looking directly into the camera with intense, inviting eyes',
  );

  // Eye contact
  result = result.replace(
    /\beye contact\b(?! with)/gi,
    'deep eye contact with a magnetic intensity',
  );

  // Seductive expressions
  result = result.replace(
    /\bseductive (?:smile|half-smile|grin)\b/gi,
    (m) => `slow ${m} with slightly parted lips`,
  );

  // Eyes closed — intimate vulnerability
  result = result.replace(
    /\beyes closed\b/gi,
    'eyes gently closed, lips slightly parted, lost in the moment',
  );

  // Looking at the other person — interpersonal tension
  result = result.replace(
    /looking at the other person/gi,
    'gazing intently at the other person with unmistakable desire',
  );

  // Looking down — demure/suggestive
  result = result.replace(
    /\blooking down\b/gi,
    'looking down with a demure, suggestive expression',
  );

  return result;
}

/**
 * Generate a photography-style atmosphere suffix for Flux prompts.
 *
 * Replaces the stripped SDXL quality tags (cinematic lighting, 8k uhd, etc.)
 * with Flux-native prose that achieves the same effect — guiding the model
 * toward high-quality, sensual output.
 */
export function buildFluxAtmosphereSuffix(
  mode: 'sfw' | 'nsfw',
  hasDualCharacter: boolean,
): string {
  if (mode === 'sfw') {
    return 'Professional fashion photography with warm flattering light, shallow depth of field, and magazine-quality composition.';
  }

  if (hasDualCharacter) {
    return 'The chemistry between them is palpable. Intimate photography with warm golden light, soft focus on skin, and sensual atmosphere. Cinematic quality with rich warm tones.';
  }

  return 'Intimate boudoir photography with warm golden light, soft shadows accentuating curves, and a sensual atmosphere. The image has a cinematic quality with rich warm tones.';
}

/**
 * Build a Flux-native prompt from identity prefix + scene prompt.
 *
 * Strips SDXL syntax, enhances gaze descriptions, adds atmosphere suffix,
 * and flags whether LLM rewriting is still needed.
 *
 * @returns { prompt, needsLlmRewrite } — the assembled prompt and whether
 *          the LLM rewriter should be invoked for further improvement.
 */
export function buildFluxPrompt(
  identityPrefix: string,
  scenePrompt: string,
  opts?: { mode?: 'sfw' | 'nsfw'; hasDualCharacter?: boolean },
): { prompt: string; needsLlmRewrite: boolean } {
  const mode = opts?.mode || 'sfw';
  const hasDualCharacter = opts?.hasDualCharacter || false;

  // Always strip SDXL syntax deterministically
  let cleanedScene = stripSdxlSyntax(scenePrompt);

  // Enhance gaze/expression descriptions with evocative prose
  cleanedScene = injectFluxGazeEmphasis(cleanedScene);

  // Check if the cleaned scene still reads like a tag list
  const needsLlmRewrite = hasHeavySdxlFormatting(cleanedScene);

  // Assemble: identity paragraph + scene content + atmosphere suffix
  const parts: string[] = [];
  if (identityPrefix.trim()) {
    parts.push(identityPrefix.trim());
  }
  parts.push(cleanedScene);
  parts.push(buildFluxAtmosphereSuffix(mode, hasDualCharacter));

  return {
    prompt: parts.join('\n'),
    needsLlmRewrite,
  };
}
