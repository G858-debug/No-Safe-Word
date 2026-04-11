/**
 * Resource LoRA Discovery — search CivitAI, download, and integrate LoRAs at runtime.
 *
 * When the evaluation pipeline detects a gap that a resource LoRA could fill
 * (e.g., kissing scene but no kiss LoRA available), this module searches CivitAI,
 * downloads the best match, uploads to Supabase Storage, and registers it for
 * future use.
 *
 * Safeguards:
 * - Max 1 download per retry attempt
 * - File size cap: 300MB
 * - Only .safetensors format
 * - SDXL base model only
 * - Cached: same search query won't re-download
 */

import { createClient } from '@supabase/supabase-js';
import type { ResourceLora } from './resource-lora-registry';

// ── Types ──

interface CivitAIModel {
  id: number;
  name: string;
  type: string;
  nsfw: boolean;
  modelVersions: CivitAIModelVersion[];
}

interface CivitAIModelVersion {
  id: number;
  name: string;
  baseModel: string;
  files: CivitAIFile[];
  trainedWords?: string[];
}

interface CivitAIFile {
  id: number;
  name: string;
  sizeKB: number;
  type: string;
  format: string;
  downloadUrl: string;
}

// ── Cache ──
// Prevents re-downloading the same query in a single process lifetime
const downloadCache = new Map<string, ResourceLora | null>();

// ── Constants ──
const CIVITAI_API_BASE = 'https://civitai.com/api/v1';
const MAX_FILE_SIZE_MB = 300;
const SUPABASE_RESOURCE_PATH = 'lora-training-datasets'; // bucket name
const RESOURCE_FOLDER = 'resources';

// ── Main Functions ──

/**
 * Search CivitAI for an SDXL LoRA matching the query, download it,
 * upload to Supabase Storage, and return a ResourceLora entry.
 *
 * Returns null if no suitable LoRA found or download fails.
 */
export async function searchAndDownloadLora(
  searchQuery: string,
  category: string,
): Promise<ResourceLora | null> {
  // Check cache first
  const cacheKey = `${category}:${searchQuery.toLowerCase()}`;
  if (downloadCache.has(cacheKey)) {
    console.log(`[LoRADiscovery] Cache hit for "${searchQuery}" — ${downloadCache.get(cacheKey) ? 'found' : 'not found'}`);
    return downloadCache.get(cacheKey) ?? null;
  }

  console.log(`[LoRADiscovery] Searching CivitAI for: "${searchQuery}" (category: ${category})`);

  try {
    // Search CivitAI API
    const searchUrl = `${CIVITAI_API_BASE}/models?` + new URLSearchParams({
      query: searchQuery,
      types: 'LORA',
      sort: 'Highest Rated',
      limit: '5',
    }).toString();

    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) {
      console.error(`[LoRADiscovery] CivitAI search failed: ${searchRes.status}`);
      downloadCache.set(cacheKey, null);
      return null;
    }

    const searchData = await searchRes.json();
    const models: CivitAIModel[] = searchData.items || [];

    if (models.length === 0) {
      console.log(`[LoRADiscovery] No models found for "${searchQuery}"`);
      downloadCache.set(cacheKey, null);
      return null;
    }

    // Find the best SDXL-compatible safetensors file
    for (const model of models) {
      for (const version of model.modelVersions || []) {
        // Filter for SDXL base model
        if (!version.baseModel?.includes('SDXL') && !version.baseModel?.includes('sdxl')) {
          continue;
        }

        // Find safetensors file within size limit
        const safetensorsFile = (version.files || []).find(f =>
          f.format === 'SafeTensor' &&
          f.name.endsWith('.safetensors') &&
          f.sizeKB < MAX_FILE_SIZE_MB * 1024,
        );

        if (!safetensorsFile) continue;

        console.log(
          `[LoRADiscovery] Found: "${model.name}" v${version.name} ` +
          `(${(safetensorsFile.sizeKB / 1024).toFixed(1)}MB, base: ${version.baseModel})`,
        );

        // Download the file
        const loraData = await downloadLoraFile(safetensorsFile.downloadUrl, safetensorsFile.name);
        if (!loraData) {
          console.warn(`[LoRADiscovery] Download failed for ${safetensorsFile.name}, trying next...`);
          continue;
        }

        // Validate safetensors header
        if (!validateSafetensorsHeader(loraData)) {
          console.warn(`[LoRADiscovery] Invalid safetensors header for ${safetensorsFile.name}, trying next...`);
          continue;
        }

        // Upload to Supabase Storage
        const filename = sanitizeFilename(`${category}_${model.id}_${safetensorsFile.name}`);
        const storagePath = `${RESOURCE_FOLDER}/${filename}`;
        const storageUrl = await uploadToSupabase(storagePath, loraData);

        if (!storageUrl) {
          console.error(`[LoRADiscovery] Supabase upload failed for ${filename}`);
          continue;
        }

        // Build the ResourceLora entry
        const id = `discovered-${category}-${model.id}`;
        const triggerWord = version.trainedWords?.[0] || undefined;

        const resourceLora: ResourceLora = {
          id,
          filename: `resources/${filename}`,
          storageUrl,
          category: category as ResourceLora['category'],
          triggerKeywords: searchQuery.split(/\s+/).filter(w => w.length > 2),
          defaultStrengthModel: 0.45,
          defaultStrengthClip: 0.25,
          triggerWord,
          nsfwOnly: model.nsfw,
        };

        console.log(
          `[LoRADiscovery] Successfully integrated: ${model.name} → ${filename} ` +
          `(trigger: ${triggerWord || 'none'}, ${(safetensorsFile.sizeKB / 1024).toFixed(1)}MB)`,
        );

        downloadCache.set(cacheKey, resourceLora);
        return resourceLora;
      }
    }

    console.log(`[LoRADiscovery] No suitable SDXL safetensors found for "${searchQuery}"`);
    downloadCache.set(cacheKey, null);
    return null;
  } catch (err) {
    console.error(`[LoRADiscovery] Error searching/downloading:`, err instanceof Error ? err.message : err);
    downloadCache.set(cacheKey, null);
    return null;
  }
}

