export default function GeneratePage({
  params,
}: {
  params: { sessionId: string };
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Anime Generation</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Batch-generate anime training images for this session
      </p>
      <div className="mt-8 rounded-lg border border-dashed border-zinc-700 px-6 py-12 text-center text-sm text-zinc-500">
        Coming soon — prompt configuration and batch generation
      </div>
    </div>
  );
}