export type ModelTier = 'standard' | 'premium' | 'budget' | 'maximum';
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
    tier: 'standard',
    strengths: ['diversity', 'realism'],
    fileSizeMb: 6500,
    description: 'Best balance of quality, diversity, and cost. Default model.',
    installed: true,
  },
  {
    name: 'RealVisXL V5.0',
    filename: 'realvisxl-v5.safetensors',
    tier: 'premium',
    strengths: ['portrait', 'skin_detail'],
    fileSizeMb: 6800,
    description: 'Premium model for character portraits. Superior face and skin rendering.',
    installed: true,
  },
  {
    name: 'epiCRealism XL',
    filename: 'epicrealism-xl.safetensors',
    tier: 'budget',
    strengths: ['realism'],
    fileSizeMb: 6500,
    description: 'Budget-friendly photorealistic model.',
    installed: true,
  },
  {
    name: 'CyberRealistic XL v9.0',
    filename: 'cyberrealistic-xl-v9.safetensors',
    tier: 'maximum',
    strengths: ['portrait', 'skin_detail', 'realism'],
    fileSizeMb: 6800,
    description: 'Maximum quality photorealistic model.',
    installed: true,
  },
];

export const DEFAULT_MODEL = 'juggernaut-x-v10.safetensors';

export function getModelByFilename(filename: string): ModelEntry | undefined {
  return MODEL_REGISTRY.find((m) => m.filename === filename);
}

export function getInstalledModels(): ModelEntry[] {
  return MODEL_REGISTRY.filter((m) => m.installed);
}

export function getModelsByTier(tier: ModelTier): ModelEntry[] {
  return MODEL_REGISTRY.filter((m) => m.tier === tier);
}
