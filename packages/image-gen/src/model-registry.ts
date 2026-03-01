export type ModelTier = 'standard' | 'premium' | 'maximum';
export type ModelStrength = 'diversity' | 'portrait' | 'realism' | 'skin_detail';

export interface ModelEntry {
  name: string;
  filename: string;
  tier: ModelTier;
  strengths: ModelStrength[];
  fileSizeMb: number;
  description: string;
  /** Whether this model is installed on the RunPod instance */
  installed: boolean;
}

export const MODEL_REGISTRY: ModelEntry[] = [
  {
    name: 'Juggernaut XL v10 Ragnarok',
    filename: 'juggernaut-x-v10.safetensors',
    tier: 'premium',
    strengths: ['diversity', 'realism'],
    fileSizeMb: 6500,
    description: 'Strong diversity and realism. Previously the default model.',
    installed: true,
  },
  {
    name: 'RealVisXL V5.0',
    filename: 'realvisxl-v5.safetensors',
    tier: 'standard',
    strengths: ['portrait', 'skin_detail', 'diversity'],
    fileSizeMb: 6800,
    description: 'Default model. Superior face, skin, and portrait rendering. Includes Juggernaut XL merge.',
    installed: true,
  },
  {
    name: 'Lustify V5 Endgame',
    filename: 'lustify-v5-endgame.safetensors',
    tier: 'maximum',
    strengths: ['realism', 'skin_detail'],
    fileSizeMb: 6500,
    description: 'Purpose-built NSFW photorealism. Superior anatomy, lighting, and skin rendering for intimate scenes.',
    installed: true,
  },
];

export const DEFAULT_MODEL = 'realvisxl-v5.safetensors';

export function getModelByFilename(filename: string): ModelEntry | undefined {
  return MODEL_REGISTRY.find((m) => m.filename === filename);
}

export function getInstalledModels(): ModelEntry[] {
  return MODEL_REGISTRY.filter((m) => m.installed);
}

export function getModelsByTier(tier: ModelTier): ModelEntry[] {
  return MODEL_REGISTRY.filter((m) => m.tier === tier);
}
