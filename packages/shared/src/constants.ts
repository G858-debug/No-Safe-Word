import type {
  AspectRatio,
  CharacterData,
  GenerationSettings,
  ModelPreset,
  SceneData,
  SchedulerOption,
} from "./types";

export const ASPECT_RATIOS: AspectRatio[] = [
  { label: "Square (512x512)", width: 512, height: 512 },
  { label: "Square (1024x1024)", width: 1024, height: 1024 },
  { label: "Portrait (512x768)", width: 512, height: 768 },
  { label: "Portrait (768x1152)", width: 768, height: 1152 },
  { label: "Landscape (768x512)", width: 768, height: 512 },
  { label: "Landscape (1152x768)", width: 1152, height: 768 },
  { label: "Wide (1216x832)", width: 1216, height: 832 },
  { label: "Tall (832x1216)", width: 832, height: 1216 },
];

/** @deprecated SDXL models removed — Kontext uses a single model */
export const MODEL_PRESETS: ModelPreset[] = [];

/** @deprecated SDXL schedulers removed — Kontext uses euler/simple */
export const SCHEDULERS: SchedulerOption[] = [];

/** @deprecated SDXL generation defaults — kept for dashboard backward compat */
export const DEFAULT_SETTINGS: GenerationSettings = {
  modelUrn: "",
  width: 832,
  height: 1216,
  steps: 20,
  cfgScale: 1,
  scheduler: "euler",
  seed: -1,
  clipSkip: 1,
  batchSize: 1,
};

export const DEFAULT_CHARACTER: CharacterData = {
  name: "",
  gender: "female",
  ethnicity: "",
  bodyType: "",
  hairColor: "",
  hairStyle: "",
  eyeColor: "",
  skinTone: "",
  distinguishingFeatures: "",
  clothing: "",
  pose: "",
  expression: "",
  age: "young adult",
};

export const DEFAULT_SCENE: SceneData = {
  mode: "sfw",
  setting: "",
  lighting: "",
  mood: "",
  sfwDescription: "",
  nsfwDescription: "",
  additionalTags: [],
};
