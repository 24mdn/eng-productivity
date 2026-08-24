"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  type TooltipContentProps,
} from "recharts";
import type { MetricSnapshotRow } from "@/lib/metrics-repository";
import { formatMetricValue, formatWeekLabel } from "@/lib/format";

interface ChartPoint {
  week: string;
  value: number | null;
  row: MetricSnapshotRow;
}

function ChartTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const row = (payload[0].payload as ChartPoint).row;
  return (
    <div className="rounded-lg border border-white/70 bg-white/95 px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{formatWeekLabel(row.weekStart)}</p>
      <p className="text-muted-foreground">
        <span className="font-semibold text-foreground">{formatMetricValue(row)}</span>
        {" · "}
        {row.sampleSize} record{row.sampleSize === 1 ? "" : "s"}
      </p>
    </div>
  );
}

/** A single metric's 12-week history as a real line chart — used by both the engineer and
 * exec drill-down pages, above the existing Week-of/Value/Sample-size table (the table stays
 * as the always-reachable, tooltip-free view of the same numbers). */
export function MetricTrendChart({
  series,
  color,
}: {
  series: MetricSnapshotRow[];
  color: string;
}) {
  const data: ChartPoint[] = series.map((row) => ({
    week: formatWeekLabel(row.weekStart),
    value: row.value,
    row,
  }));

  return (
    <div className="h-56 w-full sm:h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="week"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            interval="preserveStartEnd"
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            width={36}
            allowDecimals={false}
          />
          <Tooltip content={ChartTooltip} cursor={{ stroke: "var(--border)", strokeWidth: 1 }} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={{ r: 3, fill: color, stroke: "var(--background)", strokeWidth: 2 }}
            activeDot={{ r: 5, fill: color, stroke: "var(--background)", strokeWidth: 2 }}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
