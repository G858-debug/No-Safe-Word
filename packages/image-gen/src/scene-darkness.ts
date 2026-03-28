/**
 * Shared dark scene detection utility.
 *
 * Used by V1 and V3 pipelines to adjust PuLID weight/denoise
 * in dark/low-light scenes where the refinement pass would
 * otherwise override the scene with a bright portrait.
 */

const DARK_SCENE_KEYWORDS = /\b(dark|night(?:time)?|dim|shadow|candle|moonlight|bedroom|phone[- ]?light|blue[- ]?glow|low[- ]?light|dusk|semi-dark|unlit)\b/i;

export function detectSceneDarkness(prompt: string): boolean {
  return DARK_SCENE_KEYWORDS.test(prompt);
}
