export default function Loading() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-16 text-center">
      <div className="size-6 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      <p className="text-sm text-muted-foreground">Loading dashboard…</p>
    </div>
  );
}
