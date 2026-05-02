/**
 * Shared prompt-assembly constants. Kept in their own module with NO other
 * imports so client components can pull `stripPortraitFraming` /
 * `buildSceneCharacterBlockFromLocked` (in portrait-prompt-builder.ts)
 * without the bundler reaching into Node-only generator code (Replicate
 * SDK, RunPod helpers, etc.).
 */

/** Cinematic "look" suffix appended to every assembled prompt. */
export const VISUAL_SIGNATURE =
  "Cinematic shallow depth of field. Rich shadows with luminous highlights. Soft skin glow. Intimate framing. Editorial photography quality. Photorealistic.";

/** Framing/lighting clause for a face portrait (medium close-up). */
export const PORTRAIT_COMPOSITION =
  "Portrait, looking directly at the camera with a confident expression. Warm side-lighting, dark background with soft bokeh. Medium close-up, eye-level.";
