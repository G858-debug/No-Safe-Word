import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@no-safe-word/story-engine';
import { terminateTrainingPod } from '@no-safe-word/image-gen/runpod-pods';

// Lazy import to avoid pulling in heavy deps at module level
async function getCompletePonyPipeline() {
  const { completePonyPipeline } = await import('@no-safe-word/image-gen/server/pony-lora-trainer');
  return completePonyPipeline;
}

/**
 * POST /api/lora-training-webhook
 *
 * Receives completion/failure callbacks from the Kohya training pod.
 * The pod POSTs here when training finishes (success or failure).
 *
 * Body: {
 *   loraId: string,
 *   status: 'completed' | 'failed',
 *   secret: string,
 *   loraUrl?: string,
 *   loraFilename?: string,
 *   fileSizeBytes?: number,
 *   message?: string,
 * }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { loraId, status, secret, loraUrl, loraFilename, fileSizeBytes, message } = body as {
    loraId: string;
    status: 'completed' | 'failed';
    secret?: string;
    loraUrl?: string;
    loraFilename?: string;
    fileSizeBytes?: number;
    message?: string;
  };

  // Verify webhook secret
  const expectedSecret = process.env.TRAINING_WEBHOOK_SECRET || '';
  if (expectedSecret && secret !== expectedSecret) {
    console.error(`[TrainingWebhook] Invalid secret for loraId: ${loraId}`);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!loraId) {
    return NextResponse.json({ error: 'loraId is required' }, { status: 400 });
  }

  console.log(`[TrainingWebhook] Received ${status} for loraId: ${loraId}`);

  // Fetch the LoRA record
  const { data: lora, error: fetchErr } = await (supabase as any)
    .from('character_loras')
    .select('id, training_id, training_attempts, status, filename, storage_path')
    .eq('id', loraId)
    .single();

  if (fetchErr || !lora) {
    console.error(`[TrainingWebhook] LoRA not found: ${loraId}`);
    return NextResponse.json({ error: 'LoRA record not found' }, { status: 404 });
  }

  if (status === 'completed') {
    // Terminate the training pod after successful completion
    if (lora.training_id) {
      terminateTrainingPod(lora.training_id).catch(err => {
        console.warn(`[TrainingWebhook] Failed to terminate pod ${lora.training_id}: ${err}`);
      });
    }
    // Get the public URL for the uploaded LoRA
    let storageUrl = loraUrl;
    if (!storageUrl && lora.storage_path) {
      const { data: urlData } = (supabase as any).storage
        .from('lora-training-datasets')
        .getPublicUrl(lora.storage_path);
      storageUrl = urlData?.publicUrl;
    }

    // Update the LoRA record with the trained file details
    await (supabase as any)
      .from('character_loras')
      .update({
        storage_url: storageUrl,
        filename: loraFilename || lora.filename,
        file_size_bytes: fileSizeBytes || null,
        status: 'validating',
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', loraId);

    console.log(`[TrainingWebhook] Training complete. Starting validation for ${loraId}`);

    // Fire-and-forget: run validation + deployment
    getCompletePonyPipeline().then(completePonyPipeline => {
      void completePonyPipeline(loraId, { supabase }).catch(err => {
        console.error(`[TrainingWebhook] Pipeline completion error:`, err);
      });
    });

    return NextResponse.json({ ok: true, stage: 'validating' });
  }

  if (status === 'failed') {
    // Terminate the training pod after failure
    if (lora.training_id) {
      terminateTrainingPod(lora.training_id).catch(err => {
        console.warn(`[TrainingWebhook] Failed to terminate pod ${lora.training_id}: ${err}`);
      });
    }

    const attempts = (lora.training_attempts || 0) + 1;
    const maxAttempts = 3;
    const errorMsg = message || 'Training pod reported failure';

    console.error(`[TrainingWebhook] Training failed (attempt ${attempts}/${maxAttempts}): ${errorMsg}`);

    await (supabase as any)
      .from('character_loras')
      .update({
        status: 'failed',
        error: errorMsg,
        training_attempts: attempts,
        updated_at: new Date().toISOString(),
      })
      .eq('id', loraId);

    return NextResponse.json({ ok: true, stage: 'failed', attempts });
  }

  // Progress updates (e.g. "training", "uploading") — acknowledge without terminating
  console.log(`[TrainingWebhook] Progress update: ${status} — ${message || 'no message'}`);
  return NextResponse.json({ ok: true, stage: status });
}
