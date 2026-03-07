export default function TrainPage({
  params,
}: {
  params: { sessionId: string };
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Captioning & Training</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Generate captions with Claude Vision, then trigger Replicate LoRA training
      </p>
      <div className="mt-8 rounded-lg border border-dashed border-zinc-700 px-6 py-12 text-center text-sm text-zinc-500">
        Coming soon — caption generation, training config, and job status
      </div>
    </div>
  );
}