import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@no-safe-word/story-engine';

const REPLICATE_API = 'https://api.replicate.com/v1';
const FLUX_TRAINER_OWNER = 'ostris';
const FLUX_TRAINER_MODEL = 'flux-dev-lora-trainer';

interface TrainingConfig {
  triggerWord: string;
  steps: number;
  learningRate: number;
  loraRank: number;
  batchSize: number;
  resolution: number;
}

async function getReplicateUsername(): Promise<string> {
  const resp = await fetch(`${REPLICATE_API}/account`, {
    headers: { Authorization: `Token ${process.env.REPLICATE_API_TOKEN}` },
  });
  if (!resp.ok) throw new Error(`Replicate account lookup failed: ${resp.status}`);
  const data = await resp.json();
  return data.username as string;
}

async function getFluxTrainerVersion(): Promise<string> {
  const resp = await fetch(
    `${REPLICATE_API}/models/${FLUX_TRAINER_OWNER}/${FLUX_TRAINER_MODEL}`,
    { headers: { Authorization: `Token ${process.env.REPLICATE_API_TOKEN}` } },
  );
  if (!resp.ok) throw new Error(`Could not fetch flux trainer model: ${resp.status}`);
  const data = await resp.json();
  const version = data.latest_version?.id as string | undefined;
  if (!version) throw new Error('No latest_version found for flux-dev-lora-trainer');
  return version;
}

async function ensureReplicateModel(owner: string, modelName: string): Promise<void> {
  // Check if model already exists
  const checkResp = await fetch(`${REPLICATE_API}/models/${owner}/${modelName}`, {
    headers: { Authorization: `Token ${process.env.REPLICATE_API_TOKEN}` },
  });
  if (checkResp.ok) return; // Already exists

  // Create the destination model (private)
  const createResp = await fetch(`${REPLICATE_API}/models`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      owner,
      name: modelName,
      visibility: 'private',
      hardware: 'gpu-l40s',
      description: 'NSW LoRA Studio — curves body LoRA',
    }),
  });

  if (!createResp.ok && createResp.status !== 422) {
    const err = await createResp.text();
    throw new Error(`Failed to create Replicate model: ${err}`);
  }
}

// POST /api/lora-studio/[sessionId]/start-training
// Body: { triggerWord, steps, learningRate, loraRank, batchSize, resolution }
// Starts a Replicate flux-dev-lora-trainer run and saves the training ID to the session.
// Returns: { trainingId, trainingUrl }
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await props.params;

  if (!process.env.REPLICATE_API_TOKEN) {
    return NextResponse.json({ error: 'REPLICATE_API_TOKEN not configured' }, { status: 500 });
  }

  const config = (await request.json()) as TrainingConfig;
  const { triggerWord, steps, learningRate, loraRank, batchSize, resolution } = config;

  // Load the session to get the dataset ZIP URL
  const { data: session, error: sessErr } = await (supabase as any)
    .from('nsw_lora_sessions')
    .select('dataset_zip_url, status')
    .eq('id', sessionId)
    .single();

  if (sessErr || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  if (!session.dataset_zip_url) {
    return NextResponse.json(
      { error: 'Dataset ZIP not packaged yet. Run package-dataset first.' },
      { status: 400 },
    );
  }

  try {
    const [replicateUsername, trainerVersion] = await Promise.all([
      getReplicateUsername(),
      getFluxTrainerVersion(),
    ]);

    const destModelName = `nsw-lora-studio-${sessionId.slice(0, 8)}`;
    await ensureReplicateModel(replicateUsername, destModelName);

    const destination = `${replicateUsername}/${destModelName}` as `${string}/${string}`;

    // Create the Replicate training
    const trainingResp = await fetch(
      `${REPLICATE_API}/models/${FLUX_TRAINER_OWNER}/${FLUX_TRAINER_MODEL}/versions/${trainerVersion}/trainings`,
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          destination,
          input: {
            input_images: session.dataset_zip_url,
            trigger_word: triggerWord,
            steps,
            learning_rate: learningRate,
            lora_rank: loraRank,
            batch_size: batchSize,
            resolution: String(resolution),
            autocaption: false,
            caption_dropout_rate: 0.05,
            optimizer: 'adamw8bit',
          },
        }),
      },
    );

    if (!trainingResp.ok) {
      const err = await trainingResp.text();
      return NextResponse.json(
        { error: `Replicate training creation failed: ${err}` },
        { status: 500 },
      );
    }

    const training = await trainingResp.json();
    const trainingId: string = training.id;
    const trainingUrl: string = training.urls?.get ?? `https://replicate.com/trainings/${trainingId}`;

    // Save training ID and advance session status
    await (supabase as any)
      .from('nsw_lora_sessions')
      .update({
        replicate_training_id: trainingId,
        replicate_training_url: trainingUrl,
        status: 'training',
      })
      .eq('id', sessionId);

    return NextResponse.json({ trainingId, trainingUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
