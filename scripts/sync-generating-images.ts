/**
 * Script to generate and sync images for a story series.
 * Submits jobs one at a time, then polls RunPod until the image is stored.
 * This avoids the timeout issue where RunPod purges completed job data.
 *
 * Usage: npx tsx scripts/sync-generating-images.ts <seriesId>
 */

// Env vars loaded via: node --env-file=apps/web/.env.local
import { createClient } from '@supabase/supabase-js';
import {
  submitRunPodJob,
  getRunPodJobStatus,
  base64ToBuffer,
  convertProseToPrompt,
} from '@no-safe-word/image-gen';
import {
  buildV4SceneGenerationPayload,
  fetchCharacterDataMap,
} from '../apps/web/lib/server/generate-scene-image-v4';

// Direct Supabase client (not the shared one which may use env vars differently)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const POLL_INTERVAL = 5000; // 5 seconds
const POLL_TIMEOUT = 300000; // 5 minutes

async function pollUntilComplete(jobId: string): Promise<{ imageBase64: string } | null> {
  const runpodJobId = jobId.startsWith('runpod-') ? jobId.replace('runpod-', '') : jobId;
  const startTime = Date.now();

  while (Date.now() - startTime < POLL_TIMEOUT) {
    try {
      const status = await getRunPodJobStatus(runpodJobId);

      if (status.status === 'COMPLETED' && status.output?.images?.[0]) {
        const imageData = status.output.images[0].data;
        const base64Data = imageData.includes(',') ? imageData.split(',')[1] : imageData;
        return { imageBase64: base64Data };
      }

      if (status.status === 'FAILED') {
        console.error(`  Job FAILED: ${status.error || 'Unknown error'}`);
        return null;
      }

      if (status.status === 'CANCELLED' || status.status === 'TIMED_OUT') {
        console.error(`  Job ${status.status}`);
        return null;
      }

      // Still processing
      process.stdout.write('.');
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    } catch (err) {
      console.error(`  Poll error: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  console.error('  Poll timeout');
  return null;
}

async function storeImage(imageBase64: string, imageId: string, promptId: string): Promise<string | null> {
  const buffer = base64ToBuffer(imageBase64);
  const timestamp = Date.now();
  const storagePath = `stories/${imageId}-${timestamp}.png`;

  const { error: uploadError } = await supabase.storage
    .from('story-images')
    .upload(storagePath, buffer, { contentType: 'image/png', upsert: true });

  if (uploadError) {
    console.error(`  Upload failed: ${uploadError.message}`);
    return null;
  }

  const { data: { publicUrl } } = supabase.storage
    .from('story-images')
    .getPublicUrl(storagePath);

  // Update image record
  await supabase
    .from('images')
    .update({ stored_url: publicUrl, sfw_url: publicUrl })
    .eq('id', imageId);

  // Update prompt status
  await supabase
    .from('story_image_prompts')
    .update({ status: 'generated' })
    .eq('id', promptId);

  return publicUrl;
}

async function main() {
  const seriesId = process.argv[2];
  if (!seriesId) {
    console.error('Usage: npx tsx scripts/sync-generating-images.ts <seriesId>');
    process.exit(1);
  }

  console.log(`Generating images for series: ${seriesId}`);

  // Verify series engine
  const { data: series } = await supabase
    .from('story_series')
    .select('image_engine, title')
    .eq('id', seriesId)
    .single();

  if (!series || series.image_engine !== 'juggernaut_ragnarok') {
    console.error(`Series engine is "${series?.image_engine}", not juggernaut_ragnarok`);
    process.exit(1);
  }

  console.log(`Series: ${series.title}`);

  // Get all posts
  const { data: posts } = await supabase
    .from('story_posts')
    .select('id')
    .eq('series_id', seriesId);

  const postIds = (posts || []).map(p => p.id);

  // Get pending/failed prompts
  const { data: prompts } = await supabase
    .from('story_image_prompts')
    .select('id, post_id, image_type, position, character_name, character_id, secondary_character_name, secondary_character_id, prompt')
    .in('post_id', postIds)
    .in('status', ['pending', 'failed'])
    .order('position');

  if (!prompts || prompts.length === 0) {
    console.log('No pending or failed prompts to generate');
    process.exit(0);
  }

  console.log(`Found ${prompts.length} prompts to generate\n`);

  // Pre-fetch character data
  const characterIds = Array.from(
    new Set(
      prompts
        .flatMap(p => [p.character_id, p.secondary_character_id])
        .filter((id): id is string => id !== null),
    ),
  );
  const characterDataMap = await fetchCharacterDataMap(characterIds);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    console.log(`[${i + 1}/${prompts.length}] ${prompt.character_name} (${prompt.image_type})`);
    console.log(`  Prompt: ${prompt.prompt.substring(0, 80)}...`);

    try {
      // Mark as generating
      await supabase
        .from('story_image_prompts')
        .update({ status: 'generating' })
        .eq('id', prompt.id);

      const seed = Math.floor(Math.random() * 2_147_483_647) + 1;

      // Build payload
      const result = await buildV4SceneGenerationPayload({
        imgPrompt: prompt,
        seriesId,
        characterDataMap,
        seed,
      });

      // Submit to RunPod
      const { jobId: runpodJobId } = await submitRunPodJob(
        result.workflow,
        result.images.length > 0 ? result.images : undefined,
        result.characterLoraDownloads.length > 0 ? result.characterLoraDownloads : undefined,
      );

      const jobId = `runpod-${runpodJobId}`;
      console.log(`  Submitted: ${runpodJobId}`);

      // Create image record
      const { data: imageRow } = await supabase
        .from('images')
        .insert({
          character_id: prompt.character_id || null,
          prompt: result.assembledPrompt,
          negative_prompt: result.negativePrompt,
          settings: {
            width: result.width,
            height: result.height,
            steps: result.profile.steps,
            cfg: result.profile.cfg,
            seed: result.seed,
            engine: 'runpod-v4-juggernaut-ragnarok',
          },
          mode: result.mode,
        })
        .select('id')
        .single();

      if (!imageRow) throw new Error('Failed to create image record');

      // Create generation job record
      await supabase.from('generation_jobs').insert({
        job_id: jobId,
        image_id: imageRow.id,
        status: 'pending',
        cost: 0,
      });

      // Link image to prompt
      await supabase
        .from('story_image_prompts')
        .update({ image_id: imageRow.id })
        .eq('id', prompt.id);

      // Poll until complete
      process.stdout.write('  Polling');
      const pollResult = await pollUntilComplete(jobId);
      console.log('');

      if (pollResult) {
        // Store the image
        const storedUrl = await storeImage(pollResult.imageBase64, imageRow.id, prompt.id);
        if (storedUrl) {
          // Update job status
          await supabase
            .from('generation_jobs')
            .update({ status: 'completed', completed_at: new Date().toISOString() })
            .eq('job_id', jobId);

          console.log(`  ✓ Stored: ${storedUrl.substring(0, 80)}...`);
          success++;
        } else {
          await supabase.from('story_image_prompts').update({ status: 'failed' }).eq('id', prompt.id);
          failed++;
        }
      } else {
        await supabase.from('story_image_prompts').update({ status: 'failed' }).eq('id', prompt.id);
        failed++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ Error: ${msg}`);
      await supabase.from('story_image_prompts').update({ status: 'failed' }).eq('id', prompt.id);
      failed++;
    }

    console.log('');
  }

  console.log(`\n=== Done: ${success} generated, ${failed} failed ===`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
