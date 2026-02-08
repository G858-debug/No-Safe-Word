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

export const MODEL_PRESETS: ModelPreset[] = [
  {
    name: "Realistic Vision V5.1",
    urn: "urn:air:sd1:checkpoint:civitai:4201@130072",
    type: "SD1.5",
    description: "Photorealistic model, excellent for portraits",
  },
  {
    name: "DreamShaper XL",
    urn: "urn:air:sdxl:checkpoint:civitai:112902@351306",
    type: "SDXL",
    description: "Versatile SDXL model for high-quality generation",
  },
  {
    name: "Juggernaut XL",
    urn: "urn:air:sdxl:checkpoint:civitai:133005@357609",
    type: "SDXL",
    description: "High detail SDXL model with strong anatomy",
  },
];

export const SCHEDULERS: SchedulerOption[] = [
  { label: "Euler a", value: "EulerA" },
  { label: "Euler", value: "Euler" },
  { label: "DPM++ 2M Karras", value: "DPM2MKarras" },
  { label: "DPM++ SDE Karras", value: "DPMSDEKarras" },
  { label: "DPM++ 2M", value: "DPM2M" },
  { label: "DDIM", value: "DDIM" },
  { label: "LMS Karras", value: "LMSKarras" },
  { label: "UniPC", value: "UniPC" },
  { label: "LCM", value: "LCM" },
  { label: "DEIS", value: "DEIS" },
];

export const DEFAULT_SETTINGS: GenerationSettings = {
  modelUrn: "urn:air:sd1:checkpoint:civitai:4201@130072",
  width: 512,
  height: 768,
  steps: 20,
  cfgScale: 7,
  scheduler: "EulerA",
  seed: -1,
  clipSkip: 2,
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
