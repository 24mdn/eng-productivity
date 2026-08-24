import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ProxyCaveatBanner } from "@/components/proxy-caveat-banner";
import {
  getAggregateSnapshots,
  getScopeMeta,
  METRIC_KEYS,
  METRIC_META,
  type MetricKey,
  type MetricSnapshotRow,
} from "@/lib/metrics-repository";
import { getCurrentProfile } from "@/lib/supabase/server";
import { formatTrend } from "@/lib/format";
import { MetricSparkline } from "@/components/metric-sparkline";

function plainLanguage(metric: MetricKey, row: MetricSnapshotRow): string {
  if (row.value === null) return "Not enough data yet this week.";
  switch (metric) {
    case "deployment_frequency": {
      if (row.value === 0) return "No changes shipped this week.";
      const perWeekDays = 7 / row.value;
      return row.value === 1
        ? "Shipping about once a week."
        : `Shipping every ${perWeekDays.toFixed(1)} days on average.`;
    }
    case "lead_time_for_changes":
      return row.value < 24
        ? `Code goes from written to live in around ${row.value.toFixed(0)} hours.`
        : `Code goes from written to live in around ${(row.value / 24).toFixed(1)} days.`;
    case "change_failure_rate":
      return row.value === 0
        ? "No releases needed a follow-up fix this week."
        : `Around ${row.value.toFixed(0)}% of releases needed a fix within 2 days.`;
    case "mttr":
      return `Issues get fixed in around ${row.value.toFixed(0)} hours.`;
    case "pr_review_turnaround":
      return `Pull requests get their first review in around ${row.value.toFixed(0)} hours.`;
  }
}

const EXEC_TITLES: Record<MetricKey, string> = {
  deployment_frequency: "Shipping pace",
  lead_time_for_changes: "Idea to production",
  change_failure_rate: "Release quality",
  mttr: "Time to fix",
  pr_review_turnaround: "Code review speed",
};

export default async function ExecDashboardPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "exec") redirect("/dashboard/engineer");

  const [scopeMeta, seriesEntries] = await Promise.all([
    getScopeMeta(),
    Promise.all(METRIC_KEYS.map(async (key) => [key, await getAggregateSnapshots(key)] as const)),
  ]);
  const seriesByKey = Object.fromEntries(seriesEntries) as Record<MetricKey, MetricSnapshotRow[]>;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            This week
          </p>
          <h2 className="font-heading text-2xl font-semibold tracking-normal">Exec summary</h2>
        </div>
        <p className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-muted-foreground shadow-sm">
          {scopeMeta.squads.length} squads
        </p>
      </section>

      <ProxyCaveatBanner squads={scopeMeta.squads} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {METRIC_KEYS.map((key) => {
          const series = seriesByKey[key];
          const row = series[series.length - 1];
          const previous = series.length >= 2 ? series[series.length - 2] : null;
          const trend = formatTrend(row.value, previous?.value ?? null);
          return (
            <Link key={key} href={`/dashboard/exec/${key}`} className="block h-full">
              <Card className="h-full border-white/70 bg-white/75 shadow-sm transition-shadow hover:shadow-md">
                <CardHeader>
                  <CardTitle>{EXEC_TITLES[key]}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="text-base leading-snug">{plainLanguage(key, row)}</p>
                  <MetricSparkline series={series} color={`var(${METRIC_META[key].chartVar})`} />
                  <p className="w-fit rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    {trend.label} · based on {row.sampleSize} record
                    {row.sampleSize === 1 ? "" : "s"} this week
                  </p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
