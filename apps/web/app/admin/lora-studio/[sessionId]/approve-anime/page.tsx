export default function ApproveAnimePage({
  params,
}: {
  params: { sessionId: string };
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Approve Anime Images</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Review and approve generated anime images before Flux conversion
      </p>
      <div className="mt-8 rounded-lg border border-dashed border-zinc-700 px-6 py-12 text-center text-sm text-zinc-500">
        Coming soon — image grid with approve / reject actions
      </div>
    </div>
  );
}