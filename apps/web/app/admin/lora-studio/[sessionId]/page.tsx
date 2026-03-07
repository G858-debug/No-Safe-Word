export default function SessionOverviewPage({
  params,
}: {
  params: { sessionId: string };
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Session Overview</h1>
      <p className="mt-1 font-mono text-xs text-muted-foreground">{params.sessionId}</p>
      <div className="mt-8 rounded-lg border border-dashed border-zinc-700 px-6 py-12 text-center text-sm text-zinc-500">
        Coming soon — session status hub and pipeline progress
      </div>
    </div>
  );
}