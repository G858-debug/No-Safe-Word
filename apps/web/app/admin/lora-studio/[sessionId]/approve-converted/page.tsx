export default function ApproveConvertedPage({
  params,
}: {
  params: { sessionId: string };
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Approve Converted Images</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Final human review of Flux-converted images before captioning and training
      </p>
      <div className="mt-8 rounded-lg border border-dashed border-zinc-700 px-6 py-12 text-center text-sm text-zinc-500">
        Coming soon — image grid with approve / reject actions
      </div>
    </div>
  );
}