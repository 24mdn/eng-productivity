export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-16 text-center">
      <h1 className="text-2xl font-heading font-semibold">Page not found</h1>
      <p className="text-muted-foreground">
        This page doesn&apos;t exist in the engineering productivity dashboard.
      </p>
    </div>
  );
}
