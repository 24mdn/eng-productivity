import { Skeleton } from "@/components/ui/skeleton";

export default function MetricDrillDownLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-6 w-56" />
      </div>

      <div className="flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
        <div className="flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
