export interface CharacterData {
  name: string;
  gender: "male" | "female" | "non-binary" | "other";
  ethnicity: string;
  bodyType: string;
  hairColor: string;
  hairStyle: string;
  eyeColor: string;
  skinTone: string;
  distinguishingFeatures: string;
  clothing: string;
  pose: string;
  expression: string;
  age: string;
}

export interface SceneData {
  mode: "sfw" | "nsfw";
  setting: string;
  lighting: string;
  mood: string;
  sfwDescription: string;
  nsfwDescription: string;
  additionalTags: string[];
}

export interface GenerationSettings {
  modelUrn: string;
  width: number;
  height: number;
  steps: number;
  cfgScale: number;
  scheduler: string;
  seed: number;
  clipSkip: number;
  batchSize: number;
}

export interface GeneratedImage {
  id: string;
  jobId: string;
  blobUrl: string;
  blobUrlExpiration: string;
  prompt: string;
  negativePrompt: string;
  settings: GenerationSettings;
  createdAt: string;
  status: "pending" | "processing" | "completed" | "failed";
}

export interface AspectRatio {
  label: string;
  width: number;
  height: number;
}

export interface ModelPreset {
  name: string;
  urn: string;
  type: string;
  description: string;
}

export interface SchedulerOption {
  label: string;
  value: string;
}
