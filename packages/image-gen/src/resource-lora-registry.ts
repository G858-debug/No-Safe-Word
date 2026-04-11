/**
 * Resource LoRA Registry — pose/style/composition LoRAs that enhance generation.
 *
 * Unlike character LoRAs (per-character, trained in-house), resource LoRAs are
 * generic models downloaded from CivitAI or similar sources that help with
 * specific scene challenges (kissing, multi-person composition, etc.).
 *
 * Resource LoRAs are auto-selected based on prompt keywords and injected
 * alongside character LoRAs in the ComfyUI workflow (max 8 total LoRAs).
 */

// ── Types ──

export interface ResourceLora {
  id: string;
  filename: string;
  storageUrl: string;
  category: 'pose' | 'style' | 'composition';
  /** Keywords that trigger auto-selection (case-insensitive prompt matching) */
  triggerKeywords: string[];
  defaultStrengthModel: number;
  defaultStrengthClip: number;
  /** Optional trigger word to inject into the positive prompt */
  triggerWord?: string;
  /** If true, only selected for NSFW content */
  nsfwOnly: boolean;
  /** If true, auto-inject for all dual-character scenes (ignores triggerKeywords) */
  autoDualCharacter?: boolean;
}

// ── Static Registry ──
// Populated with tested LoRAs. Use registerResourceLora() to add discovered ones at runtime.

const RESOURCE_LORAS: ResourceLora[] = [
  {
    id: 'french-kiss',
    filename: 'resources/french_kiss_xl.safetensors',
    storageUrl: 'https://mqemiteirxwscxtamdtj.supabase.co/storage/v1/object/public/lora-training-datasets/resources/french_kiss_xl.safetensors',
    category: 'pose',
    triggerKeywords: [
      'kiss', 'kissing', 'mouths together', 'lips touching', 'french kiss',
      'passionate kiss', 'lips pressed', 'making out',
    ],
    defaultStrengthModel: 0.5,
    defaultStrengthClip: 0.3,
    triggerWord: 'french kiss',
    nsfwOnly: false,
  },
  {
    id: 'multi-person',
    filename: 'resources/multiple_people_sdxl.safetensors',
    storageUrl: 'https://mqemiteirxwscxtamdtj.supabase.co/storage/v1/object/public/lora-training-datasets/resources/multiple_people_sdxl.safetensors',
    category: 'composition',
    triggerKeywords: [], // uses autoDualCharacter instead — auto-inject for all dual-character scenes
    defaultStrengthModel: 0.4,
    defaultStrengthClip: 0.25,
    nsfwOnly: false,
    autoDualCharacter: true,
  },
];

// ── Selection ──

/**
 * Select resource LoRAs that match the given prompt and generation context.
 *
 * Returns LoRAs sorted by relevance (keyword matches first, then auto-dual).
 * Respects the maxSlots limit to stay within ComfyUI's 8-LoRA chain limit.
 */
export function selectResourceLoras(
  promptText: string,
  contentMode: 'sfw' | 'nsfw',
  maxSlots: number,
  isDualCharacter: boolean,
): ResourceLora[] {
  if (maxSlots <= 0) return [];

  const lower = promptText.toLowerCase();
  const selected: ResourceLora[] = [];

  for (const lora of RESOURCE_LORAS) {
    // Skip LoRAs without a storage URL (not yet downloaded)
    if (!lora.storageUrl) continue;

    // Skip NSFW-only LoRAs in SFW mode
    if (lora.nsfwOnly && contentMode === 'sfw') continue;

    // Check keyword match
    const keywordMatch = lora.triggerKeywords.length > 0 &&
      lora.triggerKeywords.some(kw => lower.includes(kw.toLowerCase()));

    // Check auto-dual-character match
    const autoDualMatch = lora.autoDualCharacter && isDualCharacter;

    if (keywordMatch || autoDualMatch) {
      selected.push(lora);
    }

    if (selected.length >= maxSlots) break;
  }

  return selected;
}

/**
 * Get a resource LoRA by its ID.
 */
export function getResourceLoraById(id: string): ResourceLora | undefined {
  return RESOURCE_LORAS.find(l => l.id === id);
}

/**
 * Get all registered resource LoRAs (for evaluation/recommendation).
 */
export function getRegisteredResourceLoras(): ResourceLora[] {
  return [...RESOURCE_LORAS];
}

/**
 * Dynamically register a new resource LoRA discovered at runtime.
 * Future generations automatically benefit from previously discovered LoRAs.
 */
export function registerResourceLora(lora: ResourceLora): void {
  // Don't register duplicates
  if (RESOURCE_LORAS.some(existing => existing.id === lora.id)) {
    console.log(`[ResourceLoRA] Already registered: ${lora.id}`);
    return;
  }
  RESOURCE_LORAS.push(lora);
  console.log(`[ResourceLoRA] Registered: ${lora.id} (${lora.category}) — ${lora.filename}`);
}
