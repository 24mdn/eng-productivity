import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DrillDownTable } from "@/components/drill-down-table";
import { MetricTrendChart } from "@/components/metric-trend-chart";
import {
  METRIC_KEYS,
  METRIC_META,
  getAggregateSnapshots,
  getAggregateDrillDownRecords,
  type MetricKey,
} from "@/lib/metrics-repository";
import { getCurrentProfile } from "@/lib/supabase/server";
import { formatMetricValue, formatWeekLabel } from "@/lib/format";

function isMetricKey(value: string): value is MetricKey {
  return (METRIC_KEYS as string[]).includes(value);
}

export default async function ExecMetricDrillDownPage({
  params,
}: {
  params: Promise<{ metric: string }>;
}) {
  const { metric } = await params;
  if (!isMetricKey(metric)) notFound();

  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "exec") redirect("/dashboard/engineer");

  const [series, drillDown] = await Promise.all([
    getAggregateSnapshots(metric),
    getAggregateDrillDownRecords(metric),
  ]);
  const meta = METRIC_META[metric];
  const sortedRecords = [...drillDown.records].sort(
    (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-3xl border border-white/70 bg-white/60 p-5 shadow-sm backdrop-blur sm:p-6">
        <Link
          href="/dashboard/exec"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Exec summary
        </Link>
        <div className="flex items-center gap-2">
          <Badge
            style={{
              background: `color-mix(in oklch, var(${meta.chartVar}), white 85%)`,
              color: `var(${meta.chartVar})`,
            }}
          >
            {meta.badgeLabel}
          </Badge>
        </div>
        <h2 className="font-heading text-4xl font-semibold tracking-normal">{meta.label}</h2>
        <p className="text-sm text-muted-foreground">Aggregated across every squad.</p>
      </section>

      <section className="rounded-3xl border border-white/70 bg-white/60 p-5 shadow-sm backdrop-blur sm:p-6">
        <MetricTrendChart series={series} color={`var(${meta.chartVar})`} />
      </section>

      <div className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Week of</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Sample size</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {series.map((row) => (
              <TableRow key={row.weekStart.toISOString()}>
                <TableCell>{formatWeekLabel(row.weekStart)}</TableCell>
                <TableCell className="tabular-nums font-medium">
                  {formatMetricValue(row)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {row.sampleSize}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <section className="flex flex-col gap-3 rounded-3xl border border-white/70 bg-white/60 p-5 shadow-sm backdrop-blur sm:p-6">
        <h3 className="font-heading text-base font-semibold">
          Records behind this metric
        </h3>
        <p className="text-sm text-muted-foreground">
          {drillDown.weekStart
            ? `${sortedRecords.length} GitHub record${sortedRecords.length === 1 ? "" : "s"} across all squads for the week of ${formatWeekLabel(drillDown.weekStart)} (the most recently ingested week) — nothing here is self-reported.`
            : "No ingested weeks yet."}
        </p>
        <div className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-sm">
          <DrillDownTable records={sortedRecords} hideActor />
        </div>
      </section>
    </div>
  );
}
