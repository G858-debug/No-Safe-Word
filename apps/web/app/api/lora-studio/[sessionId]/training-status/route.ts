import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@no-safe-word/story-engine';

const REPLICATE_API = 'https://api.replicate.com/v1';

type ReplicateStatus = 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';

interface ReplicateTraining {
  id: string;
  status: ReplicateStatus;
  logs: string | null;
  output: { weights?: string } | null;
  error: string | null;
  urls?: { get?: string };
}

// Parse Replicate training logs to extract step progress.
// Log lines typically look like: "  100|1000 | loss=0.12 lr=0.0004"
// or "flux_train_replicate:  500/1000"
function parseStepProgress(logs: string | null, totalSteps: number): number | null {
  if (!logs || totalSteps <= 0) return null;

  const lines = logs.split('\n').reverse(); // Most recent first
  for (const line of lines) {
    // Format: "  250|1000 | ..."
    const pipeMatch = line.match(/\b(\d+)\|(\d+)\b/);
    if (pipeMatch) {
      const current = parseInt(pipeMatch[1], 10);
      const total = parseInt(pipeMatch[2], 10);
      if (total > 0) return Math.round((current / total) * 100);
    }
    // Format: "step 250/1000" or "250/1000"
    const slashMatch = line.match(/\b(\d+)\/(\d+)\b/);
    if (slashMatch) {
      const current = parseInt(slashMatch[1], 10);
      const total = parseInt(slashMatch[2], 10);
      if (total > 0 && current <= total) return Math.round((current / total) * 100);
    }
  }

  return null;
}

// GET /api/lora-studio/[sessionId]/training-status
// Polls Replicate for training status, updates the DB when complete.
// Returns: { status, logs, progressPct, loraOutputUrl, error }
export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await props.params;

  const { data: session, error: sessErr } = await (supabase as any)
    .from('nsw_lora_sessions')
    .select('replicate_training_id, status, lora_output_url')
    .eq('id', sessionId)
    .single();

  if (sessErr || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // If training is already complete, return stored result
  if (session.status === 'complete' && session.lora_output_url) {
    return NextResponse.json({
      status: 'succeeded',
      logs: null,
      progressPct: 100,
      loraOutputUrl: session.lora_output_url,
      error: null,
    });
  }

  if (!session.replicate_training_id) {
    return NextResponse.json({
      status: 'idle',
      logs: null,
      progressPct: null,
      loraOutputUrl: null,
      error: null,
    });
  }

  if (!process.env.REPLICATE_API_TOKEN) {
    return NextResponse.json({ error: 'REPLICATE_API_TOKEN not configured' }, { status: 500 });
  }

  // Fetch current training status from Replicate
  const resp = await fetch(`${REPLICATE_API}/trainings/${session.replicate_training_id}`, {
    headers: { Authorization: `Token ${process.env.REPLICATE_API_TOKEN}` },
  });

  if (!resp.ok) {
    return NextResponse.json(
      { error: `Replicate API error: ${resp.status}` },
      { status: 500 },
    );
  }

  const training = (await resp.json()) as ReplicateTraining;

  // Estimate step count from logs — look for config line to get total steps
  const totalStepsMatch = training.logs?.match(/max_train_steps[=:\s]+(\d+)/i);
  const totalSteps = totalStepsMatch ? parseInt(totalStepsMatch[1], 10) : 1000;
  const progressPct = parseStepProgress(training.logs, totalSteps);

  // Handle completion
  if (training.status === 'succeeded') {
    const loraOutputUrl = training.output?.weights ?? null;

    await (supabase as any)
      .from('nsw_lora_sessions')
      .update({
        status: 'complete',
        lora_output_url: loraOutputUrl,
      })
      .eq('id', sessionId);

    return NextResponse.json({
      status: 'succeeded',
      logs: training.logs,
      progressPct: 100,
      loraOutputUrl,
      error: null,
    });
  }

  if (training.status === 'failed' || training.status === 'canceled') {
    return NextResponse.json({
      status: training.status,
      logs: training.logs,
      progressPct: null,
      loraOutputUrl: null,
      error: training.error ?? `Training ${training.status}`,
    });
  }

  return NextResponse.json({
    status: training.status,
    logs: training.logs,
    progressPct,
    loraOutputUrl: null,
    error: null,
  });
}
