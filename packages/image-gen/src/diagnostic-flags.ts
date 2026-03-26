/**
 * Diagnostic flags for isolating individual scene generation components.
 *
 * When all flags are true (default), the pipeline behaves normally.
 * Setting a flag to false disables that component, allowing the user
 * to isolate what each resource contributes to the final image.
 */
export interface DiagnosticFlags {
  /** Trained character LoRA(s) — identity at 0.65 strength */
  characterLora: boolean;
  /** PuLID face refinement pass */
  pulid: boolean;
  /** Prose character description injected into prompt (ethnicity, body, hair, eyes) */
  identityPrefix: boolean;
  /** All prompt processing: SDXL cleanup, gaze emphasis, atmosphere suffix, LLM rewrite */
  promptEnhancement: boolean;
  /** Beauty/body prose for female characters in identity prefix */
  femaleEnhancement: boolean;
  /** Slot 1: flux_realism_lora (0.7) */
  realismLora: boolean;
  /** Slots 2, 3, 5, 7 + ethnicity: style, skin, kissing/NSFW, cinematic, African Woman */
  styleLoras: boolean;
  /** Slot 4: BodyLicious or Hourglass (female only) */
  bodyShapeLora: boolean;
}

export const DEFAULT_DIAGNOSTIC_FLAGS: DiagnosticFlags = {
  characterLora: true,
  pulid: true,
  identityPrefix: true,
  promptEnhancement: true,
  femaleEnhancement: true,
  realismLora: true,
  styleLoras: true,
  bodyShapeLora: true,
};
