import type { SceneClassification, InteractionType } from './scene-classifier';

export interface CompositionResult {
  /** The prompt with composition cues injected (or original if no augmentation needed) */
  augmentedPrompt: string;
  /** Whether any composition cues were injected */
  wasAugmented: boolean;
  /** List of injected composition cue strings (for logging) */
  injectedCues: string[];
}

/**
 * Spatial composition cues mapped to interaction types.
 * These help SDXL position two characters in a scene when the prompt
 * lacks explicit spatial layout instructions.
 */
const COMPOSITION_BY_INTERACTION: Record<InteractionType, string[]> = {
  intimate: [
    'close proximity',
    'bodies touching',
    'faces inches apart',
  ],
  romantic: [
    'leaning toward each other',
    'soft eye contact between them',
    'two-shot composition',
  ],
  conversational: [
    'seated facing each other',
    'medium two-shot',
    'natural conversation distance',
  ],
  confrontational: [
    'facing each other across the frame',
    'symmetrical composition',
    'eye-level two-shot',
  ],
  'side-by-side': [
    'standing side by side',
    'shoulder to shoulder',
    'medium two-shot',
  ],
  observing: [
    'one figure in foreground',
    'other in background',
    'depth separation between subjects',
  ],
  unknown: [
    'two people in frame',
    'medium two-shot',
  ],
};

/**
 * Shot type recommendations when the prompt lacks explicit framing.
 */
const SHOT_TYPE_SUGGESTIONS: Partial<Record<InteractionType, string>> = {
  intimate: 'close-up two-shot',
  romantic: 'medium close-up two-shot',
  conversational: 'medium shot',
  confrontational: 'medium wide two-shot',
  observing: 'wide shot with depth',
};

/**
 * Augment a scene prompt with spatial composition cues for dual-character scenes.
 *
 * Only activates when:
 * - The scene has 2 characters (characterCount === 2)
 * - The prompt does NOT already contain spatial composition cues
 *
 * Injects composition terms based on the detected interaction type,
 * plus a shot type recommendation if the prompt lacks one.
 */
export function augmentComposition(
  scenePrompt: string,
  classification: SceneClassification,
): CompositionResult {
  // Only augment dual-character scenes without existing composition cues
  if (classification.characterCount !== 2 || classification.hasCompositionCues) {
    return {
      augmentedPrompt: scenePrompt,
      wasAugmented: false,
      injectedCues: [],
    };
  }

  const cues = COMPOSITION_BY_INTERACTION[classification.interactionType] || COMPOSITION_BY_INTERACTION.unknown;
  const injectedCues = [...cues];

  // Add shot type suggestion if the prompt doesn't specify one
  const hasExplicitShot = /\b(?:close-up|closeup|medium shot|wide shot|two-shot|two shot|full body|headshot)\b/i.test(scenePrompt);
  if (!hasExplicitShot) {
    const shotSuggestion = SHOT_TYPE_SUGGESTIONS[classification.interactionType];
    if (shotSuggestion) {
      injectedCues.push(shotSuggestion);
    }
  }

  const augmentedPrompt = `${scenePrompt}, ${injectedCues.join(', ')}`;

  return {
    augmentedPrompt,
    wasAugmented: true,
    injectedCues,
  };
}
