// Stage 6: Deployment
// Uploads the trained .safetensors to permanent Supabase Storage,
// updates the character_loras record, and links it to story_characters.

import type { DeploymentResult } from './types';

interface DeployerDeps {
  supabase: {
    from: (table: string) => any;
    storage: { from: (bucket: string) => any };
  };
}

/**
 * Deploy a trained and validated LoRA.
 *
 * 1. Store the LoRA weights URL (from Replicate training output)
 * 2. Update character_loras: status='deployed', storage_url, deployed_at
 * 3. Update story_characters: active_lora_id for all series using this character
 *
 * Note: LoRA .safetensors files are ~150-200MB which exceeds Supabase Storage's
 * 50MB limit. We store the Replicate delivery URL directly instead.
 */
export async function deployLora(
  loraBuffer: Buffer,
  characterId: string,
  characterName: string,
  loraId: string,
  datasetSize: number,
  deps: DeployerDeps,
  loraUrl?: string,
  fileSizeBytes?: number,
): Promise<DeploymentResult> {
  // Generate a clean filename
  const slug = slugify(characterName);
  const shortId = loraId.slice(0, 8);
  const filename = `char_${slug}_${shortId}.safetensors`;
  const storagePath = `character-loras/deployed/${filename}`;

  let storageUrl: string;

  if (loraUrl) {
    // Use the Replicate delivery URL directly (LoRA files are too large for Supabase)
    storageUrl = loraUrl;
    console.log(`[LoRA Deploy] Using Replicate weights URL for ${filename} (${(loraBuffer.length / 1024 / 1024).toFixed(1)}MB)`);
  } else {
    // Try Supabase upload (works for files under 50MB)
    console.log(`[LoRA Deploy] Uploading ${filename} (${(loraBuffer.length / 1024 / 1024).toFixed(1)}MB)...`);

    const { error: uploadError } = await deps.supabase.storage
      .from('story-images')
      .upload(storagePath, loraBuffer, {
        contentType: 'application/octet-stream',
        cacheControl: '31536000', // 1 year cache — LoRAs don't change
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Failed to upload LoRA file: ${uploadError.message}`);
    }

    const { data: urlData } = deps.supabase.storage
      .from('story-images')
      .getPublicUrl(storagePath);

    storageUrl = urlData.publicUrl;
    console.log(`[LoRA Deploy] Uploaded to: ${storagePath}`);
  }

  // Step 2: Update character_loras record
  const { error: updateError } = await deps.supabase
    .from('character_loras')
    .update({
      filename,
      storage_path: storagePath,
      storage_url: storageUrl,
      file_size_bytes: fileSizeBytes || loraBuffer.length,
      dataset_size: datasetSize,
      status: 'deployed',
      deployed_at: new Date().toISOString(),
    })
    .eq('id', loraId);

  if (updateError) {
    throw new Error(`Failed to update character_loras record: ${updateError.message}`);
  }

  // Step 3: Link to all story_characters entries for this character
  const { error: linkError } = await deps.supabase
    .from('story_characters')
    .update({ active_lora_id: loraId })
    .eq('character_id', characterId);

  if (linkError) {
    console.error(
      `[LoRA Deploy] Warning: Failed to update story_characters: ${linkError.message}`
    );
    // Non-fatal — the LoRA is still deployed, just not auto-linked
  }

  // Archive any previously deployed LoRAs for this character
  await deps.supabase
    .from('character_loras')
    .update({ status: 'archived' })
    .eq('character_id', characterId)
    .eq('status', 'deployed')
    .neq('id', loraId);

  console.log(`[LoRA Deploy] Deployment complete for ${characterName}`);

  return {
    filename,
    storagePath,
    storageUrl,
    fileSizeBytes: loraBuffer.length,
  };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
