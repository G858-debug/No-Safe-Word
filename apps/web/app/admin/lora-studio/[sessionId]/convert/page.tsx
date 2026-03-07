export default function ConvertPage({
  params,
}: {
  params: { sessionId: string };
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Flux Conversion</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Convert approved anime images to photorealistic Flux outputs
      </p>
      <div className="mt-8 rounded-lg border border-dashed border-zinc-700 px-6 py-12 text-center text-sm text-zinc-500">
        Coming soon — batch conversion trigger and progress tracking
      </div>
    </div>
  );
}