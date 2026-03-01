import { condensedCharacterTags } from './prompt-builder';

export interface DecomposedPrompt {
  /** Pass 1: Scene layout, setting, lighting, poses — no character identity */
  scenePrompt: string;
  /** Pass 2: Primary character identity tags (condensed) */
  primaryIdentityPrompt: string;
  /** Pass 2: Secondary character identity tags (condensed, if dual-character) */
  secondaryIdentityPrompt?: string;
  /** Pass 3: Full assembled prompt (same as what's already being used) */
  fullPrompt: string;

  // --- Regional Prompting (AttentionCouplePPM) ---
  // These are populated by the AI optimizer for dual-character scenes.
  // When present, Pass 1 uses AttentionCouplePPM for regional conditioning.

  /** Shared background: setting, lighting, atmosphere, camera angle — no character-specific content */
  sharedScenePrompt?: string;
  /** Primary character's spatial region: their gender, pose, action, clothing, position */
  primaryRegionPrompt?: string;
  /** Secondary character's spatial region: their gender, pose, action, clothing, position */
  secondaryRegionPrompt?: string;
}

/**
 * Known quality prefix/suffix patterns that buildStoryImagePrompt injects.
 * These should be stripped from the scene prompt since each pass handles
 * quality tags independently.
 */
const QUALITY_PATTERNS = [
  /\(photorealistic(?::\d+\.?\d*)?\)\s*,?\s*/gi,
  /\(masterpiece(?::\d+\.?\d*)?\)\s*,?\s*/gi,
  /\(cinematic lighting(?::\d+\.?\d*)?\)\s*,?\s*/gi,
  /\(intimate atmosphere(?::\d+\.?\d*)?\)\s*,?\s*/gi,
  /\b8k\s*uhd\b\s*,?\s*/gi,
  /\bmasterpiece\b\s*,?\s*/gi,
  /\bbest quality\b\s*,?\s*/gi,
  /\bphotorealistic\b\.?\s*,?\s*/gi,
  /\bhighly detailed\b\s*,?\s*/gi,
  /\bprofessional photography\b\s*,?\s*/gi,
  /\bRAW photo\b\s*,?\s*/gi,
  /\bultra detailed\b\s*,?\s*/gi,
];

/**
 * Trigger word patterns to strip from scene prompts.
 * Character LoRA trigger words are typically short tokens like "tok".
 */
const TRIGGER_WORD_PATTERN = /\btok\b\s*,?\s*/gi;

/**
 * Female enhancement patterns injected by buildStoryImagePrompt.
 * These belong in Pass 3 (full prompt), not the scene prompt.
 */
const ENHANCEMENT_PATTERNS = [
  /\(beautiful face(?::\d+\.?\d*)?\)\s*,?\s*/gi,
  /\(curvaceous figure(?::\d+\.?\d*)?\)\s*,?\s*/gi,
  /\(showing cleavage(?::\d+\.?\d*)?\)\s*,?\s*/gi,
  /\(attractive(?::\d+\.?\d*)?\)\s*,?\s*/gi,
  /\(wearing clothes(?::\d+\.?\d*)?\)\s*,?\s*/gi,
];

/**
 * "second person:" prefix used in dual-character prompt assembly.
 */
const SECOND_PERSON_PATTERN = /,?\s*second person:\s*/i;

/**
 * Decompose a full image prompt into the components needed for multi-pass generation.
 *
 * The full prompt (from buildStoryImagePrompt) has this structure:
 *   [quality prefix], [trigger words], [condensed primary tags], [sfw clothing],
 *   [SCENE], [secondary: condensed tags], [enhancement], [quality suffix]
 *
 * This function extracts the scene portion by stripping everything else,
 * and builds condensed identity prompts from the character tags.
 *
 * @param fullPrompt - The complete assembled prompt
 * @param primaryCharacterTags - The approved character tags string (before condensing)
 * @param secondaryCharacterTags - The approved secondary character tags string (optional)
 * @returns Decomposed prompt components for multi-pass workflow
 */
export function decomposePrompt(
  fullPrompt: string,
  primaryCharacterTags?: string | null,
  secondaryCharacterTags?: string | null,
): DecomposedPrompt {
  // Build condensed identity prompts from the raw character tags
  const primaryCondensed = primaryCharacterTags
    ? condensedCharacterTags(primaryCharacterTags)
    : '';
  const secondaryCondensed = secondaryCharacterTags
    ? condensedCharacterTags(secondaryCharacterTags)
    : undefined;

  // Extract the scene prompt by stripping character tags, quality tags, and enhancements
  let scene = fullPrompt;

  // Strip quality prefix/suffix patterns
  for (const pattern of QUALITY_PATTERNS) {
    scene = scene.replace(pattern, ' ');
  }

  // Strip trigger words
  scene = scene.replace(TRIGGER_WORD_PATTERN, ' ');

  // Strip enhancement patterns
  for (const pattern of ENHANCEMENT_PATTERNS) {
    scene = scene.replace(pattern, ' ');
  }

  // Strip the condensed character tag blocks by finding them in the text
  // The condensed tags are what buildStoryImagePrompt actually embeds
  if (primaryCondensed) {
    // Escape special regex characters in the condensed tags
    const escaped = escapeRegex(primaryCondensed);
    scene = scene.replace(new RegExp(escaped + '\\s*,?\\s*', 'i'), ' ');
  }

  if (secondaryCondensed) {
    // The secondary tags appear after "second person:" prefix
    scene = scene.replace(SECOND_PERSON_PATTERN, ' ');
    const escaped = escapeRegex(secondaryCondensed);
    scene = scene.replace(new RegExp(escaped + '\\s*,?\\s*', 'i'), ' ');
  }

  // Clean orphaned weight syntax left after word stripping: "( :1.1)" or "(:1.3)"
  scene = scene.replace(/\(\s*:[\d.]+\)\s*,?\s*/g, '');
  // Clean empty parentheses
  scene = scene.replace(/\(\s*\)\s*,?\s*/g, '');

  // Clean up artifacts from stripping
  scene = scene
    .replace(/,(\s*,)+/g, ',')      // collapse multiple commas
    .replace(/^\s*[,.\s]+/, '')      // leading comma/period/whitespace
    .replace(/[,.\s]+\s*$/, '')      // trailing comma/period/whitespace
    .replace(/\s{2,}/g, ' ')        // collapse whitespace
    .trim();

  // Add trigger words to identity prompts so LoRAs activate during Pass 2
  const primaryIdentity = primaryCondensed
    ? `tok, ${primaryCondensed}`
    : 'tok';
  const secondaryIdentity = secondaryCondensed
    ? `tok, ${secondaryCondensed}`
    : undefined;

  return {
    scenePrompt: scene,
    primaryIdentityPrompt: primaryIdentity,
    secondaryIdentityPrompt: secondaryIdentity,
    fullPrompt,
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