// ── Helpers ──

async function downloadLoraFile(url: string, filename: string): Promise<Buffer | null> {
  try {
    console.log(`[LoRADiscovery] Downloading ${filename}...`);
    const headers: Record<string, string> = { 'User-Agent': 'NoSafeWord-Pipeline/1.0' };
    // CivitAI requires API key for some downloads
    const civitaiKey = process.env.CIVITAI_API_KEY;
    if (civitaiKey) {
      headers['Authorization'] = `Bearer ${civitaiKey}`;
    }
    const res = await fetch(url, {
      headers,
      redirect: 'follow',
    });

    if (!res.ok) {
      console.error(`[LoRADiscovery] Download failed: ${res.status} ${res.statusText}`);
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Check file size
    const sizeMB = buffer.length / (1024 * 1024);
    if (sizeMB > MAX_FILE_SIZE_MB) {
      console.warn(`[LoRADiscovery] File too large: ${sizeMB.toFixed(1)}MB > ${MAX_FILE_SIZE_MB}MB limit`);
      return null;
    }

    // Minimum size check — a real LoRA is at least 1MB
    if (buffer.length < 1024 * 1024) {
      console.warn(`[LoRADiscovery] File suspiciously small: ${(buffer.length / 1024).toFixed(0)}KB`);
      return null;
    }

    console.log(`[LoRADiscovery] Downloaded: ${sizeMB.toFixed(1)}MB`);
    return buffer;
  } catch (err) {
    console.error(`[LoRADiscovery] Download error:`, err instanceof Error ? err.message : err);
    return null;
  }
}

function validateSafetensorsHeader(buffer: Buffer): boolean {
  if (buffer.length < 8) return false;

  // Safetensors format: 8-byte little-endian length, then JSON header
  const headerLen = buffer.readBigUInt64LE(0);
  if (headerLen <= 0 || headerLen > 100_000_000) return false; // sanity check

  const headerEnd = 8 + Number(headerLen);
  if (headerEnd > buffer.length) return false;

  try {
    const headerJson = buffer.subarray(8, headerEnd).toString('utf-8');
    JSON.parse(headerJson); // validates it's valid JSON
    return true;
  } catch {
    return false;
  }
}

async function uploadToSupabase(storagePath: string, data: Buffer): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error('[LoRADiscovery] Missing Supabase credentials');
    return null;
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const { error } = await supabase.storage
    .from(SUPABASE_RESOURCE_PATH)
    .upload(storagePath, data, {
      contentType: 'application/octet-stream',
      upsert: true,
    });

  if (error) {
    console.error(`[LoRADiscovery] Upload error: ${error.message}`);
    return null;
  }

  const { data: { publicUrl } } = supabase.storage
    .from(SUPABASE_RESOURCE_PATH)
    .getPublicUrl(storagePath);

  return publicUrl;
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .toLowerCase();
}
