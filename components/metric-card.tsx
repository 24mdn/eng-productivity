import Link from "next/link";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { MetricKey, MetricSnapshotRow } from "@/lib/metrics-repository";
import { METRIC_META } from "@/lib/metrics-repository";
import { formatMetricValue, formatTrend } from "@/lib/format";
import { MetricSparkline } from "@/components/metric-sparkline";

const TREND_ICON = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
  none: Minus,
};

export function MetricCard({
  metricKey,
  series,
}: {
  metricKey: MetricKey;
  series: MetricSnapshotRow[];
}) {
  const meta = METRIC_META[metricKey];
  const latest = series[series.length - 1];
  const previous = series.length >= 2 ? series[series.length - 2] : null;
  const trend = formatTrend(latest?.value ?? null, previous?.value ?? null);
  const TrendIcon = TREND_ICON[trend.direction];
  const color = `var(${meta.chartVar})`;

  return (
    <Link href={`/dashboard/engineer/${metricKey}`} className="block h-full">
      <Card className="h-full border-white/70 bg-white/75 shadow-sm transition-shadow hover:shadow-md">
        <CardHeader>
          <Badge
            className="w-fit border-0 bg-muted text-foreground"
            style={{ color }}
          >
            {meta.badgeLabel}
          </Badge>
          <CardTitle>{meta.label}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-2">
            <span className="tabular-nums font-heading text-3xl font-semibold tracking-normal">
              {formatMetricValue(latest)}
            </span>
            <span
              className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
              title={trend.label}
            >
              <TrendIcon className="size-3.5" />
              {trend.label}
            </span>
          </div>
          <MetricSparkline series={series} color={color} />
          <p className="text-xs text-muted-foreground">
            based on {latest?.sampleSize ?? 0} record
            {latest?.sampleSize === 1 ? "" : "s"} this week
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
